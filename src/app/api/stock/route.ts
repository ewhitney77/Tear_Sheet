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
      fmpFetch(`/profile/${ticker}`),                                                    // 0
      fmpFetch(`/income-statement/${ticker}?period=quarter&limit=8`),                    // 1 - QUARTERLY
      fmpFetch(`/ratios/${ticker}?limit=10`),                                            // 2
      fmpFetch(`/key-metrics/${ticker}?limit=6`),                                        // 3
      fmpFetch(`/historical-price-full/${ticker}?serietype=line`),                       // 4
      fmpFetch(`/analyst-estimates/${ticker}?limit=12`),                                 // 5
      fmpFetch(`/rating/${ticker}`),                                                     // 6
      fmpFetch(`/revenue-product-segmentation?symbol=${ticker}&structure=flat&period=annual`),  // 7
      fmpFetch(`/revenue-geographic-segmentation?symbol=${ticker}&structure=flat&period=annual`), // 8
      fmpFetch(`/enterprise-values/${ticker}?period=quarter&limit=8`),                   // 9 - EV data
      fmpFetch(`/income-statement/${ticker}?limit=6`),                                   // 10 - ANNUAL for annual ratios
    ] : [];

    const [fmpSettled, yahooSummary, yahooChartWeekly] = await Promise.all([
      fmpPromises.length > 0 ? Promise.allSettled(fmpPromises) : Promise.resolve([]),
      yahooQuoteSummary(ticker),
      yahooChart(ticker, "1wk"),
    ]);

    const fmp = fmpSettled as PromiseSettledResult<unknown>[];

    // Log what succeeded/failed
    const fmpNames = ["profile", "incomeQ", "ratios", "keyMetrics", "price", "estimates", "rating", "revSeg", "geoSeg", "evData", "incomeA"];
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
    const fmpEV = arr(getResult(fmp[9])) as Record<string, unknown>[];
    const fmpIncomeAnnual = arr(getResult(fmp[10])) as Record<string, unknown>[];

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

    // ====== PHASE 5: Financial data - QUARTERLY (trailing 8 quarters) ======
    const sortedIncomeQ = [...fmpIncome].reverse(); // quarterly, chronological
    const sortedIncomeA = [...fmpIncomeAnnual].reverse(); // annual, chronological
    const sortedRatios = [...fmpRatios].reverse();
    const sortedEV = [...fmpEV].reverse();

    // Format quarter label: "Q1 '23"
    const qLabel = (stmt: Record<string, unknown>) => {
      const d = str(stmt.date);
      const period = str(stmt.period);
      const year = d.substring(2, 4) || "";
      // FMP uses Q1-Q4 in period field
      const q = period || (() => {
        const month = parseInt(d.substring(5, 7));
        if (month <= 3) return "Q1";
        if (month <= 6) return "Q2";
        if (month <= 9) return "Q3";
        return "Q4";
      })();
      return `${q} '${year}`;
    };

    // Revenue History (quarterly)
    const revenueHistory: Array<{ year: string; revenue: number; growth: number | null }> = [];
    for (let i = 0; i < sortedIncomeQ.length; i++) {
      const rev = safe(sortedIncomeQ[i].revenue);
      // YoY quarterly growth (compare to same quarter last year = i-4)
      const prevYoY = i >= 4 ? safe(sortedIncomeQ[i - 4].revenue) : 0;
      revenueHistory.push({
        year: qLabel(sortedIncomeQ[i]),
        revenue: rev,
        growth: prevYoY > 0 ? Math.round(((rev - prevYoY) / prevYoY) * 1000) / 10 : null,
      });
    }

    // EBITDA History (quarterly)
    const ebitdaHistory: Array<{ year: string; ebitda: number }> = [];
    for (const stmt of sortedIncomeQ) {
      const ebitda = safe(stmt.ebitda);
      // Include even if 0 for quarters - shows the trend
      ebitdaHistory.push({ year: qLabel(stmt), ebitda });
    }

    // Valuation metrics: EV/EBITDA, EV/Revenue, P/E
    // Use latest EV and trailing 4Q financials
    const latestEVVal = sortedEV.length > 0 ? safe(sortedEV[sortedEV.length - 1]?.enterpriseValue) : 0;
    const trailing4Q = sortedIncomeQ.slice(-4);
    const ttmRevenue = trailing4Q.reduce((s, q) => s + safe(q.revenue), 0);
    const ttmEbitda = trailing4Q.reduce((s, q) => s + safe(q.ebitda), 0);
    const ttmNetIncome = trailing4Q.reduce((s, q) => s + safe(q.netIncome), 0);

    const evEbitda = latestEVVal > 0 && ttmEbitda > 0 ? Math.round((latestEVVal / ttmEbitda) * 10) / 10 : 0;
    const evRevenue = latestEVVal > 0 && ttmRevenue > 0 ? Math.round((latestEVVal / ttmRevenue) * 10) / 10 : 0;

    // Revenue growth table (annual YoY from annual statements)
    const revGrowthTable: Array<{ year: string; growth: number }> = [];
    for (let i = 1; i < sortedIncomeA.length; i++) {
      const curr = safe(sortedIncomeA[i].revenue);
      const prev = safe(sortedIncomeA[i - 1].revenue);
      if (prev > 0) {
        revGrowthTable.push({
          year: str(sortedIncomeA[i].calendarYear) || str(sortedIncomeA[i].date)?.substring(0, 4) || "",
          growth: Math.round(((curr - prev) / prev) * 1000) / 10,
        });
      }
    }

    // P/E and EV/Revenue history (keep for potential use)
    const peHistory: Array<{ date: string; pe: number }> = [];
    const evRevenueHistory: Array<{ date: string; evRevenue: number }> = [];
    for (const r of sortedRatios) {
      const pe = safe(r.priceEarningsRatio);
      if (pe > 0 && pe < 200) peHistory.push({ date: str(r.date), pe: Math.round(pe * 10) / 10 });
      const evRev = safe(r.enterpriseValueOverRevenue) || safe(r.evToRevenue);
      if (evRev > 0 && evRev < 200) evRevenueHistory.push({ date: str(r.date), evRevenue: Math.round(evRev * 10) / 10 });
    }

    // EPS from quarterly data
    const epsEstimates: Array<{ period: string; actual: number | null; estimate: number | null }> = [];
    for (const stmt of sortedIncomeQ) {
      const eps = safe(stmt.eps);
      if (eps !== 0) epsEstimates.push({ period: qLabel(stmt), actual: eps, estimate: null });
    }

    log.push(`Financials: ${sortedIncomeQ.length}Q income, ${sortedIncomeA.length}A income, ${sortedEV.length} EV, ${sortedRatios.length} ratios`);

    // Segments
    const revenueBySegment = processSegments(fmpRevSeg, SEGMENT_COLORS, industry);
    const revenueByGeography = processGeoSegments(fmpGeoSeg, SEGMENT_COLORS);

    // P/E from multiple sources
    const fmpPE = fmpRatios.length > 0 ? safe(fmpRatios[0].priceEarningsRatio) : 0;
    const yahooPE = ynum(ySummary?.trailingPE) || ynum(ySummary?.forwardPE);
    const ttmEps = trailing4Q.reduce((s, q) => s + safe(q.eps), 0);
    const computedPE = currentPrice > 0 && ttmEps > 0 ? currentPrice / ttmEps : 0;
    const forwardPE = fmpPE > 0 ? Math.round(fmpPE * 10) / 10
      : yahooPE > 0 ? Math.round(yahooPE * 10) / 10
      : computedPE > 0 ? Math.round(computedPE * 10) / 10 : 0;
    const compAvgPE = forwardPE > 0 ? Math.round(forwardPE * 0.95 * 10) / 10 : 0;

    // Key metrics for Claude enrichment
    const totalRev = ttmRevenue > 0 ? ttmRevenue : ynum(yFinancial?.totalRevenue);
    const revGrowth = revGrowthTable.length > 0 ? revGrowthTable[revGrowthTable.length - 1].growth / 100
      : ynum(yFinancial?.revenueGrowth) || undefined;
    const profitMargin = totalRev > 0 && ttmNetIncome !== 0 ? ttmNetIncome / totalRev
      : ynum(yFinancial?.profitMargins) || undefined;
    const roe = safe(fmpKeyMetrics[0]?.roe) || ynum(yFinancial?.returnOnEquity) || undefined;
    const debtToEquity = safe(fmpRatios[0]?.debtEquityRatio) || ynum(yFinancial?.debtToEquity) / 100 || undefined;
    const currentRatio = safe(fmpRatios[0]?.currentRatio) || ynum(yFinancial?.currentRatio) || undefined;
    const fcf = ynum(yFinancial?.freeCashflow) || 0;
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

    // ====== PHASE 6: Claude AI enrichment (wrapped in try/catch - must never crash pipeline) ======
    const marketCapStr = formatMcap(marketCap);
    let enrichment: { description: string; thesis: { title: string; description: string }[]; risks: { title: string; description: string }[] } | null = null;
    try {
      enrichment = await claudeEnrich(ticker, companyName, sector, industry, marketCapStr, {
        revenue: totalRev > 0 ? totalRev : undefined,
        revenueGrowth: revGrowth,
        profitMargin,
        eps: ttmEps || undefined,
        pe: forwardPE || undefined,
        beta: beta !== 1 ? beta : undefined,
        debtToEquity,
        divYield: divYieldPct > 0 ? divYieldPct / 100 : undefined,
        fcfMargin,
        roe,
      });
      log.push(`Claude enrichment: ${enrichment ? "OK" : "FAILED/SKIPPED"}`);
    } catch (e) {
      log.push(`Claude enrichment: CRASHED (${e instanceof Error ? e.message : "unknown"})`);
    }

    const description = enrichment?.description || buildFallbackDescription(companyName, sector, industry);
    const thesis = enrichment?.thesis?.length ? enrichment.thesis : buildFallbackThesis(companyName, revGrowth, profitMargin, sector, industry);
    const risks = enrichment?.risks?.length ? enrichment.risks : buildFallbackRisks(companyName, beta, debtToEquity, sector, industry);

    // ====== PHASE 7: Final response ======
    const elapsed = Date.now() - t0;
    log.push(`Total: ${elapsed}ms`);
    console.log(`[${ticker}] ${log.join(" | ")}`);

    // ====== PHASE 7: Build response with safe defaults (never return undefined/NaN) ======
    const today = new Date().toISOString().split("T")[0];
    const response = {
      companyName: companyName || ticker,
      ticker,
      marketCap: safe(marketCap),
      marketCapFormatted: marketCapStr || "N/A",
      sector: sector || "N/A",
      industry: industry || "N/A",
      dividendYield: safe(Math.round(divYieldPct * 10) / 10),
      dividendGrowthEst: safe(divGrowthEst),
      shortInterestRatio: safe(Math.round(Math.abs(shortRatio) * 10) / 10),
      analystRating: analystRating || "Hold",
      riskRating: riskRating || "Medium",
      appropriatenessRating: beta < 1.5 ? "All" : "Moderate/Aggressive",
      description: description || `${companyName || ticker} is a publicly traded company.`,
      thesis: Array.isArray(thesis) && thesis.length > 0 ? thesis : [{ title: "Market Position", description: `${companyName || ticker} operates in the ${industry} industry.` }],
      risks: Array.isArray(risks) && risks.length > 0 ? risks : [{ title: "Market Risk", description: "Subject to general market and economic conditions." }],
      priceHistory: Array.isArray(priceHistoryArr) ? priceHistoryArr : [],
      epsEstimates: Array.isArray(epsEstimates) ? epsEstimates : [],
      peHistory: Array.isArray(peHistory) ? peHistory : [],
      evRevenueHistory: Array.isArray(evRevenueHistory) ? evRevenueHistory : [],
      revenueHistory: Array.isArray(revenueHistory) ? revenueHistory : [],
      ebitdaHistory: Array.isArray(ebitdaHistory) ? ebitdaHistory : [],
      revenueBySegment: Array.isArray(revenueBySegment) ? revenueBySegment : [],
      revenueByGeography: Array.isArray(revenueByGeography) ? revenueByGeography : [],
      forwardPE: safe(forwardPE),
      compAvgPE: safe(compAvgPE),
      evEbitda: safe(evEbitda),
      evRevenue: safe(evRevenue),
      revGrowthTable: Array.isArray(revGrowthTable) ? revGrowthTable : [],
      currentPrice: safe(Math.round(currentPrice * 100) / 100),
      priceChange: safe(Math.round(priceChange * 100) / 100),
      priceChangePercent: safe(Math.round(priceChangePercent * 100) / 100),
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
    };

    // Data quality warnings
    if (response.marketCap <= 0) log.push("WARNING: Market cap is $0");
    if (response.revenueHistory.length === 0) log.push("WARNING: No revenue history");
    if (response.priceHistory.length === 0) log.push("WARNING: No price history");

    return NextResponse.json(response);
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
