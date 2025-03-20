import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { authRouter } from './routes/auth';
import { roomsRouter } from './routes/rooms';
import { messagesRouter } from './routes/messages';
import { supabase } from './db';
import { roomMembersRouter } from './routes/roommembers';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/messages', messagesRouter);

// Socket.IO events
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_room', (roomCode) => {
    socket.join(roomCode);
    console.log(`User ${socket.id} joined room ${roomCode}`);
  });

  socket.on('leave_room', (roomCode) => {
    socket.leave(roomCode);
    console.log(`User ${socket.id} left room ${roomCode}`);
  });

  socket.on('chat_message', async (data) => {
    const { roomCode, message, username } = data;
    
    try {
      // Store message in database using Supabase
      const { data: insertedMessage, error } = await supabase
        .from('messages')
        .insert([{ room_code: roomCode, username: username, content: message }])
        .select();

      if (error) throw error;
      
      // Broadcast message to room
      io.to(roomCode).emit('chat_message', {
        username,
        message,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error('Error handling chat message:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.use('/api/room-members', roomMembersRouter);


const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});