import { Router } from 'express';
import { supabase } from '../db/index';
import { z } from 'zod';

const router = Router();

const registerSchema = z.object({
  displayName: z.string().min(3).max(30),
});

router.post('/register', async (req, res) => {
  try {
    const { displayName } = registerSchema.parse(req.body);

    // Check if display name is already taken using Supabase
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('display_name', displayName);

    if (fetchError) throw fetchError;

    // If user already exists, return the existing user data (status 200)
    if (existingUser && existingUser.length > 0) {
      return res.status(200).json(existingUser[0]);
    }

    // Insert new user using Supabase
    const { data, error } = await supabase
      .from('users')
      .insert([{ display_name: displayName }])
      .select();

    if (error) throw error;

    res.status(201).json(data[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Failed to register user' });
    }
  }
});

export const authRouter = router;
