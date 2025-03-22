import { Router } from 'express';
import { supabase } from '../db';
import { z } from 'zod';
const router = Router();

const leaveSchema = z.object({
  userId: z.string().uuid(),
});

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

// DELETE /api/room-members/:roomCode
router.delete('/:roomCode', async (req, res) => {
  const { roomCode } = req.params;
  try {
    const { userId } = leaveSchema.parse(req.body);
    const { data, error } = await supabase
      .from('room_members')
      .delete()
      .eq('room_code', roomCode)
      .eq('user_id', userId);
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json(data);
  } catch (err) {
    return res.status(400).json({ error: err });
  }
});


export const roomMembersRouter = router;
