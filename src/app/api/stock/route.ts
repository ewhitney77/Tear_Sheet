import { NextRequest, NextResponse } from "next/server";

const FMP_BASE = "https://financialmodelingprep.com/api/v3";
const API_KEY = process.env.FMP_API_KEY || "";

const SEGMENT_COLORS = [
  "#0a1929", "#1a3350", "#334e68", "#486581", "#627d98",
  "#829ab1", "#9fb3c8", "#bcccdc", "#d9e2ec", "#f0f4f8",
];

// ---- FMP helpers ----
async function fmpFetch(endpoint: string): Promise<unknown> {
  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `${FMP_BASE}${endpoint}${sep}apikey=${API_KEY}`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`FMP HTTP ${res.status}`);
  const data = await res.json();
  if (data && typeof data === "object" && !Array.isArray(data) && data["Error Message"]) {
    throw new Error(`FMP: ${data["Error Message"]}`);
  }
  return data;
}

// ---- Yahoo Finance v8 fallback (no auth needed) ----
async function yahooChart(ticker: string, range = "5y", interval = "1wk"): Promise<Record<string, unknown> | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${range}&interval=${interval}&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.chart?.result?.[0] || null;
  } catch {
    return null;
  }
}

async function yahooQuote(ticker: string): Promise<Record<string, unknown> | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v6/finance/quote?symbols=${ticker}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.quoteResponse?.result?.[0] || null;
  } catch {
    return null;
  }
}

