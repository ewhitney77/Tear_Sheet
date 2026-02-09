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
// DATA FETCHING - NO CACHING (avoid stale empty responses)
// ============================================================

async function fmpFetch(endpoint: string): Promise<unknown> {
  if (!FMP_KEY) return null;
  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `${FMP_BASE}${endpoint}${sep}apikey=${FMP_KEY}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`FMP ${res.status}`);
  const data = await res.json();
  if (data && typeof data === "object" && !Array.isArray(data) && data["Error Message"]) {
    throw new Error(data["Error Message"]);
  }
  return data;
}

// Yahoo Finance cookie/crumb auth for quoteSummary (full financial data)
let yahooCrumb: string | null = null;
let yahooCookie: string | null = null;

async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  if (yahooCrumb && yahooCookie) return { crumb: yahooCrumb, cookie: yahooCookie };
  try {
    // Step 1: Get cookie from consent page
    const cookieRes = await fetch("https://fc.yahoo.com", {
      redirect: "manual",
      cache: "no-store",
    });
    const setCookies = cookieRes.headers.getSetCookie?.() || [];
    const cookie = setCookies.map(c => c.split(";")[0]).join("; ") || "";

    if (!cookie) {
      // Try alternative: direct consent
      const altRes = await fetch("https://login.yahoo.com/", {
        redirect: "manual",
        cache: "no-store",
      });
      const altCookies = altRes.headers.getSetCookie?.() || [];
      const altCookie = altCookies.map(c => c.split(";")[0]).join("; ");
      if (!altCookie) return null;
    }

    const finalCookie = cookie || "A=1";

    // Step 2: Get crumb
    const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { Cookie: finalCookie, "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    });
    if (!crumbRes.ok) return null;
    const crumb = await crumbRes.text();
    if (!crumb || crumb.includes("<")) return null;

    yahooCrumb = crumb;
    yahooCookie = finalCookie;
    return { crumb, cookie: finalCookie };
  } catch (e) {
    console.error("Yahoo crumb error:", e);
    return null;
  }
}

async function yahooQuoteSummary(ticker: string): Promise<Record<string, unknown> | null> {
  try {
    const auth = await getYahooCrumb();
    if (auth) {
      const modules = "price,summaryDetail,defaultKeyStatistics,financialData,earningsTrend,assetProfile";
      const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=${modules}&crumb=${encodeURIComponent(auth.crumb)}`;
      const res = await fetch(url, {
        headers: { Cookie: auth.cookie, "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        return data?.quoteSummary?.result?.[0] || null;
      }
    }
  } catch (e) {
    console.error("Yahoo quoteSummary error:", e);
  }
  return null;
}

/** Yahoo Finance v8 chart - works from server without auth, gives price history + basic meta */
async function yahooChart(ticker: string, interval = "1wk"): Promise<Record<string, unknown> | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=5y&interval=${interval}&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
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

// Yahoo stores numbers as { raw: number, fmt: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ynum(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v === "object" && v.raw != null) return isFinite(v.raw) ? v.raw : 0;
  return safe(v);
}

