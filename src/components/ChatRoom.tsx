import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import io from 'socket.io-client';
import { Mic, MicOff, Send, User, Video, VideoOff, Copy } from 'lucide-react';

interface Message {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  display_name: string;
}

interface Participant {
  id: string;
  displayName: string;
}

interface ChatRoomProps {
  username: string;
  userId: string;
  onLeave: () => void;
}

export function ChatRoom({ username, userId, onLeave }: ChatRoomProps) {
  const { roomCode } = useParams<{ roomCode: string }>();

  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [qrCode, setQrCode] = useState<string>('');
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [copied, setCopied] = useState(false);

  const [socket, setSocket] = useState<any>(null);

  // 1) Initialize Socket.IO on mount
  useEffect(() => {
    const newSocket = io('http://localhost:3000'); // Adjust if needed
    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // 2) Join the room via your backend + Socket.IO
  const joinRoom = useCallback(async () => {
    if (!roomCode || !userId) return;

    try {
      // A) Call your backend to join the room (inserts row into room_members)
      const resp = await fetch('http://localhost:3000/api/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, roomCode }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        console.error('Join room error:', data.error || data);
      } else {
        console.log('Joined room successfully:', data);
        // B) Fetch updated participants
        fetchParticipants();
      }

      // C) Join the Socket.IO room
      if (socket) {
        socket.emit('join_room', roomCode);
      }
    } catch (err) {
      console.error('Error joining room:', err);
    }
  }, [roomCode, userId, socket]);

  // 3) Fetch participants from /api/room-members
  const fetchParticipants = useCallback(async () => {
    if (!roomCode) return;
    try {
      const res = await fetch(`http://localhost:3000/api/room-members/${roomCode}`);
      const data = await res.json();
      setParticipants(data);
    } catch (error) {
      console.error('Error fetching participants:', error);
    }
  }, [roomCode]);

  // 4) Fetch initial messages from /api/messages
  const fetchMessages = useCallback(async () => {
    if (!roomCode) return;
    try {
      const res = await fetch(`http://localhost:3000/api/messages/${roomCode}`);
      const data = await res.json();
      setMessages(data);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  }, [roomCode]);

  // 5) Fetch QR code from /api/rooms/{roomCode}
  const fetchRoomDetails = useCallback(async () => {
    if (!roomCode) return;
    try {
      const res = await fetch(`http://localhost:3000/api/rooms/${roomCode}`);
      const data = await res.json();
      setQrCode(data.qr_code);
    } catch (error) {
      console.error('Error fetching room details:', error);
    }
  }, [roomCode]);

  // On mount/updates, join the room, fetch messages & participants, etc.
  useEffect(() => {
    if (roomCode && userId) {
      joinRoom();         // ensures user is in DB + socket room
      fetchMessages();    // loads initial messages
      fetchParticipants(); // loads participants
      fetchRoomDetails(); // loads QR
    }
  }, [roomCode, userId, joinRoom, fetchMessages, fetchParticipants, fetchRoomDetails]);

  // 6) Listen for new chat messages from the server
  useEffect(() => {
    if (!socket) return;
    const handleChatMessage = (data: { userId: string; message: string; timestamp: string }) => {
      // Attempt to find the user’s display name from participants
      const participant = participants.find((p) => p.id === data.userId);
      const displayName = participant ? participant.displayName : data.userId;

      const newMsg: Message = {
        id: Math.random().toString(36).substring(2),
        user_id: data.userId,
        content: data.message,
        created_at: data.timestamp,
        display_name: displayName,
      };
      setMessages((prev) => [...prev, newMsg]);
    };
    socket.on('chat_message', handleChatMessage);

    return () => {
      socket.off('chat_message', handleChatMessage);
    };
  }, [socket, participants]);

  // 7) Listen for presence updates (optional)
  useEffect(() => {
    if (!socket) return;
    const handlePresenceUpdate = (onlineUserIds: string[]) => {
      console.log('Presence update:', onlineUserIds);
      // Optionally, you can merge this info with participants
      // e.g. set an "online" field
    };
    socket.on('presence_update', handlePresenceUpdate);

    return () => {
      socket.off('presence_update', handlePresenceUpdate);
    };
  }, [socket]);
  
  // 8) Send message via socket (no local duplication)
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !socket || !roomCode) return;

    // Emit the chat message event with userId
    socket.emit('chat_message', {
      roomCode,
      message,
      userId,
    });

    // Clear local input
    setMessage('');
  };

  // 9) Copy QR to clipboard
  const handleCopyRoomCode = async () => {
    if (qrCode) {
      try {
        const res = await fetch(qrCode);
        const blob = await res.blob();
        await navigator.clipboard.write([
          new ClipboardItem({
            [blob.type]: blob,
          }),
        ]);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy image to clipboard', err);
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="glass-panel py-4 px-6">
        <div className="container mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Room: {roomCode}
            </h1>
            <p className="text-sm text-muted-foreground">Connected as {username}</p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handleCopyRoomCode}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg hover:shadow-xl transition duration-300 ease-in-out transform hover:-translate-y-0.5"
            >
              <Copy className="w-5 h-5" />
              {copied ? 'QR Copied!' : 'Copy QR'}
            </button>
            <button
              onClick={() => setIsAudioEnabled(!isAudioEnabled)}
              className={`p-2 rounded-lg ${isAudioEnabled ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'}`}
            >
              {isAudioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </button>
            <button
              onClick={() => setIsVideoEnabled(!isVideoEnabled)}
              className={`p-2 rounded-lg ${isVideoEnabled ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'}`}
            >
              {isVideoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            </button>
            <button
              onClick={onLeave}
              className="button-gradient py-2 px-4 rounded-lg text-white font-medium"
            >
              Leave Room
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto p-6 flex gap-6">
        {/* Chat Section */}
        <div className="flex-1 glass-panel rounded-xl flex flex-col">
          <div className="flex-1 p-4 space-y-4 overflow-y-auto">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex items-start gap-3 ${msg.user_id === userId ? 'flex-row-reverse' : ''}`}
              >
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                  <User className="w-4 h-4" />
                </div>
                <div className={`glass-panel rounded-lg p-3 max-w-[70%] ${msg.user_id === userId ? 'bg-primary/20' : ''}`}>
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-sm">{msg.display_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(msg.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <p>{msg.content}</p>
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={handleSendMessage} className="p-4 border-t border-secondary">
            <div className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 rounded-lg input-style p-2"
              />
              <button type="submit" className="button-gradient p-2 rounded-lg text-white" disabled={!message.trim()}>
                <Send className="w-5 h-5" />
              </button>
            </div>
          </form>
        </div>

        {/* Participants Section */}
        <div className="w-80 glass-panel rounded-xl p-4">
          <h2 className="font-semibold mb-4">Participants</h2>
          <div className="space-y-2">
            {participants.map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg bg-secondary/50">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <span className="flex-1">
                  {p.displayName} {p.id === userId && '(You)'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
