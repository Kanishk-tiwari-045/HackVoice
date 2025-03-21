import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import io from 'socket.io-client';
import { Mic, MicOff, Send, User, Copy } from 'lucide-react';

// Interfaces
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

  // Define interfaces for socket event data
  interface OfferData {
    fromUserId: string;
    targetUserId: string;
    offer: RTCSessionDescriptionInit;
  }
  
  interface AnswerData {
    fromUserId: string;
    targetUserId: string;
    answer: RTCSessionDescriptionInit;
  }
  
  interface IceCandidateData {
    fromUserId: string;
    targetUserId: string;
    candidate: RTCIceCandidate;
  }

export function ChatRoom({ username, userId, onLeave }: ChatRoomProps) {
  const { roomCode } = useParams<{ roomCode: string }>();

  // Core state variables
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [qrCode, setQrCode] = useState<string>('');
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [socket, setSocket] = useState<any>(null);

  // WebRTC and Speech-to-Text state variables
  const [peerConnections, setPeerConnections] = useState<{ [key: string]: RTCPeerConnection }>({});
  const [remoteStreams, setRemoteStreams] = useState<{ [key: string]: MediaStream }>({});
  const [subtitles, setSubtitles] = useState<{ [key: string]: string }>({});
  const [recognition, setRecognition] = useState<any>(null);

  // **1) Initialize Socket.IO on mount**
  useEffect(() => {
    const newSocket = io('http://localhost:3000'); // Adjust URL if needed
    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

// Function to create a WebRTC peer connection
const createPeerConnection = (targetUserId: string): RTCPeerConnection => {
  const pc = new RTCPeerConnection();
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice_candidate', { targetUserId, candidate: event.candidate } as IceCandidateData);
    }
  };
  pc.ontrack = (event) => {
    setRemoteStreams((prev) => ({ ...prev, [targetUserId]: event.streams[0] }));
  };
  return pc;
};

// Handle audio stream when mic is enabled
useEffect(() => {
  if (isAudioEnabled && socket) {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        participants.forEach((p) => {
          if (p.id !== userId) {
            const pc = createPeerConnection(p.id);
            stream.getTracks().forEach((track) => pc.addTrack(track, stream));
            setPeerConnections((prev) => ({ ...prev, [p.id]: pc }));
            pc.createOffer()
              .then((offer) => {
                pc.setLocalDescription(offer);
                socket.emit('offer', { targetUserId: p.id, offer } as OfferData);
              })
              .catch((err) => console.error('Error creating offer:', err));
          }
        });
      })
      .catch((err) => console.error('Error accessing microphone:', err));
  } else {
    Object.values(peerConnections).forEach((pc) => pc.close());
    setPeerConnections({});
    setRemoteStreams({});
  }
}, [isAudioEnabled, participants, userId, socket]);