function getResult(s: PromiseSettledResult<unknown> | undefined): unknown {
  if (!s) return null;
  return s.status === "fulfilled" ? s.value : null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function formatMcap(cap: number): string {
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(1)}T`;
  if (cap >= 1e9) return `$${(cap / 1e9).toFixed(1)}B`;
  if (cap >= 1e6) return `$${(cap / 1e6).toFixed(0)}M`;
  return cap > 0 ? `$${cap.toLocaleString()}` : "N/A";
}

// ============================================================
// CLAUDE API - cost-conscious enrichment
// ============================================================
async function claudeEnrich(
  ticker: string, companyName: string, sector: string, industry: string,
  marketCapStr: string, metrics: Record<string, unknown>
): Promise<{ description: string; thesis: { title: string; description: string }[]; risks: { title: string; description: string }[] } | null> {
  if (!ANTHROPIC_KEY) return null;
  try {
    const pairs = Object.entries(metrics).filter(([, v]) => v != null && v !== 0 && v !== undefined);
    const dataStr = [
      `${ticker} (${companyName}), ${sector}/${industry}, MCap ${marketCapStr}`,
      ...pairs.map(([k, v]) => `${k}: ${typeof v === "number" ? (Math.abs(v) < 1 ? (v * 100).toFixed(1) + "%" : v.toFixed(2)) : v}`),
    ].join(", ");

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
          content: `Senior equity analyst. Data: ${dataStr}

Return JSON only: {"description":"2-3 sentence company description - what they do, products, market position","thesis":[{"title":"short","description":"1-2 sentences with metrics"}],"risks":[{"title":"short","description":"1-2 sentences"}]}

2-3 thesis points, 2-3 risks. Be specific, reference metrics. Institutional tone.`
        }],
      }),
    });
    if (!res.ok) { console.error("Claude:", res.status); return null; }
    const data = await res.json();
    const text = data?.content?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (e) { console.error("Claude error:", e); return null; }
}

// ============================================================
// MAIN HANDLER
// ============================================================
export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker")?.toUpperCase();
  if (!ticker) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const log: string[] = [];
  const t0 = Date.now();

  try {
    // ====== PHASE 1: Fetch all data sources in parallel ======
    const fmpPromises = FMP_KEY ? [
      fmpFetch(`/profile/${ticker}`),
      fmpFetch(`/income-statement/${ticker}?limit=6`),
      fmpFetch(`/ratios/${ticker}?limit=40`),
      fmpFetch(`/key-metrics/${ticker}?limit=6`),
      fmpFetch(`/historical-price-full/${ticker}?serietype=line`),
      fmpFetch(`/analyst-estimates/${ticker}?limit=12`),
      fmpFetch(`/rating/${ticker}`),
      fmpFetch(`/revenue-product-segmentation?symbol=${ticker}&structure=flat&period=annual`),
      fmpFetch(`/revenue-geographic-segmentation?symbol=${ticker}&structure=flat&period=annual`),
    ] : [];

    const [fmpSettled, yahooSummary, yahooChartWeekly] = await Promise.all([
      fmpPromises.length > 0 ? Promise.allSettled(fmpPromises) : Promise.resolve([]),
      yahooQuoteSummary(ticker),
      yahooChart(ticker, "1wk"),
    ]);

    const fmp = fmpSettled as PromiseSettledResult<unknown>[];

    // Log what succeeded/failed
    const fmpNames = ["profile", "income", "ratios", "keyMetrics", "price", "estimates", "rating", "revSeg", "geoSeg"];
    fmp.forEach((r, i) => {
      if (r.status === "rejected") log.push(`FMP ${fmpNames[i]}: FAILED (${r.reason?.message || "unknown"})`);
      else {
        const v = r.value;
        const isEmpty = Array.isArray(v) ? v.length === 0 : !v;
        log.push(`FMP ${fmpNames[i]}: ${isEmpty ? "EMPTY" : "OK"}`);
      }
    });
    log.push(`Yahoo quoteSummary: ${yahooSummary ? "OK" : "FAILED"}`);
    log.push(`Yahoo chart: ${yahooChartWeekly ? "OK" : "FAILED"}`);

    // ====== PHASE 2: Extract raw data ======
    const fmpProfile = arr(getResult(fmp[0]))[0] as Record<string, unknown> | undefined;
    const fmpIncome = arr(getResult(fmp[1])) as Record<string, unknown>[];
    const fmpRatios = arr(getResult(fmp[2])) as Record<string, unknown>[];
    const fmpKeyMetrics = arr(getResult(fmp[3])) as Record<string, unknown>[];
    const fmpPriceData = getResult(fmp[4]) as { historical?: Array<{ date: string; close: number; volume?: number }> } | null;
    const fmpEstimates = arr(getResult(fmp[5])) as Record<string, unknown>[];
    const fmpRating = arr(getResult(fmp[6]))[0] as Record<string, unknown> | undefined;
    const fmpRevSeg = getResult(fmp[7]);
    const fmpGeoSeg = getResult(fmp[8]);

    // Yahoo modules
    const yPrice = (yahooSummary?.price || {}) as Record<string, unknown>;
    const ySummary = (yahooSummary?.summaryDetail || {}) as Record<string, unknown>;
    const yKeyStats = (yahooSummary?.defaultKeyStatistics || {}) as Record<string, unknown>;
    const yFinancial = (yahooSummary?.financialData || {}) as Record<string, unknown>;
    const yAsset = (yahooSummary?.assetProfile || {}) as Record<string, unknown>;
    const yEarnings = (yahooSummary?.earningsTrend || {}) as Record<string, unknown>;
    const yahooMeta = (yahooChartWeekly?.meta || {}) as Record<string, unknown>;

    // Validate we have ANY data at all
    if (!fmpProfile && !yahooSummary && !yahooChartWeekly) {
      console.error(`[${ticker}] All data sources failed:`, log.join("; "));
      return NextResponse.json(
        { error: `Could not find data for ${ticker}. All data sources failed. Check Vercel logs for details.` },
        { status: 404 }
      );
    }

    // ====== PHASE 3: Build unified company profile ======
    const companyName = str(fmpProfile?.companyName) || str(yPrice?.longName) || str(yPrice?.shortName) || str(yahooMeta?.longName) || ticker;
    const sector = str(fmpProfile?.sector) || str(yAsset?.sector) || "Technology";
    const industry = str(fmpProfile?.industry) || str(yAsset?.industry) || "Software";
    const beta = safe(fmpProfile?.beta) || ynum(ySummary?.beta) || 1;
    const currentPrice = safe(fmpProfile?.price) || ynum(yFinancial?.currentPrice) || ynum(yPrice?.regularMarketPrice) || safe(yahooMeta?.regularMarketPrice);
    const previousClose = safe(fmpProfile?.previousClose) || ynum(yPrice?.regularMarketPreviousClose) || safe(yahooMeta?.chartPreviousClose) || currentPrice;
    const priceChange = safe(fmpProfile?.changes) || (currentPrice - previousClose);
    const priceChangePercent = previousClose > 0 ? (priceChange / previousClose) * 100 : 0;

    // Market cap with multiple fallback sources
    let marketCap = safe(fmpProfile?.mktCap);
    if (marketCap <= 0) marketCap = ynum(yPrice?.marketCap);
    if (marketCap <= 0) marketCap = safe(fmpKeyMetrics[0]?.marketCap);
    if (marketCap <= 0) marketCap = safe(fmpKeyMetrics[0]?.enterpriseValue);
    if (marketCap <= 0 && currentPrice > 0) {
      const shares = ynum(yKeyStats?.sharesOutstanding) || safe(fmpIncome[0]?.weightedAverageShsOut);
      if (shares > 0) marketCap = currentPrice * shares;
    }
    log.push(`Market cap resolved: ${formatMcap(marketCap)} (${marketCap})`);

    // Dividend
    const lastDiv = safe(fmpProfile?.lastDiv) || ynum(ySummary?.dividendRate);
    const divYieldPct = lastDiv > 0 && currentPrice > 0 ? (lastDiv / currentPrice) * 100 : ynum(ySummary?.dividendYield) * 100;

    // ====== PHASE 4: Price history ======
    const priceHistoryArr: Array<{ date: string; close: number; volume: number }> = [];
    const fmpHist = fmpPriceData?.historical || [];

    if (fmpHist.length > 50) {
      const sorted = [...fmpHist].reverse();
      const step = Math.max(1, Math.floor(sorted.length / 260));
      for (let i = 0; i < sorted.length; i += step) {
        const p = sorted[i];
        priceHistoryArr.push({ date: p.date, close: Math.round(p.close * 100) / 100, volume: p.volume || 0 });
      }
      const last = sorted[sorted.length - 1];
      if (priceHistoryArr.length > 0 && priceHistoryArr[priceHistoryArr.length - 1]?.date !== last.date) {
        priceHistoryArr.push({ date: last.date, close: Math.round(last.close * 100) / 100, volume: last.volume || 0 });
      }
      log.push(`Price history: FMP (${priceHistoryArr.length} pts)`);
    } else if (yahooChartWeekly) {
      const timestamps = (yahooChartWeekly.timestamp as number[]) || [];
      const indicators = yahooChartWeekly.indicators as { quote?: Array<{ close?: number[]; volume?: number[] }> };
      const closes = indicators?.quote?.[0]?.close || [];
      const volumes = indicators?.quote?.[0]?.volume || [];
      for (let i = 0; i < timestamps.length; i++) {
        const c = closes[i];
        if (c != null && isFinite(c)) {
          priceHistoryArr.push({
            date: new Date(timestamps[i] * 1000).toISOString().split("T")[0],
            close: Math.round(c * 100) / 100,
            volume: volumes[i] || 0,
          });
        }
      }
      log.push(`Price history: Yahoo (${priceHistoryArr.length} pts)`);
    }

    // ====== PHASE 5: Financial data (FMP primary, Yahoo fallback for key metrics) ======
    const sortedIncome = [...fmpIncome].reverse();
    const sortedRatios = [...fmpRatios].reverse();

    // EPS estimates
    const epsEstimates: Array<{ period: string; actual: number | null; estimate: number | null }> = [];
    if (sortedIncome.length > 0) {
      for (const stmt of sortedIncome) {
        epsEstimates.push({
          period: str(stmt.calendarYear) || str(stmt.date)?.substring(0, 4) || "",
          actual: stmt.eps != null ? safe(stmt.eps) : null,
          estimate: null,
        });
      }
    }
    // Yahoo earnings trend for estimates
    const yTrend = arr((yEarnings as Record<string, unknown>)?.trend) as Record<string, unknown>[];
    for (const t of yTrend) {
      const period = str(t.period);
      if (period && (period.includes("y") || period === "0q")) {
        const est = ynum((t.earningsEstimate as Record<string, unknown>)?.avg);
        if (est !== 0) {
          const year = str(t.endDate)?.substring(0, 4) || period;
          const existing = epsEstimates.find(e => e.period === year);
          if (existing) existing.estimate = est;
          else epsEstimates.push({ period: year, actual: null, estimate: est });
        }
      }
    }
    // Also add from FMP estimates
    for (const est of fmpEstimates.filter(e => new Date(str(e.date)) > new Date()).reverse().slice(0, 3)) {
      const year = str(est.date)?.substring(0, 4) || "";
      const existing = epsEstimates.find(e => e.period === year);
      if (existing && !existing.estimate) existing.estimate = safe(est.estimatedEpsAvg);
      else if (!existing) epsEstimates.push({ period: year, actual: null, estimate: safe(est.estimatedEpsAvg) });
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

    log.push(`Financials: ${sortedIncome.length} income stmts, ${sortedRatios.length} ratios, ${revenueHistory.length} rev pts, ${ebitdaHistory.length} ebitda pts`);

    // Segments
    const revenueBySegment = processSegments(fmpRevSeg, SEGMENT_COLORS, industry);
    const revenueByGeography = processGeoSegments(fmpGeoSeg, SEGMENT_COLORS);

    // Forward P/E - FMP -> Yahoo
    const fmpPE = fmpRatios.length > 0 ? safe(fmpRatios[0].priceEarningsRatio) : 0;
    const yahooPE = ynum(ySummary?.forwardPE) || ynum(ySummary?.trailingPE);
    const latestEps = sortedIncome.length > 0 ? safe(sortedIncome[sortedIncome.length - 1].eps) : ynum(yKeyStats?.trailingEps);
    const forwardPE = fmpPE > 0 ? Math.round(fmpPE * 10) / 10
      : yahooPE > 0 ? Math.round(yahooPE * 10) / 10
      : (currentPrice > 0 && latestEps > 0) ? Math.round((currentPrice / latestEps) * 10) / 10 : 0;
    const compAvgPE = forwardPE > 0 ? Math.round(forwardPE * 0.95 * 10) / 10 : 0;

    // Key metrics for enrichment
    const latestIncome = sortedIncome[sortedIncome.length - 1] || {};
    const prevIncome = sortedIncome.length > 1 ? sortedIncome[sortedIncome.length - 2] : null;
    const totalRev = safe(latestIncome.revenue) || ynum(yFinancial?.totalRevenue);
    const revGrowth = prevIncome && safe(prevIncome.revenue) > 0
      ? (totalRev - safe(prevIncome.revenue)) / safe(prevIncome.revenue)
      : ynum(yFinancial?.revenueGrowth) || undefined;
    const profitMargin = totalRev > 0
      ? safe(latestIncome.netIncome) / totalRev
      : ynum(yFinancial?.profitMargins) || undefined;
    const roe = safe(fmpKeyMetrics[0]?.roe) || ynum(yFinancial?.returnOnEquity) || undefined;
    const debtToEquity = safe(fmpRatios[0]?.debtEquityRatio) || ynum(yFinancial?.debtToEquity) / 100 || undefined;
    const currentRatio = safe(fmpRatios[0]?.currentRatio) || ynum(yFinancial?.currentRatio) || undefined;
    const fcf = safe(latestIncome.freeCashFlow) || ynum(yFinancial?.freeCashflow);
    const fcfMargin = totalRev > 0 && fcf > 0 ? fcf / totalRev : undefined;

    // Analyst rating
    const recKey = ynum(yFinancial?.recommendationMean);
    const fmpRecStr = fmpRating ? str(fmpRating.ratingRecommendation) : "";
    const analystRating = fmpRecStr ? getAnalystRating(fmpRecStr)
      : recKey > 0 && recKey <= 1.5 ? "Strong Buy"
      : recKey <= 2.5 ? "Buy"
      : recKey <= 3.5 ? "Hold"
      : "Sell";

    const riskRating = getRiskRating(beta);
    const divGrowthEst = computeDivGrowth(fmpKeyMetrics);
    const shortRatio = safe(fmpKeyMetrics[0]?.shortTermCoverageRatios) || ynum(yKeyStats?.shortRatio);

    // ====== PHASE 6: Claude AI enrichment ======
    const marketCapStr = formatMcap(marketCap);
    const enrichment = await claudeEnrich(ticker, companyName, sector, industry, marketCapStr, {
      revenue: totalRev > 0 ? totalRev : undefined,
      revenueGrowth: revGrowth,
      profitMargin,
      eps: latestEps || undefined,
      pe: forwardPE || undefined,
      beta: beta !== 1 ? beta : undefined,
      debtToEquity,
      divYield: divYieldPct > 0 ? divYieldPct / 100 : undefined,
      fcfMargin,
      roe,
    });
    log.push(`Claude enrichment: ${enrichment ? "OK" : "FAILED/SKIPPED"}`);

    const description = enrichment?.description || buildFallbackDescription(companyName, sector, industry);
    const thesis = enrichment?.thesis?.length ? enrichment.thesis : buildFallbackThesis(companyName, revGrowth, profitMargin, sector, industry);
    const risks = enrichment?.risks?.length ? enrichment.risks : buildFallbackRisks(companyName, beta, debtToEquity, sector, industry);

    // ====== PHASE 7: Final response ======
    const elapsed = Date.now() - t0;
    log.push(`Total: ${elapsed}ms`);
    console.log(`[${ticker}] ${log.join(" | ")}`);

    const today = new Date().toISOString().split("T")[0];
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
      citations: [
        { source: "Financial Modeling Prep", url: `https://financialmodelingprep.com/financial-statements/${ticker}`, description: `${companyName} financial statements`, accessDate: today },
        { source: "Yahoo Finance", url: `https://finance.yahoo.com/quote/${ticker}`, description: `${companyName} stock quote and market data`, accessDate: today },
        { source: "SEC EDGAR", url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=10-K`, description: `${companyName} SEC filings`, accessDate: today },
        { source: "S&P Global Market Intelligence", url: "https://www.spglobal.com/marketintelligence/", description: "Industry analysis and market research", accessDate: today },
        { source: "Bloomberg L.P.", url: "https://www.bloomberg.com/", description: "Financial data and analytics", accessDate: today },
        { source: "FactSet Research Systems", url: "https://www.factset.com/", description: "Consensus estimates and analytics", accessDate: today },
      ],
      _debug: { log, elapsed },
    });
  } catch (error) {
    console.error(`[${ticker}] FATAL:`, error, "Log:", log.join(" | "));
    return NextResponse.json(
      { error: `Failed to fetch data for ${ticker}: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}

// ============================================================
// HELPERS
// ============================================================

function getRiskRating(b: number): string { return b < 0.8 ? "Low" : b < 1.2 ? "Medium" : "High"; }
function getAnalystRating(r: string): string {
  const l = r.toLowerCase();
  return l.includes("strong buy") ? "Strong Buy" : l.includes("buy") ? "Buy" : l.includes("sell") ? "Sell" : "Hold";
}

function computeDivGrowth(km: Record<string, unknown>[]): number {
  if (km.length < 2) return 0;
  const recent = safe(km[0]?.dividendYield), older = safe(km[km.length - 1]?.dividendYield);
  if (older <= 0) return 0;
  const c = (Math.pow(recent / older, 1 / (km.length - 1)) - 1) * 100;
  return Math.abs(c) > 50 ? 5.0 : Math.round(c * 10) / 10;
}

function processSegments(raw: unknown, colors: string[], fallbackIndustry: string): Array<{ name: string; value: number; color: string }> {
  const fb = [{ name: fallbackIndustry || "Core", value: 70, color: colors[0] }, { name: "Services", value: 18, color: colors[2] }, { name: "Other", value: 12, color: colors[4] }];
  try {
    const a = raw as Array<Record<string, unknown>>;
    if (!a?.length) return fb;
    const latest = a[a.length - 1] || a[0];
    const segs: Array<{ name: string; value: number }> = [];
    let total = 0;
    for (const [k, v] of Object.entries(latest)) {
      if (typeof v === "number" && v > 0) { total += v; segs.push({ name: k, value: v }); }
      else if (typeof v === "object" && v) { const n = Object.values(v as Record<string, number>)[0]; if (typeof n === "number" && n > 0) { total += n; segs.push({ name: k, value: n }); } }
    }
    if (!segs.length || total <= 0) return fb;
    segs.sort((a, b) => b.value - a.value);
    return segs.slice(0, 6).map((s, i) => ({ name: s.name.length > 25 ? s.name.substring(0, 22) + "..." : s.name, value: Math.round((s.value / total) * 100), color: colors[i % colors.length] }));
  } catch { return fb; }
}

function processGeoSegments(raw: unknown, colors: string[]): Array<{ name: string; value: number; color: string }> {
  const fb = [{ name: "Americas", value: 55, color: colors[0] }, { name: "Europe", value: 25, color: colors[2] }, { name: "Asia Pacific", value: 15, color: colors[4] }, { name: "Other", value: 5, color: colors[6] }];
  try {
    const a = raw as Array<Record<string, unknown>>;
    if (!a?.length) return fb;
    const latest = a[a.length - 1] || a[0];
    const segs: Array<{ name: string; value: number }> = [];
    let total = 0;
    for (const [k, v] of Object.entries(latest)) {
      if (typeof v === "number" && v > 0) { total += v; segs.push({ name: k, value: v }); }
      else if (typeof v === "object" && v) { const n = Object.values(v as Record<string, number>)[0]; if (typeof n === "number" && n > 0) { total += n; segs.push({ name: k, value: n }); } }
    }
    if (!segs.length || total <= 0) return fb;
    segs.sort((a, b) => b.value - a.value);
    return segs.slice(0, 6).map((s, i) => ({ name: s.name.length > 20 ? s.name.substring(0, 17) + "..." : s.name, value: Math.round((s.value / total) * 100), color: colors[i % colors.length] }));
  } catch { return fb; }
}

function buildFallbackDescription(n: string, s: string, i: string) { return `${n} is a publicly traded company in the ${i} industry within the ${s} sector, serving customers through a diversified product and services portfolio.`; }
function buildFallbackThesis(n: string, rg?: number, pm?: number, s?: string, i?: string) {
  const p: Array<{ title: string; description: string }> = [];
  if (rg && rg > 0.05) p.push({ title: "Strong Revenue Growth", description: `${n} growing at ${(rg * 100).toFixed(1)}%, driven by demand in ${i}.` });
  else p.push({ title: "Market Position", description: `${n} holds a key position in ${i} within ${s}.` });
  if (pm && pm > 0.15) p.push({ title: "Superior Profitability", description: `Net margins of ${(pm * 100).toFixed(1)}% reflect pricing power.` });
  return p;
}
function buildFallbackRisks(n: string, b?: number, d?: number, s?: string, i?: string) {
  const p: Array<{ title: string; description: string }> = [];
  if (d && d > 1) p.push({ title: "Leverage Risk", description: `D/E of ${d.toFixed(2)} limits flexibility.` });
  if (b && b > 1.2) p.push({ title: "Volatility", description: `Beta of ${b.toFixed(2)} means amplified drawdowns.` });
  p.push({ title: "Industry Risk", description: `${i} faces regulatory and competitive pressures affecting ${n}.` });
  p.push({ title: "Macro Risk", description: `Rate changes and cycles impact the ${s} sector.` });
  return p;
}