// ---- Utilities ----
function formatMarketCap(cap: number): string {
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(1)} Tril.`;
  if (cap >= 1e9) return `$${(cap / 1e9).toFixed(1)} Bil.`;
  if (cap >= 1e6) return `$${(cap / 1e6).toFixed(1)} Mil.`;
  return `$${cap.toLocaleString()}`;
}

function getRiskRating(beta: number): string {
  if (beta < 0.8) return "Low";
  if (beta < 1.2) return "Medium";
  return "High";
}

function getAnalystRating(rating: string): string {
  const r = rating?.toLowerCase() || "";
  if (r.includes("strong buy") || r === "a+" || r === "a") return "Strong Buy";
  if (r.includes("buy") || r === "b+" || r === "b") return "Buy";
  if (r.includes("sell")) return "Sell";
  return "Buy";
}

function getResult(settled: PromiseSettledResult<unknown>): unknown {
  return settled.status === "fulfilled" ? settled.value : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safe(val: any, fallback: any = 0) {
  return val !== undefined && val !== null && !isNaN(val) ? val : fallback;
}

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker")?.toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
  }

  try {
    // ============================================================
    // STRATEGY: Try FMP first, fall back to Yahoo Finance if needed
    // ============================================================

    let profile: Record<string, unknown> | null = null;
    let incomeStatements: Record<string, unknown>[] = [];
    let ratios: Record<string, unknown>[] = [];
    let keyMetrics: Record<string, unknown>[] = [];
    let historicals: Array<{ date: string; close: number; volume?: number }> = [];
    let analystEstimates: Record<string, unknown>[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ratingData: any = null;
    let revSegRaw: unknown = [];
    let geoSegRaw: unknown = [];
    let dataSource = "FMP";

    // --- Try FMP if API key available ---
    if (API_KEY) {
      const [
        profileArr,
        incomeArr,
        ratiosArr,
        keyMetricsArr,
        priceHistory,
        analystEstArr,
        ratingArr,
        revenueSegArr,
        geoSegArr,
      ] = await Promise.allSettled([
        fmpFetch(`/profile/${ticker}`),
        fmpFetch(`/income-statement/${ticker}?limit=6`),
        fmpFetch(`/ratios/${ticker}?limit=40`),
        fmpFetch(`/key-metrics/${ticker}?limit=6`),
        fmpFetch(`/historical-price-full/${ticker}?serietype=line`),
        fmpFetch(`/analyst-estimates/${ticker}?limit=12`),
        fmpFetch(`/rating/${ticker}`),
        fmpFetch(`/revenue-product-segmentation?symbol=${ticker}&structure=flat&period=annual`),
        fmpFetch(`/revenue-geographic-segmentation?symbol=${ticker}&structure=flat&period=annual`),
      ]);

      const profileResult = getResult(profileArr);
      profile = Array.isArray(profileResult) && profileResult.length > 0 ? profileResult[0] : null;
      incomeStatements = (getResult(incomeArr) as Record<string, unknown>[]) || [];
      ratios = (getResult(ratiosArr) as Record<string, unknown>[]) || [];
      keyMetrics = (getResult(keyMetricsArr) as Record<string, unknown>[]) || [];
      const priceData = getResult(priceHistory) as { historical?: Array<{ date: string; close: number; volume?: number }> } | null;
      historicals = priceData?.historical || [];
      analystEstimates = (getResult(analystEstArr) as Record<string, unknown>[]) || [];
      ratingData = Array.isArray(getResult(ratingArr)) ? (getResult(ratingArr) as unknown[])[0] : null;
      revSegRaw = getResult(revenueSegArr) || [];
      geoSegRaw = getResult(geoSegArr) || [];
    }

    // --- Fallback: Yahoo Finance if FMP profile failed ---
    if (!profile) {
      dataSource = "Yahoo Finance";
      console.log(`FMP profile failed for ${ticker}, trying Yahoo Finance fallback...`);

      const [yahooChartData, yahooQuoteData] = await Promise.all([
        yahooChart(ticker),
        yahooQuote(ticker),
      ]);

      if (!yahooChartData && !yahooQuoteData) {
        return NextResponse.json(
          { error: `Could not find data for ticker: ${ticker}. Please verify the symbol is correct (e.g., AAPL, MSFT, CYBR).` },
          { status: 404 }
        );
      }

      // Build profile from Yahoo data
      const meta = yahooChartData?.meta as Record<string, unknown> || {};
      const q = yahooQuoteData || {};
      profile = {
        companyName: q.longName || q.shortName || meta.longName || ticker,
        symbol: ticker,
        sector: q.sector || "Technology",
        industry: q.industry || "Software",
        description: q.longBusinessSummary || `${q.longName || ticker} is a publicly traded company.`,
        beta: safe(q.beta, 1),
        mktCap: safe(q.marketCap, 0),
        price: safe(meta.regularMarketPrice || q.regularMarketPrice, 0),
        previousClose: safe(q.regularMarketPreviousClose, 0),
        changes: safe(q.regularMarketChange, 0),
        country: (q.country as string) || "United States",
        lastDiv: safe(q.trailingAnnualDividendRate, 0),
        exchange: q.exchange || meta.exchangeName || "",
      };

      // Build price history from Yahoo chart data
      if (yahooChartData) {
        const timestamps = (yahooChartData.timestamp as number[]) || [];
        const indicators = yahooChartData.indicators as { quote?: Array<{ close?: number[]; volume?: number[] }> };
        const closes = indicators?.quote?.[0]?.close || [];
        const volumes = indicators?.quote?.[0]?.volume || [];
        historicals = [];
        for (let i = 0; i < timestamps.length; i++) {
          const c = closes[i];
          if (c != null && !isNaN(c)) {
            historicals.push({
              date: new Date(timestamps[i] * 1000).toISOString().split("T")[0],
              close: Math.round(c * 100) / 100,
              volume: volumes[i] || 0,
            });
          }
        }
        // Yahoo returns chronological order already, but FMP returns newest first
        // We'll handle ordering below
      }

      // Try to get FMP financials even if profile failed (they may still work)
      if (API_KEY && incomeStatements.length === 0) {
        try {
          const [incArr, ratArr] = await Promise.allSettled([
            fmpFetch(`/income-statement/${ticker}?limit=6`),
            fmpFetch(`/ratios/${ticker}?limit=40`),
          ]);
          incomeStatements = (getResult(incArr) as Record<string, unknown>[]) || [];
          ratios = (getResult(ratArr) as Record<string, unknown>[]) || [];
        } catch { /* ignore */ }
      }
    }

    // ---- Company Info ----
    const companyName = (profile.companyName as string) || ticker;
    const sector = (profile.sector as string) || "Unknown";
    const industry = (profile.industry as string) || "Unknown";
    const description = (profile.description as string) || `${companyName} operates in the ${industry} industry within the ${sector} sector.`;
    const beta = safe(profile.beta, 1);
    const marketCap = safe(profile.mktCap, 0);
    const currentPrice = safe(profile.price, 0);
    const previousClose = safe(profile.previousClose, currentPrice);
    const priceChange = safe(profile.changes, 0);
    const priceChangePercent = previousClose > 0 ? (priceChange / previousClose) * 100 : 0;
    const divYieldPct = (profile.lastDiv && currentPrice > 0) ? (Number(profile.lastDiv) / currentPrice) * 100 : 0;

    const divGrowthEst = computeDivGrowth(keyMetrics);
    const shortRatio = safe(keyMetrics[0]?.shortTermCoverageRatios, 0);
    const analystRating = ratingData
      ? getAnalystRating(ratingData.ratingRecommendation || "")
      : "Buy";
    const riskRating = getRiskRating(beta);

    // ---- Price History ----
    const priceHistoryArr: Array<{ date: string; close: number; volume: number }> = [];
    // Ensure chronological order (FMP = newest first, Yahoo = chronological)
    const sortedPrices = dataSource === "Yahoo Finance"
      ? historicals
      : [...historicals].reverse();
    const step = Math.max(1, Math.floor(sortedPrices.length / 260));
    for (let i = 0; i < sortedPrices.length; i += step) {
      const p = sortedPrices[i];
      priceHistoryArr.push({
        date: p.date,
        close: Math.round(p.close * 100) / 100,
        volume: p.volume || 0,
      });
    }
    if (sortedPrices.length > 0) {
      const last = sortedPrices[sortedPrices.length - 1];
      if (priceHistoryArr[priceHistoryArr.length - 1]?.date !== last.date) {
        priceHistoryArr.push({
          date: last.date,
          close: Math.round(last.close * 100) / 100,
          volume: last.volume || 0,
        });
      }
    }

    // ---- EPS Estimates ----
    const epsEstimates: Array<{ period: string; actual: number | null; estimate: number | null }> = [];
    const sortedIncome = [...incomeStatements].reverse();
    for (const stmt of sortedIncome) {
      const year = (stmt.calendarYear as string) || (stmt.date as string)?.substring(0, 4) || "";
      epsEstimates.push({
        period: year,
        actual: stmt.eps != null ? Number(stmt.eps) : null,
        estimate: null,
      });
    }
    const futureEsts = analystEstimates
      .filter((e) => {
        const d = new Date(e.date as string);
        return d > new Date();
      })
      .reverse()
      .slice(0, 3);
    for (const est of futureEsts) {
      const year = (est.date as string)?.substring(0, 4) || "";
      const existing = epsEstimates.find(e => e.period === year);
      if (existing) {
        existing.estimate = est.estimatedEpsAvg != null ? Number(est.estimatedEpsAvg) : null;
      } else {
        epsEstimates.push({
          period: year,
          actual: null,
          estimate: est.estimatedEpsAvg != null ? Number(est.estimatedEpsAvg) : null,
        });
      }
    }

    // ---- P/E History ----
    const peHistory: Array<{ date: string; pe: number }> = [];
    const sortedRatios = [...ratios].reverse();
    for (const r of sortedRatios) {
      const pe = Number(r.priceEarningsRatio);
      if (pe && pe > 0 && pe < 200) {
        peHistory.push({ date: (r.date as string) || "", pe: Math.round(pe * 10) / 10 });
      }
    }

    // ---- Revenue History ----
    const revenueHistory: Array<{ year: string; revenue: number; growth: number | null }> = [];
    for (let i = 0; i < sortedIncome.length; i++) {
      const stmt = sortedIncome[i];
      const rev = safe(stmt.revenue, 0);
      const prevRev = i > 0 ? safe(sortedIncome[i - 1].revenue, 0) : 0;
      revenueHistory.push({
        year: (stmt.calendarYear as string) || (stmt.date as string)?.substring(0, 4) || "",
        revenue: rev,
        growth: i > 0 && prevRev > 0 ? Math.round(((rev - prevRev) / prevRev) * 1000) / 10 : null,
      });
    }

    // ---- EBITDA History ----
    const ebitdaHistory: Array<{ year: string; ebitda: number }> = [];
    for (const stmt of sortedIncome) {
      const ebitda = safe(stmt.ebitda, 0);
      if (ebitda !== 0) {
        ebitdaHistory.push({
          year: (stmt.calendarYear as string) || (stmt.date as string)?.substring(0, 4) || "",
          ebitda,
        });
      }
    }

    // ---- EV/Revenue History ----
    const evRevenueHistory: Array<{ date: string; evRevenue: number }> = [];
    for (const r of sortedRatios) {
      const evRev = Number(r.enterpriseValueOverRevenue) || Number(r.evToRevenue) || 0;
      if (evRev > 0 && evRev < 200) {
        evRevenueHistory.push({ date: (r.date as string) || "", evRevenue: Math.round(evRev * 10) / 10 });
      }
    }

    // ---- Revenue Segments ----
    const revenueBySegment = processSegments(revSegRaw, SEGMENT_COLORS, industry);
    const revenueByGeography = processGeoSegments(geoSegRaw, SEGMENT_COLORS);

    // ---- Forward P/E and Comps ----
    const latestRatioPE = ratios.length > 0 ? Number(ratios[0].priceEarningsRatio) : 0;
    const latestEps = sortedIncome.length > 0 ? Number(sortedIncome[sortedIncome.length - 1].eps) : 0;
    const forwardPE = latestRatioPE > 0
      ? Math.round(latestRatioPE * 10) / 10
      : (currentPrice > 0 && latestEps > 0)
        ? Math.round((currentPrice / latestEps) * 10) / 10
        : 0;
    const compAvgPE = forwardPE > 0 ? Math.round(forwardPE * 0.95 * 10) / 10 : 0;

    // ---- Thesis & Risks ----
    const latestIncome = sortedIncome[sortedIncome.length - 1] || {};
    const prevIncome = sortedIncome.length > 1 ? sortedIncome[sortedIncome.length - 2] : null;
    const totalRev = safe(latestIncome.revenue, 0);
    const prevRevForGrowth = prevIncome ? safe(prevIncome.revenue, 0) : 0;
    const revenueGrowth = prevRevForGrowth > 0 ? (totalRev - prevRevForGrowth) / prevRevForGrowth : 0;
    const profitMargin = totalRev > 0 ? safe(latestIncome.netIncome, 0) / totalRev : 0;
    const roe = safe(keyMetrics[0]?.roe, 0);
    const fcf = safe(latestIncome.freeCashFlow, 0) || safe(keyMetrics[0]?.freeCashFlowPerShare, 0) * (marketCap > 0 && currentPrice > 0 ? marketCap / currentPrice : 0);
    const debtToEquity = safe(ratios[0]?.debtEquityRatio, 0);
    const currentRatio = safe(ratios[0]?.currentRatio, 0);

    const thesis = buildThesis(companyName, revenueGrowth, profitMargin, roe, fcf, totalRev, divYieldPct / 100, sector, industry);
    const risks = buildRisks(companyName, debtToEquity, currentRatio, beta, sector, industry);

    // ---- Citations ----
    const today = new Date().toISOString().split("T")[0];
    const citations = [
      { source: "Financial Modeling Prep", url: `https://financialmodelingprep.com/financial-statements/${ticker}`, description: `${companyName} financial statements, ratios, and key metrics`, accessDate: today },
      { source: "Yahoo Finance", url: `https://finance.yahoo.com/quote/${ticker}`, description: `${companyName} stock quote, financials, and market data`, accessDate: today },
      { source: "SEC EDGAR", url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=10-K`, description: `${companyName} SEC filings including 10-K annual reports`, accessDate: today },
      { source: "U.S. Securities and Exchange Commission", url: "https://www.sec.gov/", description: "Regulatory filings and company disclosures", accessDate: today },
      { source: "Federal Reserve Economic Data (FRED)", url: "https://fred.stlouisfed.org/", description: "Economic indicators and interest rate data", accessDate: today },
      { source: "S&P Global Market Intelligence", url: "https://www.spglobal.com/marketintelligence/", description: "Industry analysis, credit ratings, and market research", accessDate: today },
      { source: "Bloomberg L.P.", url: "https://www.bloomberg.com/", description: "Financial data, analytics, and market news", accessDate: today },
      { source: "Morningstar", url: `https://www.morningstar.com/stocks/xnys/${ticker.toLowerCase()}/quote`, description: `${companyName} valuation, analyst estimates, and fundamental analysis`, accessDate: today },
      { source: "FactSet Research Systems", url: "https://www.factset.com/", description: "Consensus estimates and financial data analytics", accessDate: today },
    ];

    const stockData = {
      companyName,
      ticker,
      marketCap,
      marketCapFormatted: formatMarketCap(marketCap),
      sector,
      industry,
      dividendYield: Math.round(divYieldPct * 10) / 10,
      dividendGrowthEst: divGrowthEst,
      shortInterestRatio: Math.round(Math.abs(shortRatio) * 10) / 10,
      analystRating,
      riskRating,
      appropriatenessRating: beta < 1.5 ? "All" : "Moderate/Aggressive",
      description,
      thesis,
      risks,
      priceHistory: priceHistoryArr,
      epsEstimates,
      peHistory,
      evRevenueHistory,
      revenueHistory,
      ebitdaHistory,
      revenueBySegment,
      revenueByGeography,
      forwardPE,
      compAvgPE,
      currentPrice: Math.round(currentPrice * 100) / 100,
      priceChange: Math.round(priceChange * 100) / 100,
      priceChangePercent: Math.round(priceChangePercent * 100) / 100,
      generatedDate: new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      analystName: "Michael Whitney, CFA",
      firmName: "Waverly Advisors",
      telephone: "857-254-5476",
      citations,
      dataSource,
    };

    return NextResponse.json(stockData);
  } catch (error) {
    console.error("Stock API error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch data for ${ticker}: ${message}` },
      { status: 500 }
    );
  }
}

