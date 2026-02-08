"use client";

import { useState, useCallback } from "react";
import TearSheet from "@/components/TearSheet";
import { StockData } from "@/lib/types";
import { useRouter } from "next/navigation";

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
        "Connecting to market data feeds...",
        "Fetching company fundamentals...",
        "Loading price history...",
        "Analyzing earnings estimates...",
        "Computing valuation multiples...",
        "Generating research report...",
      ];

      let stepIdx = 0;
      setLoadingStep(steps[0]);
      const interval = setInterval(() => {
        stepIdx++;
        if (stepIdx < steps.length) {
          setLoadingStep(steps[stepIdx]);
        }
      }, 1500);

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

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-56px)] px-6">
          <div className="w-full max-w-md">
            <div className="flex items-center justify-center mb-8">
              <div className="relative">
                <div className="w-16 h-16 border-2 border-navy-700 rounded-full" />
                <div className="absolute inset-0 w-16 h-16 border-2 border-t-white rounded-full animate-spin" />
              </div>
            </div>
            <div className="text-center">
              <p className="text-white font-medium mb-2">
                Generating Tear Sheet for <span className="font-mono">{ticker}</span>
              </p>
              <p className="text-navy-400 text-sm font-mono">{loadingStep}</p>
            </div>
            <div className="mt-6 w-full bg-navy-800 rounded-full h-1">
              <div className="h-1 rounded-full bg-white animate-pulse" style={{ width: "60%" }} />
            </div>
          </div>
        </div>
      )}

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
