import React, { useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from "react-router-dom";
import { Login } from "./components/Login";
import { RoomOptions } from "./components/RoomOptions";
import { JoinRoom } from "./components/JoinRoom";
import { ChatRoom } from "./components/ChatRoom";

interface User {
  id: string;
  displayName: string;
}

function App() {
  // Initialize user state from localStorage using a function
  const [user, setUser] = useState<User | null>(() => {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
  });

  // ProtectedRoute ensures that a user is logged in.
  const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
    if (!user) {
      return <Navigate to="/" replace />;
    }
    return <>{children}</>;
  };

  function MainContent() {
    const navigate = useNavigate();

    const handleLogin = (userData: User) => {
      setUser(userData);
      localStorage.setItem("user", JSON.stringify(userData));
      navigate("/options");
    };

    // Handles room creation by sending the valid user.id as creatorId.
    const handleCreateRoom = async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/rooms/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ creatorId: user?.id }),
        });
        const data = await response.json();
        if (!response.ok) {
          console.error("Error response from server:", data);
          throw new Error(data.error || "Failed to create room");
        }
        navigate(`/chat/${data.roomCode}`);
      } catch (error: any) {
        console.error("Error creating room:", error);
      }
    };

    // Navigate to join room screen.
    const handleJoinRoom = async () => {
      navigate("/join-room");
    };

    // Used by JoinRoom component after entering a room code.
    const handleJoinExistingRoom = (roomCode: string) => {
      navigate(`/chat/${roomCode}`);
    };

    const handleLeaveRoom = () => {
      navigate("/options");
    };

    const handleBack = () => {
      navigate("/options");
    };

    return (
      <Routes>
        <Route path="/" element={<Login onLogin={handleLogin} />} />
        <Route
          path="/options"
          element={
            <ProtectedRoute>
              <RoomOptions
                onCreateRoom={handleCreateRoom}
                onJoinRoom={handleJoinRoom}
              />
            </ProtectedRoute>
          }
        />
        <Route
          path="/join-room"
          element={
            <ProtectedRoute>
              <JoinRoom onBack={handleBack} onJoin={handleJoinExistingRoom} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chat/:roomCode"
          element={
            <ProtectedRoute>
              <ChatRoom
                username={user?.displayName || ""}
                userId={user?.id || ""}
                onLeave={handleLeaveRoom}
              />
            </ProtectedRoute>
          }
        />
      </Routes>
    );
  }

  return (
    <Router>
      <MainContent />
    </Router>
  );
}

export default App;
