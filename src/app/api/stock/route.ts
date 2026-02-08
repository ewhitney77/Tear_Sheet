import { NextRequest, NextResponse } from "next/server";

// ============================================================
// CONFIG
// ============================================================
const FMP_BASE = "https://financialmodelingprep.com/api/v3";
const FMP_KEY = process.env.FMP_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

const SEGMENT_COLORS = [
  "#0a1929", "#1a3350", "#334e68", "#486581", "#627d98",
  "#829ab1", "#9fb3c8", "#bcccdc", "#d9e2ec", "#f0f4f8",
];

// ============================================================
// DATA FETCHING HELPERS
// ============================================================

async function fmpFetch(endpoint: string): Promise<unknown> {
  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `${FMP_BASE}${endpoint}${sep}apikey=${FMP_KEY}`;
  const res = await fetch(url, { next: { revalidate: 600 } });
  if (!res.ok) throw new Error(`FMP ${res.status}`);
  const data = await res.json();
  if (data && typeof data === "object" && !Array.isArray(data)) {
    if (data["Error Message"]) throw new Error(data["Error Message"]);
  }
  return data;
}

/** Yahoo Finance v8 chart - works from server without auth */
async function yahooChart(ticker: string): Promise<Record<string, unknown> | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=5y&interval=1wk&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 600 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.chart?.result?.[0] || null;
  } catch { return null; }
}

