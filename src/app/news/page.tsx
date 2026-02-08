"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";

interface NewsArticle {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
}

function NewsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const ticker = searchParams.get("ticker") || "";
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyName, setCompanyName] = useState("");

  const fetchNews = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/news?ticker=${ticker}`);
      const data = await res.json();
      setArticles(data.articles || []);
      setCompanyName(data.companyName || ticker);
    } catch {
      setArticles([]);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    fetchNews();
    // Auto-refresh every 5 minutes
    const interval = setInterval(fetchNews, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchNews]);

  const timeAgo = (dateStr: string) => {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <div className="min-h-screen bg-navy-900">
      {/* Navigation */}
      <nav className="bg-navy-950 border-b border-navy-700 sticky top-0 z-50">
        <div className="max-w-[1200px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
              <span className="text-white font-semibold text-sm tracking-wide">WAVERLY ADVISORS</span>
            </div>
            <div className="h-5 w-px bg-navy-700" />
            <span className="text-navy-400 text-xs font-mono">NEWS FEED</span>
          </div>

          <button
            onClick={() => router.back()}
            className="px-4 py-1.5 text-xs font-medium bg-navy-800 border border-navy-600 text-navy-200 rounded hover:bg-navy-700 hover:text-white transition-all"
          >
            BACK TO TEAR SHEET
          </button>
        </div>
      </nav>

      <div className="max-w-[1200px] mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 text-xs font-mono">LIVE</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">
            Relevant News: <span className="font-mono">{ticker}</span>
          </h1>
          <p className="text-navy-400 text-sm">
            {companyName} &mdash; Latest news and analysis from reputable financial sources
          </p>
        </div>

        {/* News articles */}
        {loading ? (
          <div className="space-y-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-navy-800/50 border border-navy-700 rounded-lg p-5 animate-pulse">
                <div className="h-4 bg-navy-700 rounded w-3/4 mb-3" />
                <div className="h-3 bg-navy-700 rounded w-full mb-2" />
                <div className="h-3 bg-navy-700 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : articles.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-navy-400 text-lg">No news articles found for {ticker}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {articles.map((article, i) => (
              <a
                key={i}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block bg-navy-800/30 border border-navy-700 rounded-lg p-5 hover:bg-navy-800/60 hover:border-navy-600 transition-all group"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="text-white font-medium text-sm group-hover:text-navy-100 transition-colors leading-snug mb-2">
                      {article.title}
                    </h3>
                    {article.description && article.description !== article.title && (
                      <p className="text-navy-400 text-xs leading-relaxed line-clamp-2">
                        {article.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-3">
                      <span className="text-[10px] font-semibold text-navy-300 bg-navy-800 px-2 py-0.5 rounded">
                        {article.source}
                      </span>
                      <span className="text-[10px] text-navy-500 font-mono">
                        {timeAgo(article.publishedAt)}
                      </span>
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-navy-500 group-hover:text-navy-300 transition-colors flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </div>
              </a>
            ))}
          </div>
        )}

        {/* Auto-refresh notice */}
        <div className="mt-8 text-center">
          <p className="text-navy-600 text-[10px] font-mono">
            Feed auto-refreshes every 5 minutes &mdash; Sources include Reuters, Bloomberg, SEC EDGAR, Yahoo Finance
          </p>
        </div>
      </div>
    </div>
  );
}

export default function NewsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-navy-900 flex items-center justify-center">
        <div className="text-navy-400 font-mono text-sm">Loading news feed...</div>
      </div>
    }>
      <NewsContent />
    </Suspense>
  );
}
