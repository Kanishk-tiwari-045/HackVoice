import { Router } from 'express';
import { supabase } from '../db'; // Ensure your Supabase client is exported from here
import { z } from 'zod';

const router = Router();

const messageSchema = z.object({
  roomCode: z.string().length(6),
  userId: z.string().uuid(),
  content: z.string().min(1).max(1000),
});

// GET messages for a given room code
router.get('/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;

    // Fetch messages and join with the users table to get display_name
    const { data: messages, error } = await supabase
      .from('messages')
      .select(`
        *,
        user:users(display_name)
      `)
      .eq('room_code', roomCode)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Transform each message to include a "username" field from the joined users table
    const transformedMessages = messages.map((msg: any) => ({
      ...msg,
      username: msg.user ? msg.user.display_name : null,
    }));

    res.json(transformedMessages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST a new message
router.post('/', async (req, res) => {
  try {
    const { roomCode, userId, content } = messageSchema.parse(req.body);

    const { data, error } = await supabase
      .from('messages')
      .insert([{ room_code: roomCode, user_id: userId, content }])
      .select();

    if (error) throw error;

    res.status(201).json(data[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error('Error creating message:', error);
      res.status(500).json({ error: 'Failed to create message' });
    }
  }
});

export const messagesRouter = router;