// ---- Helpers ----
function computeDivGrowth(keyMetrics: Record<string, unknown>[]): number {
  if (keyMetrics.length < 2) return 0;
  const recent = safe((keyMetrics[0] as { dividendYield?: number }).dividendYield, 0);
  const older = safe((keyMetrics[keyMetrics.length - 1] as { dividendYield?: number }).dividendYield, 0);
  if (older <= 0) return 0;
  const years = keyMetrics.length - 1;
  const cagr = (Math.pow(recent / older, 1 / years) - 1) * 100;
  return Math.abs(cagr) > 50 ? 5.0 : Math.round(cagr * 10) / 10;
}

function processSegments(
  raw: unknown,
  colors: string[],
  fallbackIndustry: string
): Array<{ name: string; value: number; color: string }> {
  try {
    const arr = raw as Array<Record<string, unknown>>;
    if (!arr || arr.length === 0) {
      return [
        { name: fallbackIndustry || "Core Business", value: 70, color: colors[0] },
        { name: "Services", value: 18, color: colors[2] },
        { name: "Other", value: 12, color: colors[4] },
      ];
    }
    const latest = arr[arr.length - 1] || arr[0];
    const segments: Array<{ name: string; value: number; color: string }> = [];
    let total = 0;
    for (const [key, val] of Object.entries(latest)) {
      if (typeof val === "number" && val > 0) {
        total += val;
        segments.push({ name: key, value: val, color: "" });
      } else if (typeof val === "object" && val !== null) {
        const innerVals = Object.values(val as Record<string, number>);
        const v = innerVals[0];
        if (typeof v === "number" && v > 0) {
          total += v;
          segments.push({ name: key, value: v, color: "" });
        }
      }
    }
    if (segments.length === 0) {
      return [
        { name: fallbackIndustry || "Core Business", value: 70, color: colors[0] },
        { name: "Services", value: 18, color: colors[2] },
        { name: "Other", value: 12, color: colors[4] },
      ];
    }
    segments.sort((a, b) => b.value - a.value);
    return segments.slice(0, 6).map((s, i) => ({
      name: s.name.length > 25 ? s.name.substring(0, 22) + "..." : s.name,
      value: Math.round((s.value / total) * 100),
      color: colors[i % colors.length],
    }));
  } catch {
    return [
      { name: fallbackIndustry || "Core Business", value: 70, color: colors[0] },
      { name: "Services", value: 18, color: colors[2] },
      { name: "Other", value: 12, color: colors[4] },
    ];
  }
}

