import React, { useRef, useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import io from "socket.io-client";
import { Mic, MicOff, Send, User, Copy } from "lucide-react";

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
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [qrCode, setQrCode] = useState<string>("");
  const [isAudioEnabled, setIsAudioEnabled] = useState(() => {
    const saved = localStorage.getItem("isAudioEnabled");
    return saved ? JSON.parse(saved) : false;
  });
  const [copied, setCopied] = useState(false);
  const [socket, setSocket] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // WebRTC and Speech-to-Text state variables
  const peerConnectionsRef = useRef<{ [key: string]: RTCPeerConnection }>({});
  const [remoteStreams, setRemoteStreams] = useState<{
    [key: string]: MediaStream;
  }>({});
  const [subtitles, setSubtitles] = useState<{ [key: string]: string }>({});
  const [recognition, setRecognition] = useState<any>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);

  // Initialize Socket.IO on mount
  useEffect(() => {
    const newSocket = io(`${import.meta.env.VITE_BACKEND_URL}`);
    setSocket(newSocket);
    return () => {
      newSocket.disconnect();
    };
  }, []);

  const participantsRef = useRef<Participant[]>([]);
  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    localStorage.setItem("isAudioEnabled", JSON.stringify(isAudioEnabled));
  }, [isAudioEnabled]);

  const leaveRoom = async () => {
    if (!roomCode || !userId) return;
    try {
      // 1. Remove the user from room_members
      const resp = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/room-members/${roomCode}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        }
      );
      if (!resp.ok) {
        console.error("Failed to leave room:", await resp.text());
        return;
      }
      console.log("Left room successfully.");

      // 2. Check if there are still members in the room
      const resMembers = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/room-members/${roomCode}`
      );
      const membersData = await resMembers.json();

      // If no members remain, mark the room as finished (active: false)
      if (Array.isArray(membersData) && membersData.length === 0) {
        const resFinish = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/rooms/finish/${roomCode}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
          }
        );
        if (!resFinish.ok) {
          console.error(
            "Failed to mark room as finished:",
            await resFinish.text()
          );
        } else {
          console.log("Room marked as finished.");
        }
        // Optionally, delete the room messages as well:
        const resDeleteMessages = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/messages/${roomCode}`,
          {
            method: "DELETE",
          }
        );
        if (!resDeleteMessages.ok) {
          console.error(
            "Failed to delete messages:",
            await resDeleteMessages.text()
          );
        } else {
          console.log("Messages deleted successfully.");
        }
      }
    } catch (error) {
      console.error("Error leaving room:", error);
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
    };

    socket.on("participant_joined", handleParticipantJoined);
    return () => {
      socket.off("participant_joined", handleParticipantJoined);
    };
  }, [socket]);

  // Listen for presence updates to track online users
  useEffect(() => {
    if (!socket) return;
    const handlePresenceUpdate = (userIds: string[]) => {
      setOnlineUserIds(userIds);
    };
    socket.on("presence_update", handlePresenceUpdate);
    return () => {
      socket.off("presence_update", handlePresenceUpdate);
    };
  }, [socket]);

  // Function to create a WebRTC peer connection
  const createPeerConnection = (targetUserId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("Generated ICE candidate for", targetUserId);
        socket.emit("ice_candidate", {
          fromUserId: userId,
          targetUserId,
          candidate: event.candidate,
        } as IceCandidateData);
      }
    };
    pc.ontrack = (event) => {
      console.log(`Received stream from ${targetUserId}`, event.streams[0]);
      console.log("Stream tracks:", event.streams[0].getTracks());
      setRemoteStreams((prev) => ({
        ...prev,
        [targetUserId]: event.streams[0],
      }));
    };
    pc.onconnectionstatechange = () => {
      console.log(`Connection state for ${targetUserId}: ${pc.connectionState}`);
    };
    return pc;
  };

  // Manage local audio stream
  useEffect(() => {
    if (isAudioEnabled) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          console.log("Microphone stream acquired:", stream);
          setLocalStream(stream);
        })
        .catch((err) => console.error("Error accessing microphone:", err));
    } else {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
        setLocalStream(null);
      }
      // Close all peer connections
      Object.values(peerConnectionsRef.current).forEach((pc) => {
        if (typeof pc.close === "function") {
          pc.close();
        }
      });
      peerConnectionsRef.current = {};
      setRemoteStreams({});
    }
  }, [isAudioEnabled]);

  // Manage WebRTC peer connections with online users
  useEffect(() => {
    if (!localStream || !socket) return;

    // Close connections for users who are no longer online
    Object.keys(peerConnectionsRef.current).forEach((userId) => {
      if (!onlineUserIds.includes(userId)) {
        peerConnectionsRef.current[userId].close();
        delete peerConnectionsRef.current[userId];
      }
    });

    // Create connections for online users
    onlineUserIds.forEach((targetUserId) => {
      if (targetUserId !== userId && !peerConnectionsRef.current[targetUserId]) {
        const pc = createPeerConnection(targetUserId);
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
        peerConnectionsRef.current[targetUserId] = pc;
        pc.createOffer()
          .then((offer) => {
            pc.setLocalDescription(offer);
            socket.emit("offer", { fromUserId: userId, targetUserId, offer });
          })
          .catch((err) => console.error("Error creating offer:", err));
      }
    });
  }, [onlineUserIds, localStream, userId, socket]);

  // Handle WebRTC signaling
  useEffect(() => {
    if (!socket) return;

    socket.on("offer", async (data: OfferData) => {
      console.log("Received offer from", data.fromUserId);
      const { fromUserId, offer } = data;
      const pc = createPeerConnection(fromUserId);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        console.log("Set remote description for offer from", fromUserId);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log("Created and set local description for answer");
        socket.emit("answer", {
          fromUserId: userId,
          targetUserId: fromUserId,
          answer,
        } as AnswerData);
        peerConnectionsRef.current[fromUserId] = pc;
      } catch (error) {
        console.error("Error handling offer:", error);
      }
    });

    socket.on("answer", async (data: AnswerData) => {
      console.log("Received answer from", data.fromUserId);
      const { fromUserId, answer } = data;
      const pc = peerConnectionsRef.current[fromUserId];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          console.log("Set remote description for answer from", fromUserId);
        } catch (error) {
          console.error("Error setting remote description for answer:", error);
        }
      } else {
        console.warn("No peer connection found for", fromUserId);
      }
    });

    socket.on("ice_candidate", async (data: IceCandidateData) => {
      console.log("Received ICE candidate from", data.fromUserId);
      const { fromUserId, candidate } = data;
      const pc = peerConnectionsRef.current[fromUserId];
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          console.log("Added ICE candidate from", fromUserId);
        } catch (error) {
          console.error("Error adding ICE candidate:", error);
        }
      } else {
        console.warn("No peer connection found for", fromUserId);
      }
    });

    return () => {
      socket.off("offer");
      socket.off("answer");
      socket.off("ice_candidate");
    };
  }, [socket, userId]);

  // Initialize speech recognition
  useEffect(() => {
    if (isAudioEnabled && "webkitSpeechRecognition" in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition;
      const recog = new SpeechRecognition();
      recog.continuous = true;
      recog.interimResults = true;
      recog.maxAlternatives = 5;
      recog.lang = "en-US";

      recog.onresult = (event: any) => {
        let interimTranscript = "";
        let finalTranscript = "";

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
          const newMsg: Message = {
            id: crypto.randomUUID(),
            user_id: userId,
            content: finalTranscript,
            created_at: new Date().toISOString(),
            display_name: username,
          };
          setMessages((prev) => [...prev, newMsg]);
          socket.emit("chat_message", { roomCode, message: finalTranscript, userId });
          setSubtitles((prev) => {
            const newSubs = { ...prev };
            delete newSubs[userId];
            return newSubs;
          });
        }
      };

      recog.onerror = (event: any) =>
        console.error("Speech recognition error:", event.error);
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

  // Fetch participants
  const fetchParticipants = useCallback(async () => {
    if (!roomCode) return;
    try {
      const res = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/room-members/${roomCode}`
      );
      const data = await res.json();
      setParticipants(data);
    } catch (error) {
      console.error("Error fetching participants:", error);
    }
  }, [roomCode]);

  const joinRoom = useCallback(async () => {
    if (!roomCode || !userId || !socket) return;
    try {
      const resp = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/rooms/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, roomCode }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        console.error("Join room error:", data.error || data);
      } else {
        console.log("Joined room successfully:", data);
        console.log("Joining room with userId:", userId);
        fetchParticipants();
      }
      socket.emit("join_room", { roomCode, userId, displayName: username });
    } catch (err) {
      console.error("Error joining room:", err);
    }
  }, [roomCode, userId, socket, fetchParticipants]);

  // Fetch initial messages
  const fetchMessages = useCallback(async () => {
    if (!roomCode) return;
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/messages/${roomCode}`);
      const data = await res.json();
      setMessages(data);
    } catch (error) {
      console.error("Error fetching messages:", error);
    }
  }, [roomCode]);

  // Fetch QR code
  const fetchRoomDetails = useCallback(async () => {
    if (!roomCode) return;
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/rooms/${roomCode}`);
      const data = await res.json();
      setQrCode(data.qr_code);
    } catch (error) {
      console.error("Error fetching room details:", error);
    }
  }, [roomCode]);

  useEffect(() => {
    if (roomCode && userId) {
      const initializeRoom = async () => {
        await fetchMessages();
        await joinRoom();
        await fetchParticipants();
        await fetchRoomDetails();
      };
      initializeRoom();
    }
  }, [roomCode, userId]);

  useEffect(() => {
    if (!socket) return;
    const handleChatMessage = (data: { userId: string; message: string; timestamp: string }) => {
      const displayName =
        participantsRef.current.find((p) => p.id === data.userId)?.displayName ||
        "Anonymous";
      const newMsg: Message = {
        id: crypto.randomUUID(),
        user_id: data.userId,
        content: data.message,
        created_at: data.timestamp,
        display_name: displayName,
      };
      setMessages((prev) => [...prev, newMsg]);
    };

    socket.on("chat_message", handleChatMessage);
    return () => {
      socket.off("chat_message", handleChatMessage);
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
      socket.emit("chat_message", { roomCode, message, userId });
      setMessage("");
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
        console.error("Failed to copy image to clipboard", err);
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
                isAudioEnabled
                  ? "bg-primary/30 text-primary"
                  : "bg-secondary/30 text-muted-foreground"
              } hover:bg-primary/20 transition`}
            >
              {isAudioEnabled ? (
                <Mic className="w-5 h-5" />
              ) : (
                <MicOff className="w-5 h-5" />
              )}
            </button>
            <button
              onClick={handleCopyRoomCode}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                copied
                  ? "bg-purple-600"
                  : "bg-gradient-to-r from-indigo-500 to-purple-500"
              } text-white shadow-lg hover:shadow-xl transition-transform font-semibold duration-300 transform hover:brightness-90`}
            >
              <Copy className="w-5 h-5" />
              {copied ? "Copied!" : "Copy QR"}
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
      <main className="container mx-auto p-6 flex gap-6 h-[calc(100vh-90px)] overflow-hidden">
        <div className="flex-1 glass-panel rounded-lg flex flex-col overflow-hidden">
        <div className="flex-1 p-4 space-y-4 overflow-y-auto rounded-lg scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent" 
         style={{scrollbarColor: "rgba(128, 128, 128, 0.3) transparent"}}>
            <div className="mb-4">
              {Object.entries(subtitles).map(([speakerId, transcript]) => (
                <p key={speakerId} className="text-sm text-gray-500">
                  {participants.find((p) => p.id === speakerId)?.displayName ||
                    "Unknown"}
                  : {transcript}
                </p>
              ))}
            </div>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex items-start gap-3 ${
                  msg.user_id === userId ? "flex-row-reverse" : ""
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                  <User className="w-4 h-4" />
                </div>
                <div
                  className={`glass-panel rounded-lg p-3 max-w-[70%] ${
                    msg.user_id === userId ? "bg-primary/20" : ""
                  }`}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-sm">
                      {msg.display_name}
                    </span>
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
          <form
            onSubmit={handleSendMessage}
            className="border-t border-secondary p-4"
          >
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
        <div className="w-80 glass-panel rounded-lg p-6 min-h-[400px] overflow-y-auto">
          <h2 className="font-semibold mb-4">Participants</h2>
          <div className="space-y-2">
            {participants.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 p-2 rounded-lg bg-secondary/50"
              >
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <span className="flex-1">
                  {p.displayName} {p.id === userId && "(You)"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}