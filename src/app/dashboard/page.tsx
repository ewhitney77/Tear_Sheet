"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import TearSheet from "@/components/TearSheet";
import { StockData } from "@/lib/types";
import { useRouter } from "next/navigation";

function LoadingScreen({ ticker, loadingStep }: { ticker: string; loadingStep: string }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loadingStep) {
      setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString("en-US", { hour12: false })}] ${loadingStep}`]);
    }
  }, [loadingStep]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((p) => Math.min(p + 0.7, 95));
    }, 200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-56px)] px-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative flex-shrink-0">
            <div className="w-12 h-12 border border-navy-600 rounded-lg flex items-center justify-center bg-navy-800/50">
              <svg className="w-6 h-6 text-white animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
              </svg>
            </div>
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full animate-ping" />
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full" />
          </div>
          <div>
            <h2 className="text-white font-semibold text-lg">
              Generating Research Report: <span className="font-mono text-blue-300">{ticker}</span>
            </h2>
            <p className="text-navy-400 text-xs font-mono mt-0.5">
              WAVERLY ADVISORS EQUITY RESEARCH ENGINE v2.1
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-navy-400 text-xs font-mono">PROGRESS</span>
            <span className="text-navy-300 text-xs font-mono">{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-navy-800 rounded-full h-2 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 via-blue-400 to-cyan-400 transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Terminal log */}
        <div className="bg-navy-950 border border-navy-700 rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 bg-navy-900 border-b border-navy-700">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
            <span className="text-navy-500 text-xs font-mono ml-2">data-pipeline.log</span>
          </div>
          <div className="p-4 h-48 overflow-y-auto font-mono text-xs leading-relaxed" style={{ scrollbarWidth: "thin" }}>
            <div className="text-green-400 mb-1">$ waverly-research --ticker {ticker} --mode full-analysis</div>
            <div className="text-navy-500 mb-2">Initializing Waverly Advisors Research Engine...</div>
            {logs.map((log, i) => (
              <div key={i} className={`mb-0.5 ${i === logs.length - 1 ? "text-cyan-300" : "text-navy-400"}`}>
                {log}
              </div>
            ))}
            <div className="inline-block w-2 h-3.5 bg-cyan-400 animate-pulse" />
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* Status indicators */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            { label: "Data Sources", value: "FMP + Yahoo", status: "active" },
            { label: "AI Analysis", value: "Claude Haiku", status: progress > 60 ? "active" : "pending" },
            { label: "Report Engine", value: "Compiling", status: progress > 80 ? "active" : "pending" },
          ].map((item) => (
            <div key={item.label} className="bg-navy-800/50 border border-navy-700 rounded-lg px-3 py-2">
              <div className="flex items-center gap-1.5 mb-1">
                <div className={`w-1.5 h-1.5 rounded-full ${item.status === "active" ? "bg-green-400 animate-pulse" : "bg-navy-500"}`} />
                <span className="text-navy-400 text-[10px] font-mono uppercase">{item.label}</span>
              </div>
              <span className={`text-xs font-mono ${item.status === "active" ? "text-white" : "text-navy-500"}`}>{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [ticker, setTicker] = useState("");
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadingStep, setLoadingStep] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [fbTicker, setFbTicker] = useState("");
  const [fbIssues, setFbIssues] = useState("");
  const [fbSent, setFbSent] = useState(false);
  const router = useRouter();

  const handleFeedback = useCallback(() => {
    const subject = encodeURIComponent(`Tear Sheet Feedback: ${fbTicker || "General"}`);
    const body = encodeURIComponent(
      `Ticker Used: ${fbTicker || "N/A"}\n\nIssues / Feedback:\n${fbIssues || "No additional details"}\n\n---\nSent from Waverly Advisors Tear Sheet Generator\nDate: ${new Date().toLocaleString("en-US")}`
    );
    window.open(`mailto:ewhitney777@gmail.com?subject=${subject}&body=${body}`, "_blank");
    setFbSent(true);
    setTimeout(() => { setShowFeedback(false); setFbSent(false); setFbTicker(""); setFbIssues(""); }, 2000);
  }, [fbTicker, fbIssues]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!ticker.trim()) return;

      setLoading(true);
      setError("");
      setStockData(null);

      const steps = [
        "Initializing secure connection to market data feeds...",
        "Querying Financial Modeling Prep API for fundamentals...",
        "Fetching 5-year daily price history from multiple sources...",
        "Cross-referencing Yahoo Finance for data validation...",
        "Extracting income statements and balance sheet data...",
        "Computing P/E ratios, EV/Revenue, and valuation multiples...",
        "Analyzing revenue segmentation by business line...",
        "Processing geographic revenue distribution...",
        "Retrieving consensus analyst estimates...",
        "Calculating EBITDA margins and free cash flow metrics...",
        "Engaging AI research analyst for thesis generation...",
        "Synthesizing investment thesis and risk factors...",
        "Compiling citations and data sources...",
        "Rendering equity research tear sheet...",
      ];

      let stepIdx = 0;
      setLoadingStep(steps[0]);
      const interval = setInterval(() => {
        stepIdx++;
        if (stepIdx < steps.length) {
          setLoadingStep(steps[stepIdx]);
        }
      }, 1200);

      try {
        const res = await fetch(`/api/stock?ticker=${ticker.trim().toUpperCase()}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to fetch stock data");
        }

        setStockData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        clearInterval(interval);
        setLoading(false);
        setLoadingStep("");
      }
    },
    [ticker]
  );

  return (
    <div className="min-h-screen bg-navy-900">
      {/* Top navigation bar */}
      <nav className="bg-navy-950 border-b border-navy-700 sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
              <span className="text-white font-semibold text-sm tracking-wide">WAVERLY ADVISORS</span>
            </div>
            <div className="h-5 w-px bg-navy-700" />
            <span className="text-navy-400 text-xs font-mono">EQUITY RESEARCH</span>
          </div>

          <div className="flex items-center gap-4">
            {stockData && (
              <button
                onClick={() => router.push(`/news?ticker=${stockData.ticker}`)}
                className="px-4 py-1.5 text-xs font-medium bg-navy-800 border border-navy-600 text-navy-200 rounded hover:bg-navy-700 hover:text-white transition-all"
              >
                RELEVANT NEWS
              </button>
            )}
            <button
              onClick={() => setShowFeedback(true)}
              className="px-4 py-1.5 text-xs font-medium bg-navy-800 border border-navy-600 text-navy-200 rounded hover:bg-navy-700 hover:text-white transition-all"
            >
              FEEDBACK
            </button>
            <button
              onClick={() => {
                setStockData(null);
                setTicker("");
              }}
              className="px-4 py-1.5 text-xs font-medium bg-navy-800 border border-navy-600 text-navy-200 rounded hover:bg-navy-700 hover:text-white transition-all"
            >
              NEW SEARCH
            </button>
          </div>
        </div>
      </nav>

      {/* Main content */}
      {!stockData && !loading && (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-56px)] px-6">
          <div className="text-center mb-10">
            <h1 className="text-3xl font-light text-white mb-2">
              Welcome, <span className="font-semibold">Mike Whitney</span>
            </h1>
            <p className="text-navy-400 text-sm">Please enter the ticker below</p>
          </div>

          <form onSubmit={handleSubmit} className="w-full max-w-lg">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={ticker}
                  onChange={(e) => {
                    setTicker(e.target.value.toUpperCase());
                    setError("");
                  }}
                  className="w-full bg-navy-800 border border-navy-600 rounded-lg px-5 py-4 text-white text-lg font-mono placeholder-navy-500 focus:outline-none focus:border-navy-400 focus:ring-1 focus:ring-navy-400 transition-all tracking-widest"
                  placeholder="AAPL"
                  autoFocus
                  maxLength={10}
                />
              </div>
              <button
                type="submit"
                className="px-8 py-4 bg-white text-navy-900 font-semibold rounded-lg hover:bg-navy-100 transition-all text-sm tracking-wide"
              >
                GENERATE
              </button>
            </div>
            {error && (
              <div className="mt-4 text-red-400 text-sm font-mono bg-red-950/30 border border-red-900/50 rounded-lg px-4 py-3">
                {error}
              </div>
            )}
          </form>

          <div className="mt-12 grid grid-cols-4 gap-6 text-center">
            {["AAPL", "MSFT", "ABBV", "JPM"].map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTicker(t);
                  const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
                  setTicker(t);
                  setTimeout(() => {
                    const form = document.querySelector("form");
                    if (form) form.requestSubmit();
                  }, 100);
                }}
                className="px-6 py-2 text-xs font-mono text-navy-400 border border-navy-700 rounded-lg hover:border-navy-500 hover:text-white transition-all"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading state - advanced terminal look */}
      {loading && <LoadingScreen ticker={ticker} loadingStep={loadingStep} />}

      {/* Tear sheet display */}
      {stockData && !loading && <TearSheet data={stockData} />}

      {/* Feedback Modal */}
      {showFeedback && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-navy-900 border border-navy-600 rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-navy-700">
              <h2 className="text-white font-semibold text-sm tracking-wide">SEND FEEDBACK</h2>
              <button onClick={() => { setShowFeedback(false); setFbSent(false); }} className="text-navy-400 hover:text-white text-lg">&times;</button>
            </div>
            {fbSent ? (
              <div className="px-6 py-10 text-center">
                <p className="text-green-400 font-medium">Email client opened — thank you!</p>
              </div>
            ) : (
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-navy-300 text-xs font-medium mb-1.5">Ticker Used</label>
                  <input
                    type="text"
                    value={fbTicker}
                    onChange={(e) => setFbTicker(e.target.value.toUpperCase())}
                    placeholder="e.g. AAPL"
                    className="w-full bg-navy-800 border border-navy-600 rounded-lg px-4 py-2.5 text-white text-sm font-mono placeholder-navy-500 focus:outline-none focus:border-navy-400"
                  />
                </div>
                <div>
                  <label className="block text-navy-300 text-xs font-medium mb-1.5">Issues / Feedback</label>
                  <textarea
                    value={fbIssues}
                    onChange={(e) => setFbIssues(e.target.value)}
                    placeholder="Describe any issues or suggestions..."
                    rows={4}
                    className="w-full bg-navy-800 border border-navy-600 rounded-lg px-4 py-2.5 text-white text-sm placeholder-navy-500 focus:outline-none focus:border-navy-400 resize-none"
                  />
                </div>
                <button
                  onClick={handleFeedback}
                  className="w-full py-2.5 bg-white text-navy-900 font-semibold rounded-lg hover:bg-navy-100 transition-all text-sm tracking-wide"
                >
                  SEND FEEDBACK
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
