"use client";

import { useState, type FormEvent } from "react";
import { useEditorStore } from "@/store/useEditorStore";

export default function AuthGate() {
  const login = useEditorStore((s) => s.login);
  const [value, setValue] = useState("");
  const [shaking, setShaking] = useState(false);
  const [error, setError] = useState(false);

  const attempt = () => {
    if (!value.trim()) return;
    const ok = value === (process.env.NEXT_PUBLIC_EDITOR_SECRET ?? "roughcut2025");
    if (ok) {
      login(value);
    } else {
      setError(true);
      setShaking(true);
      setValue("");
      setTimeout(() => { setShaking(false); setError(false); }, 600);
    }
  };

  const handleSubmit = (e: FormEvent) => { e.preventDefault(); attempt(); };

  return (
    <div className="h-screen w-screen bg-zinc-950 flex flex-col items-center justify-center gap-6">
      {/* Wordmark */}
      <div className="flex flex-col items-center gap-1 select-none">
        <span className="text-xs tracking-[0.35em] text-zinc-500 uppercase">Rough Cut</span>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Editor</h1>
      </div>

      {/* Input card */}
      <form
        onSubmit={handleSubmit}
        className={["flex flex-col gap-3 w-72 transition-transform duration-100", shaking ? "animate-shake" : ""].join(" ")}
      >
        <input
          autoFocus
          type="password"
          placeholder="Enter access key"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={[
            "w-full bg-zinc-900 border rounded-lg px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition-colors duration-200",
            error ? "border-red-500/60 focus:border-red-500" : "border-zinc-800 focus:border-violet-500/70",
          ].join(" ")}
        />

        <button
          type="submit"
          className="w-full py-2.5 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 active:bg-violet-700 text-white transition-colors duration-150"
        >
          Unlock
        </button>

        {error && (
          <p className="text-xs text-center text-red-400 tracking-wide">Invalid access key</p>
        )}
      </form>

      <span className="absolute bottom-6 text-[11px] text-zinc-700 tracking-widest">v0.1.0</span>

      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20%      { transform: translateX(-6px); }
          40%      { transform: translateX(6px); }
          60%      { transform: translateX(-4px); }
          80%      { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.5s ease-in-out; }
      `}</style>
    </div>
  );
}
