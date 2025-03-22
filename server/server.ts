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

// In-memory map to track online users per room
const roomPresence: { [roomCode: string]: Set<string> } = {};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Handle user joining a room
  socket.on("user_connected", (data: { roomCode: string; userId: string }) => {
    const { roomCode, userId } = data;
    socket.join(roomCode);
    if (!roomPresence[roomCode]) {
      roomPresence[roomCode] = new Set();
    }
    roomPresence[roomCode].add(userId);
    io.to(roomCode).emit("presence_update", Array.from(roomPresence[roomCode]));
    console.log(`User ${userId} joined room ${roomCode}`);
  });

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

      socket.emit("chat_history", messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
    }
  });

  // Handle incoming chat messages (including speech-to-text transcripts)
  socket.on("chat_message", async (data) => {
    const { roomCode, message, userId } = data;

    try {
      // Insert the message into the Supabase 'messages' table and retrieve the inserted row
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
          userId: insertedMessage[0].user_id, // Accurate user ID from DB
          message: insertedMessage[0].content, // The message content (typed or transcribed)
          timestamp: insertedMessage[0].created_at, // Timestamp from DB
        });
      }
    } catch (error) {
      console.error("Error handling chat message:", error);
    }
  });

  // Handle user leaving a room
  socket.on("leave_room", (roomCode) => {
    socket.leave(roomCode);
    console.log(`Socket ${socket.id} left room ${roomCode}`);
  });

  // Handle user disconnection
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    // Update presence for all rooms the user was in
    for (const roomCode in roomPresence) {
      if (roomPresence[roomCode].has(socket.id)) {
        roomPresence[roomCode].delete(socket.id);
        io.to(roomCode).emit(
          "presence_update",
          Array.from(roomPresence[roomCode])
        );
      }
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