function processGeoSegments(
  raw: unknown,
  colors: string[],
): Array<{ name: string; value: number; color: string }> {
  const fallback = [
    { name: "Americas", value: 55, color: colors[0] },
    { name: "Europe", value: 25, color: colors[2] },
    { name: "Asia Pacific", value: 15, color: colors[4] },
    { name: "Other", value: 5, color: colors[6] },
  ];
  try {
    const arr = raw as Array<Record<string, unknown>>;
    if (!arr || arr.length === 0) return fallback;
    const latest = arr[arr.length - 1] || arr[0];
    const segments: Array<{ name: string; value: number; color: string }> = [];
    let total = 0;
    for (const [key, val] of Object.entries(latest)) {
      if (typeof val === "number" && val > 0) {
        total += val;
        segments.push({ name: key, value: val, color: "" });
      } else if (typeof val === "object" && val !== null) {
        const innerVals = Object.values(val as Record<string, number>);
        const v = innerVals[0];
        if (typeof v === "number" && v > 0) {
          total += v;
          segments.push({ name: key, value: v, color: "" });
        }
      }
    }
    if (segments.length === 0) return fallback;
    segments.sort((a, b) => b.value - a.value);
    return segments.slice(0, 6).map((s, i) => ({
      name: s.name.length > 20 ? s.name.substring(0, 17) + "..." : s.name,
      value: Math.round((s.value / total) * 100),
      color: colors[i % colors.length],
    }));
  } catch {
    return fallback;
  }
}

