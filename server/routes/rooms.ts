import { Router } from "express";
import { supabase } from "../db"; // Ensure supabase is correctly exported from your db file
import { generateRoomCode } from "../utils/generateCode";
import QRCode from "qrcode";
import { z } from "zod";

// If you intend to pass a display name or other string as creatorId, use this:
const createRoomSchema = z.object({
  creatorId: z.string().min(1, "creatorId cannot be empty"),
});

const joinRoomSchema = z.object({
  userId: z.string().uuid(),
  roomCode: z.string().length(6),
});

const router = Router();

router.post("/create", async (req, res) => {
  try {
    const { creatorId } = createRoomSchema.parse(req.body);
    const roomCode = generateRoomCode();

    // Generate QR code
    const qrData = await QRCode.toDataURL(roomCode);

    // Create room in database using Supabase
    const { data: roomData, error: roomError } = await supabase
      .from("rooms")
      .insert([{ code: roomCode, creator_id: creatorId, qr_code: qrData }])
      .select();

    if (roomError) throw roomError;
    if (!roomData || roomData.length === 0) {
      throw new Error("Failed to create room");
    }

    // Add creator to room members
    const { error: memberError } = await supabase
      .from("room_members")
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
      console.error("Room creation error:", error);
      res.status(500).json({ error: "Failed to create room" });
    }
  }
});

router.get("/:roomCode", async (req, res) => {
  try {
    const { roomCode } = req.params;
    const { data, error } = await supabase
      .from("rooms")
      .select("code, qr_code, creator_id, created_at")
      .eq("code", roomCode)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error fetching room details:", error);
    res.status(500).json({ error: "Failed to fetch room details" });
  }
});

/**
 * POST /api/rooms/join
 * Joins an existing room by inserting a row into room_members.
 * Returns a list of current members in the room.
 */
// In your join endpoint (rooms/join route):
router.post("/join", async (req, res) => {
  try {
    const { userId, roomCode } = joinRoomSchema.parse(req.body);

    // Check if room exists
    const { data: roomData, error: roomError } = await supabase
      .from("rooms")
      .select("*")
      .eq("code", roomCode)
      .single();
    if (roomError || !roomData) {
      return res.status(404).json({ error: "Room not found" });
    }
    // Check if the room is finished (active === false)
    if (roomData.active === false) {
      return res.status(400).json({ error: "Meeting is finished." });
    }

    // Check if user is already in room
    const { data: existingMember, error: memberError } = await supabase
      .from("room_members")
      .select("*")
      .eq("room_code", roomCode)
      .eq("user_id", userId)
      .maybeSingle();

    if (memberError) throw memberError;

    if (!existingMember) {
      // Try to add the user to the room
      const { error: joinError } = await supabase
        .from("room_members")
        .insert([{ room_code: roomCode, user_id: userId }]);
      // If a duplicate key error happens, treat it as already joined
      if (joinError) {
        if (joinError.code === "23505") {
          // Already exists, so we don't need to insert again
          console.log("User already in room, skipping insert.");
        } else {
          throw joinError;
        }
      }
    }
    // Fetch updated list of room members
    const { data: members, error: fetchMembersError } = await supabase
      .from("room_members")
      .select(`user:users(id, display_name)`)
      .eq("room_code", roomCode);
    if (fetchMembersError) throw fetchMembersError;

    const participantList = members.map((member: any) => ({
      id: member.user.id,
      displayName: member.user.display_name,
    }));

    return res.status(200).json({
      message: existingMember ? "Already in room" : "Successfully joined room",
      members: participantList,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error("Room joining error:", error);
      res.status(500).json({ error: "Failed to join room" });
    }
  }
});

/**
 * Helper function to get all room members with user info (id, display_name)
 */
async function getRoomMembers(roomCode: string) {
  const { data, error } = await supabase
    .from("room_members")
    .select(
      `
      user:users(
        id,
        display_name
      )
    `
    )
    .eq("room_code", roomCode);

  if (error) {
    console.error("Error fetching room members:", error);
    return [];
  }

  // Transform to a simpler structure
  return data.map((member: any) => ({
    id: member.user.id,
    displayName: member.user.display_name,
  }));
}

// PATCH /api/rooms/finish/:roomCode
router.patch("/finish/:roomCode", async (req, res) => {
  const { roomCode } = req.params;
  try {
    const { data, error } = await supabase
      .from("rooms")
      .update({ active: false })
      .eq("code", roomCode);
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json(data);
  } catch (err) {
    return res.status(400).json({ error: err });
  }
});

export const roomsRouter = router;
