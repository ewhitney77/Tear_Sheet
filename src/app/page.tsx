"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

const BOOT_LINES = [
  { text: "WAVERLY ADVISORS TERMINAL v3.2.1", delay: 0 },
  { text: "Initializing secure connection...", delay: 400 },
  { text: "[OK] TLS 1.3 handshake complete", delay: 800 },
  { text: "[OK] Authentication verified", delay: 1100 },
  { text: "Loading market data feeds...", delay: 1400 },
  { text: "[OK] NYSE/NASDAQ real-time feed connected", delay: 1800 },
  { text: "[OK] S&P Capital IQ module loaded", delay: 2100 },
  { text: "[OK] Bloomberg API bridge initialized", delay: 2400 },
  { text: "Loading analytics engine...", delay: 2700 },
  { text: "[OK] Financial modeling suite ready", delay: 3000 },
  { text: "[OK] Chart rendering engine initialized", delay: 3200 },
  { text: "[OK] PDF export module loaded", delay: 3400 },
  { text: "Running system diagnostics...", delay: 3600 },
  { text: "[OK] All systems operational", delay: 3900 },
  { text: "", delay: 4100 },
  { text: "SYSTEM READY", delay: 4300 },
];

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"login" | "booting" | "ready">("login");
  const [visibleLines, setVisibleLines] = useState<number>(0);
  const [progress, setProgress] = useState(0);
  const router = useRouter();

  const handleLogin = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (password === "115Manomet") {
        setPhase("booting");
        setError("");
      } else {
        setError("ACCESS DENIED - Invalid credentials");
      }
    },
    [password]
  );

  useEffect(() => {
    if (phase !== "booting") return;

    const timeouts: NodeJS.Timeout[] = [];

    BOOT_LINES.forEach((line, i) => {
      const t = setTimeout(() => {
        setVisibleLines(i + 1);
        setProgress(Math.round(((i + 1) / BOOT_LINES.length) * 100));
      }, line.delay);
      timeouts.push(t);
    });

    const finalTimeout = setTimeout(() => {
      setPhase("ready");
      setTimeout(() => router.push("/dashboard"), 800);
    }, 4800);
    timeouts.push(finalTimeout);

    return () => timeouts.forEach(clearTimeout);
  }, [phase, router]);

  if (phase === "booting" || phase === "ready") {
    return (
      <div className="min-h-screen bg-[#060f1a] flex flex-col items-center justify-center p-8 relative overflow-hidden">
        {/* Scanline effect */}
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{
            background:
              "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)",
          }}
        />

        <div className="w-full max-w-2xl">
          {/* Terminal header */}
          <div className="flex items-center gap-2 mb-4">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="ml-3 text-navy-400 text-xs font-mono">
              waverly-terminal
            </span>
          </div>

          {/* Terminal body */}
          <div className="bg-[#060f1a] border border-navy-700 rounded-lg p-6 font-mono text-sm">
            {BOOT_LINES.slice(0, visibleLines).map((line, i) => (
              <div
                key={i}
                className={`mb-1 ${
                  line.text.startsWith("[OK]")
                    ? "text-green-400"
                    : line.text === "SYSTEM READY"
                    ? "text-green-300 font-bold text-lg mt-2"
                    : line.text === ""
                    ? ""
                    : "text-navy-200"
                }`}
              >
                {line.text.startsWith("[OK]") ? (
                  <>
                    <span className="text-green-500">[OK]</span>
                    <span className="text-navy-200">
                      {line.text.substring(4)}
                    </span>
                  </>
                ) : (
                  line.text
                )}
              </div>
            ))}

            {/* Progress bar */}
            <div className="mt-4 mb-2">
              <div className="flex justify-between text-xs text-navy-400 mb-1">
                <span>Loading</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-navy-800 rounded-full h-2">
                <div
                  className="h-2 rounded-full transition-all duration-300 ease-out"
                  style={{
                    width: `${progress}%`,
                    background:
                      "linear-gradient(90deg, #22c55e, #4ade80)",
                  }}
                />
              </div>
            </div>
          </div>

          {phase === "ready" && (
            <div className="text-center mt-6 text-green-400 font-mono animate-pulse">
              Launching terminal...
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-900 flex flex-col items-center justify-center p-8 relative">
      {/* Background grid pattern */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative z-10 w-full max-w-md">
        {/* Logo area */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-navy-800 border-2 border-navy-600 mb-6">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Mike Whitney&apos;s
          </h1>
          <h2 className="text-lg font-light text-navy-300 mt-1">
            Tear Sheet Generator
          </h2>
          <div className="mt-3 h-px w-24 mx-auto bg-gradient-to-r from-transparent via-navy-500 to-transparent" />
        </div>

        {/* Login form */}
        <form onSubmit={handleLogin}>
          <div className="bg-navy-800/50 backdrop-blur border border-navy-700 rounded-xl p-8">
            <div className="mb-6">
              <label className="block text-xs font-medium text-navy-300 uppercase tracking-wider mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                className="w-full bg-navy-900 border border-navy-600 rounded-lg px-4 py-3 text-white placeholder-navy-500 focus:outline-none focus:border-navy-400 focus:ring-1 focus:ring-navy-400 transition-all font-mono"
                placeholder="Enter access code"
                autoFocus
              />
            </div>

            {error && (
              <div className="mb-4 text-red-400 text-sm font-mono bg-red-950/30 border border-red-900/50 rounded-lg px-4 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-white text-navy-900 font-semibold py-3 rounded-lg hover:bg-navy-100 transition-all duration-200 tracking-wide"
            >
              ACCESS TERMINAL
            </button>
          </div>
        </form>

        <p className="text-center text-navy-600 text-xs mt-6">
          WAVERLY ADVISORS &mdash; EQUITY RESEARCH
        </p>
      </div>
    </div>
  );
}
