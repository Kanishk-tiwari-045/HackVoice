// import React from 'react';
import { Plus, Users } from "lucide-react";

interface RoomOptionsProps {
  onCreateRoom: () => Promise<void>;
  onJoinRoom: () => Promise<void>;
}

export function RoomOptions({ onCreateRoom, onJoinRoom }: RoomOptionsProps) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass-panel rounded-xl w-full max-w-md p-8 space-y-6">
        <h1 className="text-2xl font-bold text-center bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          Choose an Option
        </h1>
        <div className="grid gap-4">
          <button
            onClick={onCreateRoom}
            className="glass-panel hover:bg-secondary/50 transition-colors p-6 rounded-xl flex items-center gap-4"
          >
            <div className="p-3 rounded-full bg-primary/20">
              <Plus className="w-6 h-6 text-primary" />
            </div>
            <div className="text-left">
              <h2 className="font-semibold">Create Room</h2>
              <p className="text-sm text-muted-foreground">
                Start a new room for others to join
              </p>
            </div>
          </button>
          <button
            onClick={onJoinRoom}
            className="glass-panel hover:bg-secondary/50 transition-colors p-6 rounded-xl flex items-center gap-4"
          >
            <div className="p-3 rounded-full bg-accent/20">
              <Users className="w-6 h-6 text-accent" />
            </div>
            <div className="text-left">
              <h2 className="font-semibold">Join Room</h2>
              <p className="text-sm text-muted-foreground">
                Enter a room code or scan QR code
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
