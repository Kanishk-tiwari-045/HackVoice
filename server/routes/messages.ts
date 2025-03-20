import { Router } from 'express';
import { supabase } from '../db'; // Your Supabase client
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

    // Join messages with users to get display_name
    const { data: messages, error } = await supabase
      .from('messages')
      .select(`
        id,
        user_id,
        content,
        created_at,
        users(display_name)
      `)
      .eq('room_code', roomCode)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Supabase Error:', error.message);
      return res.status(500).json({ error: 'Database query failed' });
    }

    // Transform messages to include a "username" field
    const transformedMessages = messages.map((msg: any) => ({
      id: msg.id,
      user_id: msg.user_id,
      content: msg.content,
      created_at: msg.created_at,
      display_name: msg.users ? msg.users.display_name || 'Unknown User' : 'Unknown User',
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

    if (error) {
      console.error('Supabase Insert Error:', error.message);
      return res.status(500).json({ error: 'Failed to save message' });
    }

    res.status(201).json(data[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating message:', error);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

export const messagesRouter = router;