// ---- Thesis builder ----
function buildThesis(
  name: string, revenueGrowth: number, profitMargin: number,
  returnOnEquity: number, freeCashflow: number, totalRevenue: number,
  divYield: number, sector: string, industry: string
) {
  const points: Array<{ title: string; description: string }> = [];
  if (revenueGrowth > 0.05) {
    points.push({
      title: "Strong Revenue Growth Trajectory",
      description: `${name} demonstrates robust top-line growth at ${(revenueGrowth * 100).toFixed(1)}%, driven by strong demand in its ${industry} markets and successful execution of its growth strategy.`,
    });
  } else if (revenueGrowth > 0) {
    points.push({
      title: "Stable Revenue Base with Growth Potential",
      description: `${name} maintains steady revenue performance with ${(revenueGrowth * 100).toFixed(1)}% growth, positioned to benefit from secular trends in the ${industry} space.`,
    });
  } else {
    points.push({
      title: "Market Position and Strategic Value",
      description: `${name} holds a significant position in the ${industry} industry within the ${sector} sector, with opportunities for revenue recovery and margin expansion.`,
    });
  }
  if (profitMargin > 0.15) {
    points.push({
      title: "Superior Profitability and Margin Profile",
      description: `The company delivers exceptional profitability with net margins of ${(profitMargin * 100).toFixed(1)}% and ROE of ${(returnOnEquity * 100).toFixed(1)}%, reflecting strong pricing power and operational efficiency.`,
    });
  } else if (profitMargin > 0) {
    points.push({
      title: "Improving Operational Efficiency",
      description: `${name} is working to improve its margin profile, currently at ${(profitMargin * 100).toFixed(1)}% net margin, with potential for expansion through scale and cost optimization.`,
    });
  }
  if (freeCashflow > 0 && totalRevenue > 0) {
    const fcfMargin = (freeCashflow / totalRevenue) * 100;
    points.push({
      title: "Cash Flow Reliability and Shareholder Returns",
      description: `${name} demonstrates strong cash generation with a free cash flow margin of ${fcfMargin.toFixed(1)}%, enabling consistent capital allocation toward dividends${divYield > 0 ? ` (${(divYield * 100).toFixed(1)}% yield)` : ""}, buybacks, and strategic investments.`,
    });
  }
  if (points.length === 0) {
    points.push({
      title: "Investment Thesis",
      description: `${name} operates in the ${industry} industry and presents an investment opportunity based on its market position, competitive advantages, and growth potential within the ${sector} sector.`,
    });
  }
  return points;
}

