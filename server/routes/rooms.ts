import { Router } from 'express';
import { supabase } from '../db'; // Ensure supabase is correctly exported from your db file
import { generateRoomCode } from '../utils/generateCode';
import QRCode from 'qrcode';
import { z } from 'zod';

// If you intend to pass a display name or other string as creatorId, use this:
const createRoomSchema = z.object({
  creatorId: z.string().min(1, 'creatorId cannot be empty'),
});

// If you require a valid UUID, uncomment the following and comment out the above:
// const createRoomSchema = z.object({
//   creatorId: z.string().uuid(),
// });

const joinRoomSchema = z.object({
  userId: z.string().uuid(),
  roomCode: z.string().length(6),
});

const router = Router();

/**
 * POST /api/rooms/create
 * Creates a new room with a 6-char code, stores a QR code, 
 * and adds the creator to room_members.
 */
router.post('/create', async (req, res) => {
  try {
    const { creatorId } = createRoomSchema.parse(req.body);
    const roomCode = generateRoomCode();

    // Generate QR code
    const qrData = await QRCode.toDataURL(roomCode);

    // Create room in database using Supabase
    const { data: roomData, error: roomError } = await supabase
      .from('rooms')
      .insert([{ code: roomCode, creator_id: creatorId, qr_code: qrData }])
      .select();

    if (roomError) throw roomError;
    if (!roomData || roomData.length === 0) {
      throw new Error('Failed to create room');
    }

    // Add creator to room members
    const { error: memberError } = await supabase
      .from('room_members')
      .insert([{ room_code: roomCode, user_id: creatorId }]);
    if (memberError) throw memberError;

    res.status(201).json({
      roomCode,
      qrCode: qrData,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error('Room creation error:', error);
      res.status(500).json({ error: 'Failed to create room' });
    }
  }
});

/**
 * POST /api/rooms/join
 * Joins an existing room by inserting a row into room_members. 
 * Returns a list of current members in the room.
 */
router.post('/join', async (req, res) => {
  try {
    const { userId, roomCode } = joinRoomSchema.parse(req.body);

    // Check if room exists using Supabase
    const { data: roomData, error: roomError } = await supabase
      .from('rooms')
      .select('*')
      .eq('code', roomCode)
      .single();

    if (roomError || !roomData) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Check if user is already in room
    const { data: existingMember, error: memberError } = await supabase
      .from('room_members')
      .select('*')
      .eq('room_code', roomCode)
      .eq('user_id', userId)
      .maybeSingle();

    if (memberError) throw memberError;

    // OPTION A: If you want to throw an error if user is already in the room
    if (existingMember) {
      return res.status(400).json({ error: 'User already in room' });
    }

    // OPTION B: If you'd prefer to let the user "join" again without error, 
    // comment out the return above and do something like this:
    /*
    if (existingMember) {
      // Return the current room members or just success
      const members = await getRoomMembers(roomCode);
      return res.status(200).json({ message: 'Already in room', members });
    }
    */

    // Add user to room
    const { error: joinError } = await supabase
      .from('room_members')
      .insert([{ room_code: roomCode, user_id: userId }]);

    if (joinError) throw joinError;

    // Return the updated list of members
    const members = await getRoomMembers(roomCode);
    res.status(200).json({
      message: 'Successfully joined room',
      members,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error('Room joining error:', error);
      res.status(500).json({ error: 'Failed to join room' });
    }
  }
});

/**
 * Helper function to get all room members with user info (id, display_name)
 */
async function getRoomMembers(roomCode: string) {
  const { data, error } = await supabase
    .from('room_members')
    .select(`
      user:users(
        id,
        display_name
      )
    `)
    .eq('room_code', roomCode);

  if (error) {
    console.error('Error fetching room members:', error);
    return [];
  }

  // Transform to a simpler structure
  return data.map((member: any) => ({
    id: member.user.id,
    displayName: member.user.display_name,
  }));
}

export const roomsRouter = router;
