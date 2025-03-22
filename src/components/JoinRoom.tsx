import React, { useState } from "react";
import QrScanner from "qr-scanner";

interface JoinRoomProps {
  onBack: () => void;
  onJoin: (roomCode: string) => void;
}

export function JoinRoom({ onBack, onJoin }: JoinRoomProps) {
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");

  // Validate room code by fetching room details from the backend.
  const validateRoomCode = async (code: string): Promise<boolean> => {
    try {
      const res = await fetch(`http://localhost:3000/api/rooms/${code}`);
      if (!res.ok) {
        setError("Room not found.");
        return false;
      }
      const data = await res.json();
      console.log("Fetched room data:", data);
      if (data.active === false) {
        setError("Meeting is finished.");
        return false;
      }
      return true;
    } catch (error) {
      console.error("Room validation error:", error);
      setError("Error validating room.");
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (roomCode.trim().length !== 6) {
      setError("Please enter a valid room code");
      return;
    }
    const code = roomCode.toUpperCase();
    const isValid = await validateRoomCode(code);
    if (isValid) {
      onJoin(code);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const clipboardItems = e.clipboardData.items;
    let file: File | null = null;
    for (let i = 0; i < clipboardItems.length; i++) {
      if (clipboardItems[i].kind === "file") {
        file = clipboardItems[i].getAsFile();
        break;
      }
    }

    if (file) {
      try {
        const scannedCode = await QrScanner.scanImage(file);
        const code = scannedCode.toUpperCase();
        if (code && code.length === 6) {
          const isValid = await validateRoomCode(code);
          if (isValid) {
            onJoin(code);
          }
        } else {
          setError("Scanned QR code does not represent a valid room code.");
        }
      } catch (err) {
        console.error("QR scan failed:", err);
        setError("Failed to decode QR code. Please try another image.");
      }
    } else {
      setError("No image found in paste data.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass-panel rounded-xl w-full max-w-md p-8 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Join Room
          </h1>
          <p className="text-muted-foreground">
            Enter a room code or scan QR code
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="roomCode" className="text-sm text-muted-foreground">
              Room Code
            </label>
            <input
              id="roomCode"
              type="text"
              value={roomCode}
              onChange={(e) => {
                setRoomCode(e.target.value.toUpperCase());
                setError("");
              }}
              maxLength={6}
              className="w-full rounded-lg input-style p-2 text-center text-2xl tracking-wider font-mono"
              placeholder="ENTER CODE"
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-secondary"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                or
              </span>
            </div>
          </div>

          <div className="my-4">
            <label className="block text-center mb-2 font-medium text-primary">
              Paste QR Code Image
            </label>
            <div
              onPaste={handlePaste}
              className="mx-auto border-2 border-dashed border-secondary rounded-lg p-4 text-center cursor-pointer bg-gray-100 hover:bg-gray-200 transition-colors"
              style={{ width: "100%" }}
            >
              <p className="text-sm text-muted-foreground">
                Click here and paste (Ctrl+V) your image
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <button
              type="submit"
              className="button-gradient w-full py-3 px-4 rounded-lg text-white font-medium"
            >
              Join Room
            </button>
            <button
              type="button"
              onClick={onBack}
              className="w-full py-2 px-4 rounded-lg border border-secondary hover:bg-secondary/50 transition-colors"
            >
              Back to Options
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