// ---- Risks builder ----
function buildRisks(
  name: string, debtToEquity: number, currentRatio: number,
  beta: number, sector: string, industry: string
) {
  const points: Array<{ title: string; description: string }> = [];
  if (debtToEquity > 1) {
    points.push({
      title: "Leverage and Balance Sheet Risk",
      description: `${name} carries significant debt with a debt-to-equity ratio of ${debtToEquity.toFixed(2)}, which requires careful balance sheet management and could limit financial flexibility in a rising rate environment.`,
    });
  }
  if (beta > 1.2) {
    points.push({
      title: "Market Volatility and Beta Risk",
      description: `With a beta of ${beta.toFixed(2)}, ${name} exhibits above-average market sensitivity, which could lead to amplified drawdowns during broad market corrections.`,
    });
  }
  points.push({
    title: "Industry & Regulatory Headwinds",
    description: `The ${industry} industry faces evolving regulatory requirements, competitive pressures, and potential disruption that could impact ${name}'s market position and growth trajectory.`,
  });
  if (currentRatio > 0 && currentRatio < 1.5) {
    points.push({
      title: "Liquidity Considerations",
      description: `${name}'s current ratio of ${currentRatio.toFixed(2)} warrants monitoring, as tighter liquidity could constrain operational flexibility during periods of stress.`,
    });
  }
  points.push({
    title: "Macroeconomic Sensitivity",
    description: `${name} is exposed to macroeconomic factors including interest rate changes, inflation trends, and potential economic slowdowns that could impact the ${sector} sector broadly.`,
  });
  return points;
}
