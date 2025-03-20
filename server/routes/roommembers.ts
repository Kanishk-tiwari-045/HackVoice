import { Router } from 'express';
import { supabase } from '../db';
const router = Router();

router.get('/:roomCode', async (req, res) => {
  try {
    const { roomCode } = req.params;
    const { data, error } = await supabase
      .from('room_members')
      .select(`user:users(id, display_name)`)
      .eq('room_code', roomCode);

    if (error) throw error;

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
