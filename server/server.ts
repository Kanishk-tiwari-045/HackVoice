import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import { authRouter } from "./routes/auth";
import { roomsRouter } from "./routes/rooms";
import { messagesRouter } from "./routes/messages";
import { roomMembersRouter } from "./routes/roommembers";
import { supabase } from "./db"; // Ensure this is correctly exported

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Allow all origins
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", authRouter);
app.use("/api/rooms", roomsRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/room-members", roomMembersRouter);

// Track which user is in which room by socket ID
// socketRoomMap[socket.id] = { roomCode, userId }
const socketRoomMap: {
  [socketId: string]: { roomCode: string; userId: string };
} = {};

// Map userId to socket.id for signaling
const userSockets: { [userId: string]: string } = {};

// For presence: roomPresence[roomCode] = Set of userIds
const roomPresence: { [roomCode: string]: Set<string> } = {};

// Type definitions for WebRTC signaling data
interface OfferData {
  fromUserId: string;
  targetUserId: string;
  offer: any; // RTCSessionDescriptionInit or similar
}

interface AnswerData {
  fromUserId: string;
  targetUserId: string;
  answer: any; // RTCSessionDescriptionInit or similar
}

interface IceCandidateData {
  fromUserId: string;
  targetUserId: string;
  candidate: any; // RTCIceCandidateInit or similar
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Handle user joining a room
  socket.on(
    "join_room",
    (data: { roomCode: string; userId: string; displayName: string }) => {
      const { roomCode, userId, displayName } = data;

      // Store in maps
      socketRoomMap[socket.id] = { roomCode, userId };
      userSockets[userId] = socket.id;
      console.log(`User ${userId} joined with socket ${socket.id}`);
      // Join the actual Socket.IO room
      socket.join(roomCode);

      // Update presence for that room
      if (!roomPresence[roomCode]) {
        roomPresence[roomCode] = new Set();
      }
      roomPresence[roomCode].add(userId);

      // Broadcast presence to the room
      io.to(roomCode).emit("presence_update", Array.from(roomPresence[roomCode]));

      // Notify others in the room about the new participant
      socket
        .to(roomCode)
        .emit("participant_joined", { participant: { id: userId, displayName } });
      console.log(`User ${userId} (${displayName}) joined room ${roomCode}`);
    }
  );

  // Fetch message history for a room
  socket.on("fetch_messages", async (roomCode) => {
    try {
      const { data: messages, error } = await supabase
        .from("messages")
        .select("*")
        .eq("room_code", roomCode)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Supabase Fetch Error:", error.message);
        return;
      }

      // Send the entire chat history back only to the requesting socket
      socket.emit("chat_history", messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
    }
  });

  // Handle incoming chat messages (including speech-to-text transcripts)
  socket.on("chat_message", async (data) => {
    const { roomCode, message, userId } = data;

    try {
      // Insert the message into the Supabase 'messages' table
      const { data: insertedMessage, error } = await supabase
        .from("messages")
        .insert([{ room_code: roomCode, user_id: userId, content: message }])
        .select();

      if (error) {
        console.error("Supabase Insertion Error:", error.message);
        return;
      }

      // Broadcast the inserted message to all clients in the room
      if (insertedMessage && insertedMessage.length > 0) {
        io.to(roomCode).emit("chat_message", {
          userId: insertedMessage[0].user_id,
          message: insertedMessage[0].content,
          timestamp: insertedMessage[0].created_at,
        });
      }
    } catch (error) {
      console.error("Error handling chat message:", error);
    }
  });

  // Handle WebRTC signaling: offer
  socket.on("offer", (data: OfferData) => {
    const { fromUserId, targetUserId, offer } = data;
    const targetSocketId = userSockets[targetUserId];
    if (targetSocketId) {
      io.to(targetSocketId).emit("offer", { fromUserId, offer });
    } else {
      console.warn(`Target user ${targetUserId} not found for offer from ${fromUserId}`);
    }
  });

  // Handle WebRTC signaling: answer
  socket.on("answer", (data: AnswerData) => {
    const { fromUserId, targetUserId, answer } = data;
    const targetSocketId = userSockets[targetUserId];
    if (targetSocketId) {
      io.to(targetSocketId).emit("answer", { fromUserId, answer });
    } else {
      console.warn(`Target user ${targetUserId} not found for answer from ${fromUserId}`);
    }
  });

  // Handle WebRTC signaling: ice_candidate
  socket.on("ice_candidate", (data: IceCandidateData) => {
    const { fromUserId, targetUserId, candidate } = data;
    const targetSocketId = userSockets[targetUserId];
    if (targetSocketId) {
      io.to(targetSocketId).emit("ice_candidate", { fromUserId, candidate });
    } else {
      console.warn(
        `Target user ${targetUserId} not found for ICE candidate from ${fromUserId}`
      );
    }
  });

  // Handle user leaving a room
  socket.on("leave_room", (roomCode) => {
    socket.leave(roomCode);

    // Also remove them from presence if they're in there
    const info = socketRoomMap[socket.id];
    if (info && info.roomCode === roomCode) {
      const { userId } = info;
      roomPresence[roomCode]?.delete(userId);
      io.to(roomCode).emit(
        "presence_update",
        Array.from(roomPresence[roomCode] || [])
      );
      // Remove from maps
      delete socketRoomMap[socket.id];
      delete userSockets[userId];
    }

    console.log(`Socket ${socket.id} left room ${roomCode}`);
  });

  // Handle user disconnection
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    // Figure out which room they belonged to
    const info = socketRoomMap[socket.id];
    if (info) {
      const { roomCode, userId } = info;
      // Remove from presence
      if (roomPresence[roomCode]) {
        roomPresence[roomCode].delete(userId);
        io.to(roomCode).emit(
          "presence_update",
          Array.from(roomPresence[roomCode])
        );
      }
      // Clean up the maps
      delete socketRoomMap[socket.id];
      delete userSockets[userId];
    }
  });
});

// Error handling middleware
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error(err.stack);
    res.status(500).json({ error: "Something went wrong!" });
  }
);

// Start the server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;