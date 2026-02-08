import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker")?.toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
  }

  try {
    // Use Yahoo Finance RSS/search for news
    const response = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=assetProfile,price`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }
    );

    let companyName = ticker;
    if (response.ok) {
      const data = await response.json();
      companyName =
        data?.quoteSummary?.result?.[0]?.price?.shortName || ticker;
    }

    // Fetch news from Yahoo Finance search
    const newsResponse = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${ticker}&newsCount=20&enableFuzzyQuery=false&quotesCount=0`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }
    );

    const articles: Array<{
      title: string;
      description: string;
      url: string;
      source: string;
      publishedAt: string;
    }> = [];

    if (newsResponse.ok) {
      const newsData = await newsResponse.json();
      const news = newsData.news || [];

      for (const item of news) {
        articles.push({
          title: item.title || "",
          description: item.title || "",
          url: item.link || "#",
          source: item.publisher || "Yahoo Finance",
          publishedAt: item.providerPublishTime
            ? new Date(item.providerPublishTime * 1000).toISOString()
            : new Date().toISOString(),
        });
      }
    }

    // If no news from search, create placeholder with links to reputable sources
    if (articles.length === 0) {
      articles.push(
        {
          title: `${companyName} (${ticker}) - Latest Financial News`,
          description: `View the latest news and analysis for ${companyName}`,
          url: `https://finance.yahoo.com/quote/${ticker}/news`,
          source: "Yahoo Finance",
          publishedAt: new Date().toISOString(),
        },
        {
          title: `${companyName} SEC Filings`,
          description: `Latest regulatory filings and disclosures for ${companyName}`,
          url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=&dateb=&owner=include&count=40`,
          source: "SEC EDGAR",
          publishedAt: new Date().toISOString(),
        },
        {
          title: `${companyName} - Bloomberg Coverage`,
          description: `Bloomberg financial news and analysis for ${companyName}`,
          url: `https://www.bloomberg.com/quote/${ticker}:US`,
          source: "Bloomberg",
          publishedAt: new Date().toISOString(),
        },
        {
          title: `${companyName} - Reuters Coverage`,
          description: `Reuters financial news coverage for ${companyName}`,
          url: `https://www.reuters.com/companies/${ticker}.N`,
          source: "Reuters",
          publishedAt: new Date().toISOString(),
        }
      );
    }

    return NextResponse.json({ articles, companyName });
  } catch (error) {
    console.error("News API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch news" },
      { status: 500 }
    );
  }
}