// Handle WebRTC signaling
useEffect(() => {
  if (!socket) return;

  socket.on('offer', async (data: OfferData) => {
    const { fromUserId, offer } = data;
    const pc = createPeerConnection(fromUserId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { targetUserId: fromUserId, answer } as AnswerData);
    setPeerConnections((prev) => ({ ...prev, [fromUserId]: pc }));
  });

  socket.on('answer', async (data: AnswerData) => {
    const { fromUserId, answer } = data;
    const pc = peerConnections[fromUserId];
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  });

  socket.on('ice_candidate', async (data: IceCandidateData) => {
    const { fromUserId, candidate } = data;
    const pc = peerConnections[fromUserId];
    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  });

  return () => {
    socket.off('offer');
    socket.off('answer');
    socket.off('ice_candidate');
  };
}, [socket, peerConnections, userId]);

  // **4) Initialize speech recognition**
  useEffect(() => {
    if (isAudioEnabled && 'webkitSpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition;
      const recog = new SpeechRecognition();
      recog.continuous = true;
      recog.interimResults = true;
      recog.lang = 'en-US';

      recog.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        if (interimTranscript) {
          setSubtitles((prev) => ({ ...prev, [userId]: interimTranscript }));
        }

        if (finalTranscript) {
          socket.emit('chat_message', { roomCode, message: finalTranscript, userId });
          setSubtitles((prev) => {
            const newSubtitles = { ...prev };
            delete newSubtitles[userId];
            return newSubtitles;
          });
        }
      };

      recog.onerror = (event: any) => console.error('Speech recognition error:', event.error);
      recog.start();
      setRecognition(recog);

      return () => {
        recog.stop();
      };
    } else if (!isAudioEnabled && recognition) {
      recognition.stop();
      setRecognition(null);
    }
  }, [isAudioEnabled, userId, roomCode, socket]);

  // **5) Join the room via backend + Socket.IO**
  const joinRoom = useCallback(async () => {
    if (!roomCode || !userId) return;

    try {
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
        fetchParticipants();
      }

      if (socket) {
        socket.emit('join_room', roomCode);
      }
    } catch (err) {
      console.error('Error joining room:', err);
    }
  }, [roomCode, userId, socket]);

  // **6) Fetch participants**
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

  // **7) Fetch initial messages**
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

  // **8) Fetch QR code**
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

  // **9) On mount, join room and fetch data**
  useEffect(() => {
    if (roomCode && userId) {
      fetchMessages();
      joinRoom();
      fetchParticipants();
      fetchRoomDetails();
    }
  }, [roomCode, userId, joinRoom, fetchMessages, fetchParticipants, fetchRoomDetails]);

  // **10) Listen for new chat messages**
  useEffect(() => {
    if (!socket) return;

    const handleChatMessage = (data: { userId: string; message: string; timestamp: string }) => {
      const participant = participants.find((p) => p.id === data.userId);
      const displayName = participant?.displayName || 'Anonymous';

      const newMsg: Message = {
        id: crypto.randomUUID(),
        user_id: data.userId,
        content: data.message,
        created_at: data.timestamp,
        display_name: displayName,
      };

      setMessages((prevMessages) => [...prevMessages, newMsg]);
    };

    socket.on('chat_message', handleChatMessage);

    return () => {
      socket.off('chat_message', handleChatMessage);
    };
  }, [socket, participants]);

  // **11) Listen for presence updates (optional)**
  useEffect(() => {
    if (!socket) return;
    const handlePresenceUpdate = (onlineUserIds: string[]) => {
      console.log('Presence update:', onlineUserIds);
    };
    socket.on('presence_update', handlePresenceUpdate);

    return () => {
      socket.off('presence_update', handlePresenceUpdate);
    };
  }, [socket]);

  // **12) Send message via socket**
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(2), // Temporary ID
          user_id: userId,
          content: message,
          created_at: new Date().toISOString(),
          display_name: username,
        },
      ]);

      socket.emit('chat_message', { roomCode, message, userId });
      setMessage('');
    }
  };

  // **13) Copy QR to clipboard**
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

  // **Render**
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="glass-panel py-4 px-6 shadow-md">
        <div className="container mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Room: {roomCode}
            </h1>
            <p className="text-sm text-gray-400">Connected as {userId}</p>
          </div>
          <div className="flex items-center gap-4">
          <button
              onClick={() => setIsAudioEnabled(!isAudioEnabled)}
              className={`p-2 rounded-[10px] ${
                isAudioEnabled ? 'bg-primary/30 text-primary' : 'bg-secondary/30 text-muted-foreground'
              } hover:bg-primary/20 transition`}
            >
              {isAudioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </button>
            <button
              onClick={handleCopyRoomCode}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                copied ? 'bg-green-500' : 'bg-gradient-to-r from-indigo-500 to-purple-600'
              } text-white shadow-lg hover:shadow-xl transition-transform duration-300 transform hover:-translate-y-0.5`}
            >
              <Copy className="w-5 h-5" />
              {copied ? 'Copied!' : 'Copy QR'}
            </button>
            <button
              onClick={onLeave}
              className="button-gradient py-2 px-4 rounded-lg text-white font-semibold hover:brightness-110 transition"
            >
              Leave Room
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto p-6 flex gap-6">
      {/* Chat Section */}
      <div className="flex-1 glass-panel rounded-xl flex flex-col h-full">
        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
          {/* Subtitles Area */}
          <div className="mb-4">
            {Object.entries(subtitles).map(([speakerId, transcript]) => (
              <p key={speakerId} className="text-sm text-gray-500">
                {participants.find((p) => p.id === speakerId)?.displayName || 'Unknown'}: {transcript}
              </p>
            ))}
          </div>
          {/* Chat Messages */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex items-start gap-3 ${msg.user_id === userId ? 'flex-row-reverse' : ''}`}
            >
              <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                <User className="w-4 h-4" />
              </div>
              <div
                className={`glass-panel rounded-lg p-3 max-w-[70%] ${
                  msg.user_id === userId ? 'bg-primary/20' : ''
                }`}
              >
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
        {/* Audio Elements for Remote Streams */}
        {Object.entries(remoteStreams).map(([userId, stream]) => (
          <audio key={userId} ref={(audio) => audio && (audio.srcObject = stream)} autoPlay />
        ))}
        {/* Message Input */}
        <form onSubmit={handleSendMessage} className="p-4 border-t border-secondary">
          <div className="flex gap-2">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 rounded-lg input-style p-2"
            />
            <button
              type="submit"
              className="button-gradient p-2 rounded-lg text-white"
              disabled={!message.trim()}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </form>
      </div>
      {/* Participants Section */}
      <div className="w-80 glass-panel rounded-xl p-4 h-full overflow-y-auto">
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