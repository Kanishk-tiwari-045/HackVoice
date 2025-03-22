import React, { useState } from "react";
import { UserCircle } from "lucide-react";

interface LoginProps {
  // onLogin now expects a full user object with id and displayName.
  onLogin: (userData: { id: string; displayName: string }) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (displayName.trim().length < 3) {
      setError("Display name must be at least 3 characters long");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const data = await response.json();

      if (!response.ok) {
        // If the error indicates the display name is already taken and an id is returned,
        // assume the user already exists and proceed.
        if (data.error === "Display name already taken" && data.id) {
          const userObj = { id: data.id, displayName };
          localStorage.setItem("user", JSON.stringify(userObj));
          onLogin(userObj);
          return;
        }
        throw new Error(data.error || "Failed to register");
      }
      // On success, assume the backend returns an object with { id, displayName }
      localStorage.setItem("user", JSON.stringify(data));
      onLogin(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass-panel rounded-xl w-full max-w-md p-8 space-y-6">
        <div className="text-center space-y-2">
          <UserCircle className="w-16 h-16 mx-auto text-primary" />
          <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Welcome
          </h1>
          <p className="text-muted-foreground">
            Enter your display name to continue
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="displayName"
              className="text-sm text-muted-foreground"
            >
              Display Name
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setError("");
              }}
              className="w-full rounded-lg input-style p-2"
              placeholder="Enter your display name"
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>

          <button
            type="submit"
            className="button-gradient w-full py-3 px-4 rounded-lg text-white font-medium"
            disabled={loading}
          >
            {loading ? "Registering..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
