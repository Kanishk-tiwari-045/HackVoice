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

// Add this type declaration at the top of your file, before your component imports
declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

interface Participant {
  id: string;
  displayName: string;
  isOnline?: boolean;
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
  const messagesRef = useRef({ fetched: false });
  const roomJoinedRef = useRef(false);
  const socketConnectedRef = useRef(false);
  const subtitleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSubtitles = useRef<{ [key: string]: string }>({});

  // WebRTC and Speech-to-Text state variables
  const peerConnectionsRef = useRef<{ [key: string]: RTCPeerConnection }>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<{
    [key: string]: MediaStream;
  }>({});
  const [subtitles, setSubtitles] = useState<{ [key: string]: string }>({});
  const [recognition, setRecognition] = useState<any>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const audioElements = useRef<{ [key: string]: HTMLAudioElement | null }>({});

  // Keep track of participants in a ref for access in callbacks
  const participantsRef = useRef<Participant[]>([]);
  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  // Initialize Socket.IO on mount with better error handling
  useEffect(() => {
    const socketUrl = import.meta.env.VITE_BACKEND_URL;
    
    try {
      const newSocket = io(socketUrl, {
        reconnectionAttempts: 5,
        timeout: 10000,
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000
      });
      
      newSocket.on('connect', () => {
        console.log('Socket connected successfully');
        socketConnectedRef.current = true;
        
        // If we reconnected and the room was previously joined, rejoin it
        if (roomJoinedRef.current && roomCode) {
          console.log("Reconnected, rejoining room:", roomCode);
          newSocket.emit("join_room", { 
            roomCode, 
            userId, 
            displayName: username 
          });
          
          // Reinitialize audio connections if they were enabled
          if (isAudioEnabled) {
            initializeAudioConnections();
          }
        }
      });
      
      newSocket.on('connect_error', (err: Error) => {
        console.error('Socket connection error:', err);
        socketConnectedRef.current = false;
      });
      
      newSocket.on('disconnect', (reason: string) => {
        console.log('Socket disconnected:', reason);
        socketConnectedRef.current = false;
      });
      
      setSocket(newSocket);
      
      return () => {
        console.log('Disconnecting socket');
        newSocket.disconnect();
      };
    } catch (err) {
      console.error("Error initializing socket:", err);
    }
  }, [roomCode, userId, username, isAudioEnabled]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Function to acquire microphone with increased sensitivity
  const getMicrophoneStream = async (): Promise<MediaStream | null> => {
    try {
      // Request microphone with optimized audio settings for increased sensitivity
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Attempting to increase sensitivity with these constraints
          channelCount: 1,
          sampleRate: 48000,
          sampleSize: 16
        }
      });
      
      console.log("Microphone stream acquired with optimized settings");
      
