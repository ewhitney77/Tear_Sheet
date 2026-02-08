import { NextRequest, NextResponse } from "next/server";

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

    // Try Yahoo Finance search endpoint for news
    try {
      const newsResponse = await fetch(
        `https://query1.finance.yahoo.com/v1/finance/search?q=${ticker}&newsCount=20&enableFuzzyQuery=false&quotesCount=0`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        }
      );

      if (newsResponse.ok) {
        const newsData = await newsResponse.json();
        const news = newsData.news || [];

        for (const item of news) {
          if (item.title) {
            articles.push({
              title: item.title,
              description: item.title,
              url: item.link || `https://finance.yahoo.com/quote/${ticker}/news`,
              source: item.publisher || "Yahoo Finance",
              publishedAt: item.providerPublishTime
                ? new Date(item.providerPublishTime * 1000).toISOString()
                : new Date().toISOString(),
            });
          }
        }
      }
    } catch {
      // Fall through to fallback links
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
