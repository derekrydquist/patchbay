import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Music2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      await login(username, password);
      setLocation("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] flex flex-col items-center justify-center px-4">
      {/* Logo + wordmark */}
      <div className="flex flex-col items-center gap-4 mb-10">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-xl shadow-primary/20">
          <Music2 size={28} className="text-black" />
        </div>
        <h1 className="text-3xl font-heading font-black tracking-tighter uppercase text-white italic">
          Patch<span className="text-primary not-italic">Bay</span>
        </h1>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-[#181C26] border border-white/5 rounded-2xl p-8 shadow-2xl">
        <h2 className="text-sm uppercase tracking-[0.2em] font-bold text-white/60 mb-6 text-center">
          Sign in to your account
        </h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="username" className="text-xs font-bold text-white/70 uppercase tracking-wider">
              Username
            </Label>
            <Input
              id="username"
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Your username"
              required
              className="bg-black/40 border-white/10 text-white placeholder:text-white/20 focus-visible:ring-primary/50 focus-visible:border-primary/40 h-10"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs font-bold text-white/70 uppercase tracking-wider">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="bg-black/40 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-primary/50 focus-visible:border-primary/40 h-10"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 text-center">{error}</p>
          )}

          <Button
            type="submit"
            disabled={isPending}
            className="w-full h-10 bg-primary text-black font-bold text-sm hover:bg-primary/90 transition-colors"
          >
            {isPending ? "Signing in…" : "Sign In"}
          </Button>
        </form>

        {/* Placeholder links */}
        <div className="mt-6 flex items-center justify-center gap-6">
          {/* TODO: wire up Sign Up flow in a future session */}
          <button
            type="button"
            className="text-xs text-white/40 hover:text-primary transition-colors"
            onClick={() => {/* TODO: navigate to sign-up page */}}
          >
            Sign Up
          </button>
          <span className="text-white/10 text-xs">|</span>
          {/* TODO: wire up Forgot Password flow in a future session */}
          <button
            type="button"
            className="text-xs text-white/40 hover:text-primary transition-colors"
            onClick={() => {/* TODO: navigate to forgot-password page */}}
          >
            Forgot Password
          </button>
        </div>
      </div>
    </div>
  );
}