      // Attempt to boost audio gain if the browser supports it
      try {
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const gainNode = audioContext.createGain();
        
        // Increase gain (sensitivity)
        gainNode.gain.value = 1.5; // Boost by 50%
        
        source.connect(gainNode);
        const destination = audioContext.createMediaStreamDestination();
        gainNode.connect(destination);
        
        // Return the boosted stream if successful
        return destination.stream;
      } catch (gainErr) {
        console.warn("Could not apply gain boost, using original stream:", gainErr);
        // Fall back to original stream if gain adjustment fails
        return stream;
      }
    } catch (err) {
      console.error("Error accessing microphone:", err);
      return null;
    }
  };

  // Initialize audio connections
  const initializeAudioConnections = async () => {
    console.log("Initializing audio connections...");
    
    // Cleanup existing connections first
    closeAllPeerConnections();
    
    // Get microphone access
    const stream = await getMicrophoneStream();
    if (!stream) {
      console.error("Failed to acquire microphone stream");
      setIsAudioEnabled(false);
      return false;
    }
    
    localStreamRef.current = stream;
    
    // Initialize speech recognition
    const recognitionStarted = initSpeechRecognition();
    if (!recognitionStarted) {
      console.warn("Speech recognition failed to start");
    }
    
    // Connect to online users
    console.log("Initiating connections with online users:", onlineUserIds);
    onlineUserIds.forEach(targetUserId => {
      if (targetUserId !== userId) {
        initiatePeerConnection(targetUserId);
      }
    });
    
    return true;
  };

  // Persist audio preference and handle audio state changes
  useEffect(() => {
    localStorage.setItem("isAudioEnabled", JSON.stringify(isAudioEnabled));
    
    const setupAudio = async () => {
      if (isAudioEnabled) {
        const success = await initializeAudioConnections();
        if (!success) {
          console.error("Failed to initialize audio");
          setIsAudioEnabled(false);
        }
      } else {
        // Close existing connections when toggling audio off
        closeAllPeerConnections();
        
        // Stop speech recognition
        if (recognition) {
          recognition.stop();
          setRecognition(null);
        }
      }
    };
    
    setupAudio();
  }, [isAudioEnabled]);

  // Function to close and clean up all peer connections
  const closeAllPeerConnections = () => {
    Object.values(peerConnectionsRef.current).forEach((pc) => {
      if (pc && typeof pc.close === "function") {
        pc.close();
      }
    });
    peerConnectionsRef.current = {};
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    setRemoteStreams({});
    
    // Clear subtitles when audio is disabled
    setSubtitles({});
    pendingSubtitles.current = {};
    if (subtitleTimeoutRef.current) {
      clearTimeout(subtitleTimeoutRef.current);
      subtitleTimeoutRef.current = null;
    }
  };

  // Handle room leaving with proper cleanup
  const leaveRoom = async () => {
    if (!roomCode || !userId) return;
    try {
      console.log("Leaving room:", roomCode);
      
      // Clean up WebRTC connections
      closeAllPeerConnections();
      
      // Stop speech recognition if active
      if (recognition) {
        recognition.stop();
        setRecognition(null);
      }
      
      // Notify server about leaving
      if (socket && socket.connected) {
        socket.emit("leave_room", { roomCode, userId });
      }
      
      // Update room joined state to prevent reconnection attempts
      roomJoinedRef.current = false;
      
      // Remove from room_members in database
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
      } else {
        console.log("Left room successfully in database");

        // Check if room should be marked as finished
        const resMembers = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/room-members/${roomCode}`
        );
        
        if (resMembers.ok) {
          const membersData = await resMembers.json();

          if (Array.isArray(membersData) && membersData.length === 0) {
            console.log("No members left in room, marking as finished");
            const resFinish = await fetch(
              `${import.meta.env.VITE_BACKEND_URL}/api/rooms/finish/${roomCode}`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
              }
            );
            
            if (!resFinish.ok) {
              console.error("Failed to mark room as finished:", await resFinish.text());
            } else {
              console.log("Room marked as finished successfully");
              
              // Optionally delete messages
              const resDeleteMessages = await fetch(
                `${import.meta.env.VITE_BACKEND_URL}/api/messages/${roomCode}`,
                {
                  method: "DELETE",
                }
              );
              
              if (!resDeleteMessages.ok) {
                console.error("Failed to delete messages:", await resDeleteMessages.text());
              } else {
                console.log("Messages deleted successfully");
              }
            }
          }
        }
      }
      
      // Execute onLeave callback
      onLeave();
    } catch (error) {
      console.error("Error leaving room:", error);
      // Still try to execute onLeave even if there was an error
      onLeave();
    }
  };

  // Handle participant joining socket event
  useEffect(() => {
    if (!socket) return;

    const handleParticipantJoined = (data: { participant: Participant }) => {
      console.log("Participant joined:", data.participant);
      
      setParticipants((prev) => {
        // Only add if not already in list
        const existingIndex = prev.findIndex(p => p.id === data.participant.id);
        
        if (existingIndex === -1) {
          return [...prev, {...data.participant, isOnline: true}];
        }
        
        // Update online status if already in list
        const updated = [...prev];
        updated[existingIndex] = {...updated[existingIndex], isOnline: true};
        return updated;
      });
      
      // Update online users
      setOnlineUserIds(prev => {
        if (!prev.includes(data.participant.id)) {
          return [...prev, data.participant.id];
        }
        return prev;
      });
      
      // If audio is enabled, initiate connection with the new participant
      if (isAudioEnabled && localStreamRef.current && data.participant.id !== userId) {
        console.log("Initiating connection with new participant:", data.participant.id);
        setTimeout(() => {
          initiatePeerConnection(data.participant.id);
        }, 1000); // Small delay to ensure socket connection is stable
      }
    };

    const handleParticipantLeft = (data: { userId: string }) => {
      console.log("Participant left:", data.userId);
      
      // Update participant list
      setParticipants(prev => 
        prev.map(p => p.id === data.userId ? {...p, isOnline: false} : p)
      );
      
      // Update online users
      setOnlineUserIds(prev => prev.filter(id => id !== data.userId));
      
      // Close peer connection
      if (peerConnectionsRef.current[data.userId]) {
        peerConnectionsRef.current[data.userId].close();
        delete peerConnectionsRef.current[data.userId];
      }
      
      // Remove remote stream
      setRemoteStreams(prev => {
        const newStreams = {...prev};
        delete newStreams[data.userId];
        return newStreams;
      });
      
      // Remove subtitle
      setSubtitles(prev => {
        const newSubs = {...prev};
        delete newSubs[data.userId];
        return newSubs;
      });
    };

    socket.on("participant_joined", handleParticipantJoined);
    socket.on("participant_left", handleParticipantLeft);
    
    return () => {
      socket.off("participant_joined", handleParticipantJoined);
      socket.off("participant_left", handleParticipantLeft);
    };
  }, [socket, userId, isAudioEnabled]);

  // Listen for presence updates to track online users
  useEffect(() => {
    if (!socket) return;
    
    const handlePresenceUpdate = (userIds: string[]) => {
      console.log("Presence update received:", userIds);
      setOnlineUserIds(userIds);
      
      // Update all participants' online status
      setParticipants(prev => 
        prev.map(p => ({...p, isOnline: userIds.includes(p.id)}))
      );
      
      // If audio is enabled, check for new users to connect to
      if (isAudioEnabled && localStreamRef.current) {
        userIds.forEach(targetId => {
          if (targetId !== userId && !peerConnectionsRef.current[targetId]) {
            console.log("New online user detected, initiating connection:", targetId);
            initiatePeerConnection(targetId);
          }
        });
      }
    };
    
    socket.on("presence_update", handlePresenceUpdate);
    
    return () => {
      socket.off("presence_update", handlePresenceUpdate);
    };
  }, [socket, userId, isAudioEnabled]);

  // Handle incoming subtitles from other users
  useEffect(() => {
    if (!socket) return;
    
    const handleSubtitle = (data: { userId: string; text: string; displayName: string }) => {
      console.log("Received subtitle from", data.userId, ":", data.text);
      
      // Update subtitles state with the received text
      setSubtitles(prev => ({
        ...prev,
        [data.userId]: data.text
      }));
      
      // Clear subtitle after a timeout if it's not updated
      const clearTimer = setTimeout(() => {
        setSubtitles(prev => {
          if (prev[data.userId] === data.text) {
            const newSubs = {...prev};
            delete newSubs[data.userId];
            return newSubs;
          }
          return prev;
        });
      }, 5000);
      
      // Store timer reference to clear on component unmount
      return () => clearTimeout(clearTimer);
    };
    
    socket.on("subtitle", handleSubtitle);
    
    return () => {
      socket.off("subtitle", handleSubtitle);
    };
  }, [socket]);

  // Create a WebRTC peer connection with improved ICE configurations
  const createPeerConnection = (targetUserId: string): RTCPeerConnection => {
    console.log("Creating peer connection for target:", targetUserId);
    
    // Close existing connection if any
    if (peerConnectionsRef.current[targetUserId]) {
      peerConnectionsRef.current[targetUserId].close();
    }
    
    // Create new connection with more STUN/TURN servers for better NAT traversal
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" }
        // Add TURN servers here if available
        // { urls: 'turn:turn.example.org', username: 'user', credential: 'pass' }
      ],
      iceCandidatePoolSize: 10,
      iceTransportPolicy: 'all',
      rtcpMuxPolicy: 'require',
      bundlePolicy: 'max-bundle'
    });
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && socket && socket.connected) {
        console.log("Generated ICE candidate for", targetUserId);
        socket.emit("ice_candidate", {
          fromUserId: userId,
          targetUserId,
          candidate: event.candidate,
        } as IceCandidateData);
      }
    };
    
    // Log gathering state changes to debug ICE issues
    pc.onicegatheringstatechange = () => {
      console.log(`ICE gathering state for ${targetUserId}: ${pc.iceGatheringState}`);
    };
    
    // Handle ICE connection state changes
    pc.oniceconnectionstatechange = () => {
      console.log(`ICE connection state for ${targetUserId}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        console.log("Trying to restart ICE for connection with", targetUserId);
        pc.restartIce();
      }
    };
    
    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`Connection state for ${targetUserId}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed') {
        console.log("Attempting to reconnect with", targetUserId);
        // Recreate the connection after a brief delay
        setTimeout(() => {
          if (isAudioEnabled && localStreamRef.current) {
            initiatePeerConnection(targetUserId);
          }
        }, 2000);
      }
    };
    
    // Handle tracks from remote peer
    pc.ontrack = (event) => {
      console.log(`Received stream from ${targetUserId}`, event.streams[0]);
      
      // Create or update audio element immediately
      const audioEl = audioElements.current[targetUserId] || new Audio();
      audioEl.srcObject = event.streams[0];
      audioEl.autoplay = true;
      audioEl.muted = false; // Ensure audio isn't muted
      
      // Store reference
      audioElements.current[targetUserId] = audioEl;

      // Handle audio play
      const playAudio = () => {
        audioEl.play().catch(err => 
          console.error(`Audio play failed for ${targetUserId}:`, err)
        );
      };

      // Attempt to play immediately
      playAudio();
      
      // Retry play if needed
      audioEl.onloadedmetadata = playAudio;
      audioEl.onpause = () => {
        console.log(`Audio paused for ${targetUserId}, attempting to resume`);
        playAudio();
      };

      // Update state for UI
      setRemoteStreams(prev => ({
        ...prev,
        [targetUserId]: event.streams[0]
      }));
    };
    
    return pc;
  };

  // Initialize peer connection with a specific user
  const initiatePeerConnection = async (targetUserId: string) => {
    if (!localStreamRef.current || !socket || !socket.connected) {
      console.warn("Cannot initiate connection: stream or socket not available");
      return;
    }
    
    try {
      console.log(`Initiating connection with ${targetUserId}`);
      const pc = createPeerConnection(targetUserId);
      
      // Add local tracks to the connection
      localStreamRef.current.getTracks().forEach((track) => {
        if (localStreamRef.current) {
          console.log("Adding track to peer connection:", track.kind);
          pc.addTrack(track, localStreamRef.current);
        }
      });
      
      // Store the connection
      peerConnectionsRef.current[targetUserId] = pc;
      
      // Create and send offer with specific constraints for audio
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
        // voiceActivityDetection: true
      });
      
      await pc.setLocalDescription(offer);
      console.log("Created and set local offer for", targetUserId);
      
      // Ensure we have a valid socket connection before sending
      if (socket && socket.connected) {
        socket.emit("offer", { 
          fromUserId: userId, 
          targetUserId, 
          offer 
        });
      } else {
        console.error("Socket not connected, cannot send offer");
        // Clean up created peer connection
        pc.close();
        delete peerConnectionsRef.current[targetUserId];
      }
    } catch (err) {
      console.error("Error initiating peer connection:", err);
    }
  };

  // Initialize speech recognition with improved error handling and subtitle-to-chat functionality
  const initSpeechRecognition = useCallback(() => {
    // Only enable if audio is enabled and browser supports it
    if (!isAudioEnabled) {
      console.log("Speech recognition not started: audio is disabled");
      return false;
    }
    
    if (!(window.webkitSpeechRecognition || window.SpeechRecognition)) {
      console.warn("Speech recognition not supported in this browser");
      return false;
    }
    
    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recog = new SpeechRecognition();
      
      // Configure for increased sensitivity
      recog.continuous = true;
      recog.interimResults = true;
      recog.maxAlternatives = 3;
      recog.lang = "en-US";
      
      // Lower than default to capture more speech
      // This is a non-standard property but works in some browsers
      try {
        // @ts-ignore - this is a non-standard property
        recog.interimResultsTimeout = 500;
      } catch (e) {
        // Ignore if not supported
      }

      // Handle speech recognition results
      recog.onresult = (event: any) => {
        let finalTranscript = "";
        let interimTranscript = "";

        // Process results
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript + " ";
          } else {
            interimTranscript += event.results[i][0].transcript + " ";
          }
        }

        // Handle interim results (subtitles)
        if (interimTranscript.trim()) {
          const trimmedInterim = interimTranscript.trim();
          
          // Update subtitle display
          setSubtitles(prev => ({
            ...prev,
            [userId]: trimmedInterim
          }));
          
          // Store in pending subtitles
          pendingSubtitles.current[userId] = trimmedInterim;

          // Reset the promotion timer
          if (subtitleTimeoutRef.current) {
            clearTimeout(subtitleTimeoutRef.current);
          }
          
          // Set timeout to promote to message after a period of silence
          subtitleTimeoutRef.current = setTimeout(() => {
            const finalText = pendingSubtitles.current[userId]?.trim();
            if (finalText && finalText.length > 5) { // Only convert substantial content
              const newMsg: Message = {
                id: crypto.randomUUID(),
                user_id: userId,
                content: finalText,
                created_at: new Date().toISOString(),
                display_name: username,
              };

              // Add to local messages
              setMessages(prev => [...prev, newMsg]);
              
              // Send to server
              socket?.emit("chat_message", {
                roomCode,
                message: finalText,
                userId,
                displayName: username
              });

              // Clear subtitle
              setSubtitles(prev => {
                const newSubs = { ...prev };
                delete newSubs[userId];
                return newSubs;
              });

              // Clear pending
              delete pendingSubtitles.current[userId];
            }
          }, 2000); // Promote after 2 seconds of silence
          
          // Emit subtitle to other users
          socket?.emit("subtitle", {
            roomCode,
            userId,
            text: trimmedInterim,
            displayName: username
          });
        }
      
        // Handle final results
        if (finalTranscript.trim()) {
          const trimmed = finalTranscript.trim();
          
          // Only create a message if it's substantial
          if (trimmed.length > 5) {
            const newMsg: Message = {
              id: crypto.randomUUID(),
              user_id: userId,
              content: trimmed,
              created_at: new Date().toISOString(),
              display_name: username,
            };

            // Add to local messages
            setMessages(prev => [...prev, newMsg]);
            
            // Send to server
            socket?.emit("chat_message", { 
              roomCode, 
              message: trimmed, 
              userId,
              displayName: username 
            });
          }

          // Clear any pending subtitles
          delete pendingSubtitles.current[userId];
          setSubtitles(prev => {
            const newSubs = { ...prev };
            delete newSubs[userId];
            return newSubs;
          });
        }
      };
      
      // Handle errors
      recog.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === 'not-allowed') {
          alert("Microphone access denied. Please enable microphone permission.");
          setIsAudioEnabled(false);
        } else if (event.error === 'audio-capture') {
          alert("No microphone detected. Please check your microphone connection.");
          setIsAudioEnabled(false);
        } else {
          // For other errors, try to restart
          try {
            setTimeout(() => {
              if (isAudioEnabled) {
                recog.start();
              }
            }, 1000);
          } catch (e) {
            console.error("Failed to restart after error:", e);
          }
        }
      };
      
      // Handle when recognition stops
      recog.onend = () => {
        console.log("Speech recognition ended, restarting...");
        if (isAudioEnabled) {
          try {
            // Add a small delay to prevent rapid restart
            setTimeout(() => {
              recog.start();
            }, 100);
          } catch (e) {
            console.error("Failed to restart speech recognition:", e);
          }
        }
      };
      
      // Start recognition
      try {
        recog.start();
        console.log("Speech recognition started");
        setRecognition(recog);
        return true;
      } catch (e) {
        console.error("Failed to start speech recognition:", e);
        return false;
      }
    } catch (err) {
      console.error("Error initializing speech recognition:", err);
      return false;
    }
  }, [isAudioEnabled, userId, roomCode, socket, username]);

  // Handle WebRTC signaling - offers, answers, and ICE candidates
  useEffect(() => {
    if (!socket) return;

    // Handle incoming offers
    const handleOffer = async (data: OfferData) => {
      console.log("Received offer from", data.fromUserId);
      const { fromUserId, offer } = data;
      
      // Only process if audio is enabled
      if (!isAudioEnabled) {
        console.log("Ignoring offer because audio is disabled");
        return;
      }
      
      try {
        // Ensure we have local stream
        if (!localStreamRef.current) {
          console.log("Getting microphone access to answer offer");
          const stream = await getMicrophoneStream();
          if (!stream) {
            console.error("Failed to get microphone for answering offer");
            return;
          }
          localStreamRef.current = stream;
          
          // Initialize speech recognition if needed
          if (!recognition) {
            initSpeechRecognition();
          }
        }
        
        // Create peer connection
        const pc = createPeerConnection(fromUserId);
        
        // Add local tracks
        localStreamRef.current.getTracks().forEach((track) => {
          if (localStreamRef.current) {
            pc.addTrack(track, localStreamRef.current);
          }
        });
        
        // Set remote description (the offer)
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        console.log("Set remote description for offer from", fromUserId);
        
        // Create answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log("Created and set local description for answer");
        
        // Send answer if socket is connected
        if (socket && socket.connected) {
          socket.emit("answer", {
            fromUserId: userId,
            targetUserId: fromUserId,
            answer,
          } as AnswerData);
        } else {
          console.error("Socket not connected, cannot send answer");
          pc.close();
          return;
        }
        
        // Store the connection
        peerConnectionsRef.current[fromUserId] = pc;
      } catch (error) {
        console.error("Error handling offer:", error);
      }
    };

    // Handle incoming answers
    const handleAnswer = async (data: AnswerData) => {
      console.log("Received answer from", data.fromUserId);
      const { fromUserId, answer } = data;
      const pc = peerConnectionsRef.current[fromUserId];
      
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          console.log("Set remote description for answer from", fromUserId);
        } catch (error) {
          console.error("Error setting remote description for answer:", error);
          // Try to recreate the connection
          setTimeout(() => {
            if (isAudioEnabled && localStreamRef.current) {
              initiatePeerConnection(fromUserId);
            }
          }, 2000);
        }
      } else {
        console.warn("No peer connection found for", fromUserId);
      }
    };

    // Handle ICE candidates
    const handleIceCandidate = async (data: IceCandidateData) => {
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
    };

    socket.on("offer", handleOffer);
    socket.on("answer", handleAnswer);
    socket.on("ice_candidate", handleIceCandidate);

    return () => {
      socket.off("offer", handleOffer);
      socket.off("answer", handleAnswer);
      socket.off("ice_candidate", handleIceCandidate);
    };
  }, [socket, userId, isAudioEnabled, recognition, initSpeechRecognition]);

  // Fetch participants
  const fetchParticipants = useCallback(async () => {
    if (!roomCode) return;
    try {
      console.log("Fetching participants for room:", roomCode);
      const res = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/room-members/${roomCode}`
      );
      
      if (!res.ok) {
        throw new Error(`Failed to fetch participants: ${res.status}`);
      }
      
      const data = await res.json();
      console.log("Participants data:", data);
      
      // Merge with online status
      const participantsWithStatus = data.map((p: Participant) => ({
        ...p,
        isOnline: onlineUserIds.includes(p.id)
      }));
      
      setParticipants(participantsWithStatus);
    } catch (error) {
      console.error("Error fetching participants:", error);
    }
  }, [roomCode, onlineUserIds]);

  // Join room
  const joinRoom = useCallback(async () => {
    if (!roomCode || !userId || !socket) return;
    
    // Prevent multiple join attempts
    if (roomJoinedRef.current) {
      console.log("Already joined room, skipping join");
      return;
    }
    
    try {
      console.log("Joining room:", roomCode, "as user:", userId);
      
      // Update database
      const resp = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/rooms/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          userId, 
          roomCode,
          displayName: username // Ensure username is sent
        }),
      });
      
      if (!resp.ok) {
        const errorText = await resp.text();
        try {
          const errorData = JSON.parse(errorText);
          console.error("Join room API error:", errorData.error || errorData);
        } catch {
          console.error("Join room API error:", errorText);
        }
        return;
      }
      
      const data = await resp.json();
      console.log("Joined room successfully in database:", data);
      
      // Join socket room
      socket.emit("join_room", { 
        roomCode, 
        userId, 
        displayName: username 
      });
      
      console.log("Emitted join_room event to socket");
      
      // Mark as joined ONLY after successful API call and socket event
      roomJoinedRef.current = true;
      
      // Fetch participants after joining
      await fetchParticipants();
    } catch (err) {
      console.error("Error joining room:", err);
    }
  }, [roomCode, userId, socket, username, fetchParticipants]);

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    if (!roomCode) return;
    
    try {
      console.log("Fetching messages for room:", roomCode);
      const res = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/messages/${roomCode}?order=created_at.asc`
      );
      
      if (!res.ok) throw new Error(`Failed to fetch messages: ${res.status}`);
      
      const data = await res.json();
      console.log(`Fetched ${data.length} messages`);
      setMessages(data);
      messagesRef.current.fetched = true;
    } catch (error) {
      console.error("Error fetching messages:", error);
    }
  }, [roomCode]);

  // Fetch QR code
  const fetchRoomDetails = useCallback(async () => {
    if (!roomCode) return;
    try {
      console.log("Fetching room details for:", roomCode);
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/rooms/${roomCode}`);
      
      if (!res.ok) {
        throw new Error(`Failed to fetch room details: ${res.status}`);
      }
      
      const data = await res.json();
      console.log("Room details:", data);
      setQrCode(data.qr_code);
    } catch (error) {
      console.error("Error fetching room details:", error);
    }
  }, [roomCode]);

  // Initialize room data on mount
  useEffect(() => {
    if (roomCode && userId) {
      console.log("Initializing room:", roomCode);
      const initializeRoom = async () => {
        await fetchMessages();
        await joinRoom();
        await fetchParticipants();
        await fetchRoomDetails();
      };
      initializeRoom();
    }
    
    // Clean up on unmount - commented out to prevent duplicate execution with onLeave
    // return () => {
    //   if (roomCode && userId && roomJoinedRef.current) {
    //     console.log("Running cleanup on unmount");
    //     leaveRoom();
    //   }
    // };
  }, [roomCode, userId, fetchMessages, joinRoom, fetchParticipants, fetchRoomDetails]);

  // Handle chat messages from socket
  useEffect(() => {
    if (!socket) return;
    
    const handleChatMessage = (data: { 
      userId: string; 
      message: string; 
      timestamp: string;
      displayName: string;
    }) => {
      console.log("Received chat message:", data);
      
      // Only add if it's not from current user (to avoid duplicates)
      if (data.userId !== userId) {
        // Use provided display name or fallback
        const displayName = data.displayName || 
          participantsRef.current.find(p => p.id === data.userId)?.displayName || 
          "Anonymous";
        
        const newMsg: Message = {
          id: crypto.randomUUID(),
          user_id: data.userId,
          content: data.message,
          created_at: data.timestamp || new Date().toISOString(),
          display_name: displayName,
        };
        
        setMessages((prev) => [...prev, newMsg]);
      }
    };

    socket.on("chat_message", handleChatMessage);
    return () => {
      socket.off("chat_message", handleChatMessage);
    };
  }, [socket, userId]);

  // Send text message
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !socket || !socket.connected) return;
    
    const newMsg: Message = {
      id: crypto.randomUUID(),
      user_id: userId,
      content: message,
      created_at: new Date().toISOString(),
      display_name: username,
    };
    
    setMessages((prev) => [...prev, newMsg]);
    
    socket.emit("chat_message", { 
      roomCode, 
      message: message.trim(), 
      userId,
      displayName: username
    });
    
    setMessage("");
  };

  // Copy QR to clipboard
  const handleCopyRoomCode = async () => {
    if (!qrCode) return;
    
    try {
      const res = await fetch(qrCode);
      
      if (!res.ok) {
        throw new Error("Failed to fetch QR code image");
      }
      
      const blob = await res.blob();
      
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob,
        }),
      ]);
      
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy QR code to clipboard", err);
    }
  };

  // Render the UI
  return (
    <div className="min-h-screen flex flex-col">
      <header className="glass-panel py-4 px-6 shadow-md">
        <div className="container mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Room: {roomCode}
            </h1>
            <p className="text-sm text-gray-400">Connected as {username}</p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsAudioEnabled(!isAudioEnabled)}
              className={`p-2 rounded-lg ${
                isAudioEnabled
                  ? "bg-primary/30 text-primary"
                  : "bg-secondary/30 text-muted-foreground"
              } hover:bg-primary/20 transition`}
              title={isAudioEnabled ? "Disable microphone" : "Enable microphone"}
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
              onClick={leaveRoom}
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
          {/* Audio elements for remote streams */}
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
                {p.isOnline && (
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="Online"></span>
                )}
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}