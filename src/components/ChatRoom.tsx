import React, { useRef, useState, useEffect, useCallback } from 'react';
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // WebRTC and Speech-to-Text state variables
  const [peerConnections, setPeerConnections] = useState<{ [key: string]: RTCPeerConnection }>({});
  const [remoteStreams, setRemoteStreams] = useState<{ [key: string]: MediaStream }>({});
  const [subtitles, setSubtitles] = useState<{ [key: string]: string }>({});
  const [recognition, setRecognition] = useState<any>(null);

  // Initialize Socket.IO on mount
  useEffect(() => {
    const newSocket = io('http://localhost:3000');
    setSocket(newSocket);
    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);  

  const leaveRoom = async () => {
    if (!roomCode || !userId) return;
    try {
      // Remove the user from room_members
      const resp = await fetch(`http://localhost:3000/api/room-members/${roomCode}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (!resp.ok) {
        console.error('Failed to leave room:', await resp.text());
        return;
      }
      console.log('Left room successfully.');
  
      // Check if the room_members table is now empty for that room
      const resMembers = await fetch(`http://localhost:3000/api/room-members/${roomCode}`);
      const membersData = await resMembers.json();
      if (Array.isArray(membersData) && membersData.length === 0) {
        // Delete the room from the rooms table
        const resDeleteRoom = await fetch(`http://localhost:3000/api/rooms/${roomCode}`, {
          method: 'DELETE',
        });
        if (!resDeleteRoom.ok) {
          console.error('Failed to delete room:', await resDeleteRoom.text());
        } else {
          console.log('Room deleted successfully.');
        }
        // Delete all messages associated with that room
        const resDeleteMessages = await fetch(`http://localhost:3000/api/messages/${roomCode}`, {
          method: 'DELETE',
        });
        if (!resDeleteMessages.ok) {
          console.error('Failed to delete messages:', await resDeleteMessages.text());
        } else {
          console.log('Messages deleted successfully.');
        }
      }
    } catch (error) {
      console.error('Error leaving room:', error);
    }
  };  
  
  useEffect(() => {
    if (!socket) return;
  
    const handleParticipantJoined = (data: { participant: Participant }) => {
      setParticipants((prev) => {
        if (!prev.find((p) => p.id === data.participant.id)) {
          return [...prev, data.participant];
        }
        return prev;
      });
      // Optionally, re-run your logic to establish a peer connection with the new participant.
    };
  
    socket.on('participant_joined', handleParticipantJoined);
    return () => {
      socket.off('participant_joined', handleParticipantJoined);
    };
  }, [socket]);
  
  // Function to create a WebRTC peer connection
  const createPeerConnection = (targetUserId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection();
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice_candidate', { fromUserId: userId, targetUserId, candidate: event.candidate } as IceCandidateData);
      }
    };
    pc.ontrack = (event) => {
      console.log(`Received stream from ${targetUserId}`, event.streams[0]);
      setRemoteStreams((prev) => ({ ...prev, [targetUserId]: event.streams[0] }));
    };
    return pc;
  };

  useEffect(() => {
    if (isAudioEnabled && socket) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          console.log('Microphone stream acquired:', stream);
          // For each participant that doesn't already have a peer connection, create one:
          participants.forEach((p) => {
            if (p.id !== userId && !peerConnections[p.id]) {
              const pc = createPeerConnection(p.id);
              stream.getTracks().forEach((track) => pc.addTrack(track, stream));
              setPeerConnections((prev) => ({ ...prev, [p.id]: pc }));
              pc.createOffer()
                .then((offer) => {
                  pc.setLocalDescription(offer);
                  socket.emit('offer', { fromUserId: userId, targetUserId: p.id, offer } as OfferData);
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
  }, [isAudioEnabled, participants, userId, socket, peerConnections]);  

  // Handle WebRTC signaling
  useEffect(() => {
    if (!socket) return;

    socket.on('offer', async (data: OfferData) => {
      console.log('Received offer from', data.fromUserId);
      const { fromUserId, offer } = data;
      const pc = createPeerConnection(fromUserId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { fromUserId: userId, targetUserId: fromUserId, answer } as AnswerData);
      setPeerConnections((prev) => ({ ...prev, [fromUserId]: pc }));
    });

    socket.on('answer', async (data: AnswerData) => {
      console.log('Received answer from', data.fromUserId);
      const { fromUserId, answer } = data;
      const pc = peerConnections[fromUserId];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on('ice_candidate', async (data: IceCandidateData) => {
      console.log('Received ICE candidate from', data.fromUserId);
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

  // Initialize speech recognition
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

  // Join the room via backend + Socket.IO
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

  // Fetch participants
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

  // Fetch initial messages
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

  // Fetch QR code
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

  // On mount, join room and fetch data
  useEffect(() => {
    if (roomCode && userId) {
      fetchMessages();
      joinRoom();
      fetchParticipants();
      fetchRoomDetails();
    }
  }, [roomCode, userId, joinRoom, fetchMessages, fetchParticipants, fetchRoomDetails]);

  // Listen for new chat messages
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

  // Listen for presence updates
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

  // Send message via socket
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).substring(2),
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

  // Copy QR to clipboard
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

  // Render
  return (
    <div className="min-h-screen flex flex-col">
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
              className={`p-2 rounded-lg ${
                isAudioEnabled ? 'bg-primary/30 text-primary' : 'bg-secondary/30 text-muted-foreground'
              } hover:bg-primary/20 transition`}
            >
              {isAudioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </button>
            <button
              onClick={handleCopyRoomCode}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                copied ? 'bg-purple-600' : 'bg-gradient-to-r from-indigo-500 to-purple-500'
              } text-white shadow-lg hover:shadow-xl transition-transform font-semibold duration-300 transform hover:brightness-90`}
            >
              <Copy className="w-5 h-5" />
              {copied ? 'Copied!' : 'Copy QR'}
            </button>
            <button
              onClick={() => {
                leaveRoom();
                onLeave();
              }}
              className="button-gradient py-2 px-4 rounded-lg text-white font-semibold hover:brightness-110 transition"
            >
              Leave Room
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto p-6 flex gap-6">
        <div className="flex-1 glass-panel rounded-lg flex flex-col h-[600px]">
        <div className="flex-1 p-4 space-y-4 overflow-y-auto rounded-lg scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-300">
            <div className="mb-4">
              {Object.entries(subtitles).map(([speakerId, transcript]) => (
                <p key={speakerId} className="text-sm text-gray-500">
                  {participants.find((p) => p.id === speakerId)?.displayName || 'Unknown'}: {transcript}
                </p>
              ))}
            </div>
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
            <div ref={messagesEndRef} />
          </div>
          {Object.entries(remoteStreams).map(([userId, stream]) => (
            <audio
              key={userId}
              ref={(audio) => {
                if (audio) {
                  audio.srcObject = stream;
                  console.log(`Playing stream for ${userId}`);
                }
              }}
              autoPlay
            />
          ))}
          <form onSubmit={handleSendMessage} className="border-t border-secondary p-4">
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
        <div className="w-80 glass-panel rounded-xl p-4 min-h-[400px] overflow-y-auto">
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
        {/* Remote Audio Streams (hidden) */}
        <div className="hidden">
          {Object.entries(remoteStreams).map(([peerId, stream]) => (
            <audio
              key={peerId}
              autoPlay
              ref={(audio) => {
                if (audio && stream) {
                  audio.srcObject = stream;
                }
              }}
            />
          ))}
        </div>
      </main>
    </div>
  );
}