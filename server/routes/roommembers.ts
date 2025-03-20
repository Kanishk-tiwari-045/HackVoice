import { Router } from 'express';
import { supabase } from '../db/index';
import { z } from 'zod';

const router = Router();

// GET room members for a given room code
router.get('/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    // Query room_members table joined with users to get participants' id and display_name
    const { data, error } = await supabase
      .from('room_members')
      .select(`user:users(id, display_name)`)
      .eq('room_code', roomCode);

    if (error) throw error;

    // Transform data to return an array of participants
    const participants = data.map((member: any) => ({
      id: member.user.id,
      displayName: member.user.display_name,
    }));

    res.json(participants);
  } catch (error) {
    console.error('Error fetching room members:', error);
    res.status(500).json({ error: 'Failed to fetch room members' });
  }
});

export const roomMembersRouter = router;
