import { NextRequest, NextResponse } from "next/server";

const FMP_BASE = "https://financialmodelingprep.com/api/v3";
const API_KEY = process.env.FMP_API_KEY || "";

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker")?.toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
  }

  try {
    const articles: Array<{
      title: string;
      description: string;
      url: string;
      source: string;
      publishedAt: string;
    }> = [];

    // Fetch news from FMP
    if (API_KEY) {
      try {
        const res = await fetch(
          `${FMP_BASE}/stock_news?tickers=${ticker}&limit=25&apikey=${API_KEY}`,
          { next: { revalidate: 300 } }
        );

        if (res.ok) {
          const newsData = await res.json();
          if (Array.isArray(newsData)) {
            for (const item of newsData) {
              if (item.title) {
                articles.push({
                  title: item.title,
                  description: item.text || item.title,
                  url: item.url || `https://finance.yahoo.com/quote/${ticker}/news`,
                  source: item.site || "Financial News",
                  publishedAt: item.publishedDate || new Date().toISOString(),
                });
              }
            }
          }
        }
      } catch {
        // Fall through to fallback
      }
    }

    // Fallback: provide direct links to reputable financial news sources
    if (articles.length === 0) {
      articles.push(
        {
          title: `${ticker} - Latest Financial News & Analysis`,
          description: `View the latest news and analysis for ${ticker}`,
          url: `https://finance.yahoo.com/quote/${ticker}/news`,
          source: "Yahoo Finance",
          publishedAt: new Date().toISOString(),
        },
        {
          title: `${ticker} - SEC Filings & Regulatory Disclosures`,
          description: `Latest regulatory filings and disclosures`,
          url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=&dateb=&owner=include&count=40`,
          source: "SEC EDGAR",
          publishedAt: new Date().toISOString(),
        },
        {
          title: `${ticker} - Bloomberg Market Coverage`,
          description: `Bloomberg financial news and analysis`,
          url: `https://www.bloomberg.com/quote/${ticker}:US`,
          source: "Bloomberg",
          publishedAt: new Date().toISOString(),
        },
        {
          title: `${ticker} - Reuters Financial Coverage`,
          description: `Reuters financial news coverage`,
          url: `https://www.reuters.com/companies/${ticker}.N`,
          source: "Reuters",
          publishedAt: new Date().toISOString(),
        },
        {
          title: `${ticker} - MarketWatch Analysis`,
          description: `MarketWatch stock analysis and news`,
          url: `https://www.marketwatch.com/investing/stock/${ticker.toLowerCase()}`,
          source: "MarketWatch",
          publishedAt: new Date().toISOString(),
        },
        {
          title: `${ticker} - Seeking Alpha Research`,
          description: `In-depth research and analysis`,
          url: `https://seekingalpha.com/symbol/${ticker}`,
          source: "Seeking Alpha",
          publishedAt: new Date().toISOString(),
        }
      );
    }

    return NextResponse.json({ articles, companyName: ticker });
  } catch (error) {
    console.error("News API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch news" },
      { status: 500 }
    );
  }
}