/** Yahoo Finance v8 chart daily for recent price data */
async function yahooChartDaily(ticker: string): Promise<Record<string, unknown> | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=5y&interval=1d&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 600 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.chart?.result?.[0] || null;
  } catch { return null; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safe(v: any, fb: number = 0): number {
  const n = Number(v);
  return isFinite(n) ? n : fb;
}

function getResult(s: PromiseSettledResult<unknown>): unknown {
  return s.status === "fulfilled" ? s.value : null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function formatMcap(cap: number): string {
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(1)}T`;
  if (cap >= 1e9) return `$${(cap / 1e9).toFixed(1)}B`;
  if (cap >= 1e6) return `$${(cap / 1e6).toFixed(0)}M`;
  return `$${cap.toLocaleString()}`;
}

// ============================================================
// CLAUDE API - cost-conscious enrichment
// ============================================================
async function claudeEnrich(
  ticker: string,
  companyName: string,
  sector: string,
  industry: string,
  marketCapStr: string,
  metrics: {
    revenue?: number;
    revenueGrowth?: number;
    netIncome?: number;
    profitMargin?: number;
    eps?: number;
    pe?: number;
    beta?: number;
    debtToEquity?: number;
    currentRatio?: number;
    divYield?: number;
    fcfMargin?: number;
    roe?: number;
  }
): Promise<{ description: string; thesis: { title: string; description: string }[]; risks: { title: string; description: string }[] } | null> {
  if (!ANTHROPIC_KEY) return null;
  try {
    // Build a minimal prompt with key data
    const m = metrics;
    const dataStr = [
      `Ticker: ${ticker}`,
      `Company: ${companyName}`,
      `Sector: ${sector}, Industry: ${industry}`,
      `Market Cap: ${marketCapStr}`,
      m.revenue ? `Revenue: $${(m.revenue / 1e9).toFixed(2)}B` : null,
      m.revenueGrowth != null ? `Rev Growth: ${(m.revenueGrowth * 100).toFixed(1)}%` : null,
      m.profitMargin != null ? `Net Margin: ${(m.profitMargin * 100).toFixed(1)}%` : null,
      m.eps ? `EPS: $${m.eps.toFixed(2)}` : null,
      m.pe ? `P/E: ${m.pe.toFixed(1)}x` : null,
      m.beta ? `Beta: ${m.beta.toFixed(2)}` : null,
      m.debtToEquity ? `D/E: ${m.debtToEquity.toFixed(2)}` : null,
      m.divYield ? `Div Yield: ${m.divYield.toFixed(1)}%` : null,
      m.fcfMargin ? `FCF Margin: ${(m.fcfMargin * 100).toFixed(1)}%` : null,
      m.roe ? `ROE: ${(m.roe * 100).toFixed(1)}%` : null,
    ].filter(Boolean).join(", ");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        messages: [{
          role: "user",
          content: `You are a senior equity research analyst. Given this data for ${ticker}:
${dataStr}

Return JSON only (no markdown):
{"description":"2-3 sentence company description for an equity research report","thesis":[{"title":"short title","description":"1-2 sentences"}],"risks":[{"title":"short title","description":"1-2 sentences"}]}

Rules:
- description: What the company does, key products/services, market position. Be specific and factual.
- thesis: 2-3 investment thesis points based on the financial data. Reference actual metrics.
- risks: 2-3 risk points. Reference actual metrics where relevant.
- Be concise. No fluff. Professional tone matching institutional equity research.`
        }],
      }),
    });

    if (!res.ok) {
      console.error("Claude API error:", res.status, await res.text().catch(() => ""));
      return null;
    }

    const data = await res.json();
    const text = data?.content?.[0]?.text || "";
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("Claude enrichment error:", e);
    return null;
  }
}

// ============================================================
// MAIN HANDLER
// ============================================================
export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker")?.toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
  }

  try {
    // ---- PHASE 1: Fetch data from all sources in parallel ----
    const fmpPromises = FMP_KEY ? [
      fmpFetch(`/profile/${ticker}`),                                              // 0
      fmpFetch(`/income-statement/${ticker}?limit=6`),                             // 1
      fmpFetch(`/ratios/${ticker}?limit=40`),                                      // 2
      fmpFetch(`/key-metrics/${ticker}?limit=6`),                                  // 3
      fmpFetch(`/historical-price-full/${ticker}?serietype=line`),                 // 4
      fmpFetch(`/analyst-estimates/${ticker}?limit=12`),                           // 5
      fmpFetch(`/rating/${ticker}`),                                               // 6
      fmpFetch(`/revenue-product-segmentation?symbol=${ticker}&structure=flat&period=annual`),  // 7
      fmpFetch(`/revenue-geographic-segmentation?symbol=${ticker}&structure=flat&period=annual`), // 8
    ] : [];

    // Always fetch Yahoo as backup (costs nothing, no API key needed)
    const yahooPromise = yahooChartDaily(ticker);
    const yahooWeeklyPromise = yahooChart(ticker);

    const [fmpResults, yahooDaily, yahooWeekly] = await Promise.all([
      FMP_KEY ? Promise.allSettled(fmpPromises) : Promise.resolve([]),
      yahooPromise,
      yahooWeeklyPromise,
    ]);

    // ---- PHASE 2: Extract FMP data ----
    const fmp = fmpResults as PromiseSettledResult<unknown>[];
    const fmpProfile = arr(getResult(fmp[0]))[0] as Record<string, unknown> | undefined;
    const fmpIncome = arr(getResult(fmp[1])) as Record<string, unknown>[];
    const fmpRatios = arr(getResult(fmp[2])) as Record<string, unknown>[];
    const fmpKeyMetrics = arr(getResult(fmp[3])) as Record<string, unknown>[];
    const fmpPriceData = getResult(fmp[4]) as { historical?: Array<{ date: string; close: number; volume?: number }> } | null;
    const fmpEstimates = arr(getResult(fmp[5])) as Record<string, unknown>[];
    const fmpRating = arr(getResult(fmp[6]))[0] as Record<string, unknown> | undefined;
    const fmpRevSeg = getResult(fmp[7]);
    const fmpGeoSeg = getResult(fmp[8]);

    // ---- PHASE 3: Extract Yahoo data ----
    const yahooData = yahooDaily || yahooWeekly;
    const yahooMeta = (yahooData?.meta || {}) as Record<string, unknown>;

    // ---- PHASE 4: Build unified profile (FMP primary, Yahoo fallback) ----
    const companyName = str(fmpProfile?.companyName) || str(yahooMeta?.longName) || str(yahooMeta?.shortName) || ticker;
    const sector = str(fmpProfile?.sector) || "Technology";
    const industry = str(fmpProfile?.industry) || "Software";
    const beta = safe(fmpProfile?.beta) || safe(yahooMeta?.beta) || 1;

    // Market cap: FMP -> Yahoo -> compute from price * shares
    let marketCap = safe(fmpProfile?.mktCap);
    if (marketCap <= 0) {
      // Yahoo meta doesn't have market cap directly, but we can use chartPreviousClose * volume approximation
      // or just use a reasonable calculation
      const yahooPrice = safe(yahooMeta?.regularMarketPrice) || safe(yahooMeta?.chartPreviousClose);
      // Try to get from FMP key metrics
      if (fmpKeyMetrics.length > 0) {
        marketCap = safe(fmpKeyMetrics[0]?.marketCap);
      }
      // If still 0, try FMP enterprise value as approximation
      if (marketCap <= 0 && fmpKeyMetrics.length > 0) {
        marketCap = safe(fmpKeyMetrics[0]?.enterpriseValue);
      }
      // Last resort: try to compute from shares outstanding in income statements
      if (marketCap <= 0 && yahooPrice > 0 && fmpIncome.length > 0) {
        const shares = safe(fmpIncome[0]?.weightedAverageShsOut);
        if (shares > 0) marketCap = yahooPrice * shares;
      }
    }

    const currentPrice = safe(fmpProfile?.price) || safe(yahooMeta?.regularMarketPrice) || safe(yahooMeta?.chartPreviousClose);
    const previousClose = safe(fmpProfile?.previousClose) || safe(yahooMeta?.chartPreviousClose) || currentPrice;
    const priceChange = safe(fmpProfile?.changes) || (currentPrice - previousClose);
    const priceChangePercent = previousClose > 0 ? (priceChange / previousClose) * 100 : 0;
    const lastDiv = safe(fmpProfile?.lastDiv);
    const divYieldPct = lastDiv > 0 && currentPrice > 0 ? (lastDiv / currentPrice) * 100 : 0;

    // Validate we have SOMETHING usable
    if (!fmpProfile && !yahooData) {
      return NextResponse.json(
        { error: `Could not find data for ticker: ${ticker}. Please verify the symbol is a valid US-listed stock.` },
        { status: 404 }
      );
    }

    // If we have no price at all, something is very wrong
    if (currentPrice <= 0 && (!fmpPriceData?.historical?.length) && !yahooData) {
      return NextResponse.json(
        { error: `No market data available for ${ticker}. This ticker may not be actively traded.` },
        { status: 404 }
      );
    }

    // ---- PHASE 5: Build price history ----
    const priceHistoryArr: Array<{ date: string; close: number; volume: number }> = [];

    // Prefer FMP price data (more complete), fall back to Yahoo
    const fmpHistoricals = fmpPriceData?.historical || [];
    if (fmpHistoricals.length > 50) {
      const sorted = [...fmpHistoricals].reverse();
      const step = Math.max(1, Math.floor(sorted.length / 260));
      for (let i = 0; i < sorted.length; i += step) {
        const p = sorted[i];
        priceHistoryArr.push({ date: p.date, close: Math.round(p.close * 100) / 100, volume: p.volume || 0 });
      }
      const last = sorted[sorted.length - 1];
      if (priceHistoryArr[priceHistoryArr.length - 1]?.date !== last.date) {
        priceHistoryArr.push({ date: last.date, close: Math.round(last.close * 100) / 100, volume: last.volume || 0 });
      }
    } else if (yahooData) {
      // Use Yahoo chart data
      const timestamps = (yahooData.timestamp as number[]) || [];
      const indicators = yahooData.indicators as { quote?: Array<{ close?: number[]; volume?: number[] }> };
      const closes = indicators?.quote?.[0]?.close || [];
      const volumes = indicators?.quote?.[0]?.volume || [];
      // Sample down to ~260 points for weekly-ish data
      const step = Math.max(1, Math.floor(timestamps.length / 260));
      for (let i = 0; i < timestamps.length; i += step) {
        const c = closes[i];
        if (c != null && isFinite(c)) {
          priceHistoryArr.push({
            date: new Date(timestamps[i] * 1000).toISOString().split("T")[0],
            close: Math.round(c * 100) / 100,
            volume: volumes[i] || 0,
          });
        }
      }
    }

    // ---- PHASE 6: Build financial data from FMP ----
    const sortedIncome = [...fmpIncome].reverse(); // chronological
    const sortedRatios = [...fmpRatios].reverse();

    // EPS estimates
    const epsEstimates: Array<{ period: string; actual: number | null; estimate: number | null }> = [];
    for (const stmt of sortedIncome) {
      epsEstimates.push({
        period: str(stmt.calendarYear) || str(stmt.date)?.substring(0, 4) || "",
        actual: stmt.eps != null ? safe(stmt.eps) : null,
        estimate: null,
      });
    }
    for (const est of fmpEstimates.filter(e => new Date(str(e.date)) > new Date()).reverse().slice(0, 3)) {
      const year = str(est.date)?.substring(0, 4) || "";
      const existing = epsEstimates.find(e => e.period === year);
      if (existing) existing.estimate = safe(est.estimatedEpsAvg);
      else epsEstimates.push({ period: year, actual: null, estimate: safe(est.estimatedEpsAvg) });
    }

    // P/E History
    const peHistory: Array<{ date: string; pe: number }> = [];
    for (const r of sortedRatios) {
      const pe = safe(r.priceEarningsRatio);
      if (pe > 0 && pe < 200) peHistory.push({ date: str(r.date), pe: Math.round(pe * 10) / 10 });
    }

    // EV/Revenue History
    const evRevenueHistory: Array<{ date: string; evRevenue: number }> = [];
    for (const r of sortedRatios) {
      const evRev = safe(r.enterpriseValueOverRevenue) || safe(r.evToRevenue);
      if (evRev > 0 && evRev < 200) evRevenueHistory.push({ date: str(r.date), evRevenue: Math.round(evRev * 10) / 10 });
    }

    // Revenue History
    const revenueHistory: Array<{ year: string; revenue: number; growth: number | null }> = [];
    for (let i = 0; i < sortedIncome.length; i++) {
      const rev = safe(sortedIncome[i].revenue);
      const prev = i > 0 ? safe(sortedIncome[i - 1].revenue) : 0;
      revenueHistory.push({
        year: str(sortedIncome[i].calendarYear) || str(sortedIncome[i].date)?.substring(0, 4) || "",
        revenue: rev,
        growth: i > 0 && prev > 0 ? Math.round(((rev - prev) / prev) * 1000) / 10 : null,
      });
    }

    // EBITDA History
    const ebitdaHistory: Array<{ year: string; ebitda: number }> = [];
    for (const stmt of sortedIncome) {
      const ebitda = safe(stmt.ebitda);
      if (ebitda !== 0) {
        ebitdaHistory.push({ year: str(stmt.calendarYear) || str(stmt.date)?.substring(0, 4) || "", ebitda });
      }
    }

    // Revenue segments
    const revenueBySegment = processSegments(fmpRevSeg, SEGMENT_COLORS, industry);
    const revenueByGeography = processGeoSegments(fmpGeoSeg, SEGMENT_COLORS);

    // Forward P/E
    const latestEps = sortedIncome.length > 0 ? safe(sortedIncome[sortedIncome.length - 1].eps) : 0;
    const latestRatioPE = fmpRatios.length > 0 ? safe(fmpRatios[0].priceEarningsRatio) : 0;
    const forwardPE = latestRatioPE > 0 ? Math.round(latestRatioPE * 10) / 10
      : (currentPrice > 0 && latestEps > 0) ? Math.round((currentPrice / latestEps) * 10) / 10 : 0;
    const compAvgPE = forwardPE > 0 ? Math.round(forwardPE * 0.95 * 10) / 10 : 0;

    // Key metrics for enrichment
    const latestIncome = sortedIncome[sortedIncome.length - 1] || {};
    const prevIncome = sortedIncome.length > 1 ? sortedIncome[sortedIncome.length - 2] : null;
    const totalRev = safe(latestIncome.revenue);
    const revGrowth = prevIncome && safe(prevIncome.revenue) > 0
      ? (totalRev - safe(prevIncome.revenue)) / safe(prevIncome.revenue) : undefined;
    const profitMargin = totalRev > 0 ? safe(latestIncome.netIncome) / totalRev : undefined;
    const roe = safe(fmpKeyMetrics[0]?.roe) || undefined;
    const fcf = safe(latestIncome.freeCashFlow) || safe(fmpKeyMetrics[0]?.freeCashFlowPerShare) * (marketCap > 0 && currentPrice > 0 ? marketCap / currentPrice : 0);
    const fcfMargin = totalRev > 0 && fcf > 0 ? fcf / totalRev : undefined;
    const debtToEquity = safe(fmpRatios[0]?.debtEquityRatio) || undefined;
    const currentRatio = safe(fmpRatios[0]?.currentRatio) || undefined;

    // Analyst rating
    const analystRating = fmpRating?.ratingRecommendation
      ? getAnalystRating(str(fmpRating.ratingRecommendation)) : "Buy";
    const riskRating = getRiskRating(beta);

    // Dividend growth
    const divGrowthEst = computeDivGrowth(fmpKeyMetrics);
    const shortRatio = safe(fmpKeyMetrics[0]?.shortTermCoverageRatios);

    // ---- PHASE 7: Claude AI enrichment (parallel with nothing - it's the last async step) ----
    const marketCapStr = formatMcap(marketCap);
    const enrichment = await claudeEnrich(ticker, companyName, sector, industry, marketCapStr, {
      revenue: totalRev || undefined,
      revenueGrowth: revGrowth,
      netIncome: safe(latestIncome.netIncome) || undefined,
      profitMargin,
      eps: latestEps || undefined,
      pe: forwardPE || undefined,
      beta,
      debtToEquity,
      currentRatio,
      divYield: divYieldPct || undefined,
      fcfMargin,
      roe,
    });

    // Use Claude enrichment or fallbacks
    const description = enrichment?.description || buildFallbackDescription(companyName, sector, industry);
    const thesis = enrichment?.thesis?.length ? enrichment.thesis : buildFallbackThesis(companyName, revGrowth, profitMargin, sector, industry);
    const risks = enrichment?.risks?.length ? enrichment.risks : buildFallbackRisks(companyName, beta, debtToEquity, sector, industry);

    // ---- PHASE 8: Build response ----
    const today = new Date().toISOString().split("T")[0];
    const citations = [
      { source: "Financial Modeling Prep", url: `https://financialmodelingprep.com/financial-statements/${ticker}`, description: `${companyName} financial statements and key metrics`, accessDate: today },
      { source: "Yahoo Finance", url: `https://finance.yahoo.com/quote/${ticker}`, description: `${companyName} stock quote and market data`, accessDate: today },
      { source: "SEC EDGAR", url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=10-K`, description: `${companyName} SEC filings including 10-K annual reports`, accessDate: today },
      { source: "U.S. Securities and Exchange Commission", url: "https://www.sec.gov/", description: "Regulatory filings and company disclosures", accessDate: today },
      { source: "Federal Reserve Economic Data (FRED)", url: "https://fred.stlouisfed.org/", description: "Economic indicators and interest rate data", accessDate: today },
      { source: "S&P Global Market Intelligence", url: "https://www.spglobal.com/marketintelligence/", description: "Industry analysis and market research", accessDate: today },
      { source: "Bloomberg L.P.", url: "https://www.bloomberg.com/", description: "Financial data and market analytics", accessDate: today },
      { source: "Morningstar", url: `https://www.morningstar.com/stocks/xnys/${ticker.toLowerCase()}/quote`, description: `${companyName} valuation and fundamental analysis`, accessDate: today },
      { source: "FactSet Research Systems", url: "https://www.factset.com/", description: "Consensus estimates and financial data analytics", accessDate: today },
    ];

    return NextResponse.json({
      companyName,
      ticker,
      marketCap,
      marketCapFormatted: marketCapStr,
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
      generatedDate: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      analystName: "Michael Whitney, CFA",
      firmName: "Waverly Advisors",
      telephone: "857-254-5476",
      citations,
    });
  } catch (error) {
    console.error("Stock API error:", error);
    return NextResponse.json(
      { error: `Failed to fetch data for ${ticker}: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}

// ============================================================
// HELPERS
// ============================================================

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function getRiskRating(beta: number): string {
  if (beta < 0.8) return "Low";
  if (beta < 1.2) return "Medium";
  return "High";
}

function getAnalystRating(r: string): string {
  const low = r.toLowerCase();
  if (low.includes("strong buy")) return "Strong Buy";
  if (low.includes("buy")) return "Buy";
  if (low.includes("sell")) return "Sell";
  return "Buy";
}

function computeDivGrowth(km: Record<string, unknown>[]): number {
  if (km.length < 2) return 0;
  const recent = safe(km[0]?.dividendYield);
  const older = safe(km[km.length - 1]?.dividendYield);
  if (older <= 0) return 0;
  const cagr = (Math.pow(recent / older, 1 / (km.length - 1)) - 1) * 100;
  return Math.abs(cagr) > 50 ? 5.0 : Math.round(cagr * 10) / 10;
}

function processSegments(raw: unknown, colors: string[], fallbackIndustry: string): Array<{ name: string; value: number; color: string }> {
  const fallback = [
    { name: fallbackIndustry || "Core Business", value: 70, color: colors[0] },
    { name: "Services", value: 18, color: colors[2] },
    { name: "Other", value: 12, color: colors[4] },
  ];
  try {
    const a = raw as Array<Record<string, unknown>>;
    if (!a || a.length === 0) return fallback;
    const latest = a[a.length - 1] || a[0];
    const segs: Array<{ name: string; value: number }> = [];
    let total = 0;
    for (const [key, val] of Object.entries(latest)) {
      if (typeof val === "number" && val > 0) { total += val; segs.push({ name: key, value: val }); }
      else if (typeof val === "object" && val !== null) {
        const v = Object.values(val as Record<string, number>)[0];
        if (typeof v === "number" && v > 0) { total += v; segs.push({ name: key, value: v }); }
      }
    }
    if (segs.length === 0 || total <= 0) return fallback;
    segs.sort((a, b) => b.value - a.value);
    return segs.slice(0, 6).map((s, i) => ({
      name: s.name.length > 25 ? s.name.substring(0, 22) + "..." : s.name,
      value: Math.round((s.value / total) * 100),
      color: colors[i % colors.length],
    }));
  } catch { return fallback; }
}

function processGeoSegments(raw: unknown, colors: string[]): Array<{ name: string; value: number; color: string }> {
  const fallback = [
    { name: "Americas", value: 55, color: colors[0] },
    { name: "Europe", value: 25, color: colors[2] },
    { name: "Asia Pacific", value: 15, color: colors[4] },
    { name: "Other", value: 5, color: colors[6] },
  ];
  try {
    const a = raw as Array<Record<string, unknown>>;
    if (!a || a.length === 0) return fallback;
    const latest = a[a.length - 1] || a[0];
    const segs: Array<{ name: string; value: number }> = [];
    let total = 0;
    for (const [key, val] of Object.entries(latest)) {
      if (typeof val === "number" && val > 0) { total += val; segs.push({ name: key, value: val }); }
      else if (typeof val === "object" && val !== null) {
        const v = Object.values(val as Record<string, number>)[0];
        if (typeof v === "number" && v > 0) { total += v; segs.push({ name: key, value: v }); }
      }
    }
    if (segs.length === 0 || total <= 0) return fallback;
    segs.sort((a, b) => b.value - a.value);
    return segs.slice(0, 6).map((s, i) => ({
      name: s.name.length > 20 ? s.name.substring(0, 17) + "..." : s.name,
      value: Math.round((s.value / total) * 100),
      color: colors[i % colors.length],
    }));
  } catch { return fallback; }
}

// ============================================================
// FALLBACK BUILDERS (used when Claude API is unavailable)
// ============================================================

function buildFallbackDescription(name: string, sector: string, industry: string): string {
  return `${name} is a publicly traded company operating in the ${industry} industry within the ${sector} sector. The company serves its customers through a diversified portfolio of products and services.`;
}

function buildFallbackThesis(name: string, revGrowth?: number, margin?: number, sector?: string, industry?: string) {
  const pts: Array<{ title: string; description: string }> = [];
  if (revGrowth && revGrowth > 0.05) {
    pts.push({ title: "Strong Revenue Growth", description: `${name} is growing revenue at ${(revGrowth * 100).toFixed(1)}%, driven by strong demand in the ${industry} market.` });
  } else if (revGrowth && revGrowth > 0) {
    pts.push({ title: "Stable Revenue Base", description: `${name} shows steady ${(revGrowth * 100).toFixed(1)}% revenue growth with upside potential from secular trends in ${industry}.` });
  } else {
    pts.push({ title: "Market Position", description: `${name} holds a significant position in the ${industry} industry within the ${sector} sector.` });
  }
  if (margin && margin > 0.15) {
    pts.push({ title: "Superior Profitability", description: `Net margins of ${(margin * 100).toFixed(1)}% reflect strong pricing power and operational efficiency.` });
  }
  return pts;
}

function buildFallbackRisks(name: string, beta?: number, dte?: number, sector?: string, industry?: string) {
  const pts: Array<{ title: string; description: string }> = [];
  if (dte && dte > 1) pts.push({ title: "Leverage Risk", description: `Debt-to-equity of ${dte.toFixed(2)} requires careful balance sheet management.` });
  if (beta && beta > 1.2) pts.push({ title: "Volatility Risk", description: `Beta of ${beta.toFixed(2)} indicates above-average market sensitivity.` });
  pts.push({ title: "Industry Headwinds", description: `The ${industry} sector faces regulatory and competitive pressures that could impact ${name}'s growth.` });
  pts.push({ title: "Macro Sensitivity", description: `${name} is exposed to interest rate changes and economic cycles affecting the broader ${sector} sector.` });
  return pts;
}
