import React, { useState } from 'react';
import { QrCode } from 'lucide-react';

interface JoinRoomProps {
  onBack: () => void;
  onJoin: (roomCode: string) => void;
}

export function JoinRoom({ onBack, onJoin }: JoinRoomProps) {
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomCode.trim().length !== 6) {
      setError('Please enter a valid room code');
      return;
    }
    onJoin(roomCode.toUpperCase());
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass-panel rounded-xl w-full max-w-md p-8 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Join Room
          </h1>
          <p className="text-muted-foreground">Enter a room code or scan QR code</p>
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
                setError('');
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
              <span className="bg-background px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <button
            type="button"
            className="glass-panel w-full py-8 rounded-lg border-2 border-dashed border-secondary hover:bg-secondary/50 transition-colors flex flex-col items-center gap-2"
          >
            <QrCode className="w-8 h-8 text-primary" />
            <div className="text-center">
              <p className="font-medium">Scan QR Code</p>
              <p className="text-sm text-muted-foreground">Upload or use camera</p>
            </div>
          </button>

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