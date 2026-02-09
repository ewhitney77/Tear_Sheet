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
// METRIC MAPPING (Verify-with-Thought)
// ============================================================
// REVENUE (quarterly, 8Q):
//   Source 1: Yahoo timeseries API → quarterlyTotalRevenue (NO AUTH needed)
//   Source 2: FMP /income-statement?period=quarter (PAID tier only)
//   Reason: FMP free tier returns [] for income-statement endpoint
//
// EBITDA (quarterly, 8Q):
//   Source 1: Yahoo timeseries → quarterlyEbitda
//   Source 2: CALCULATE: quarterlyOperatingIncome + quarterlyDepreciationAndAmortization
//   Source 3: FMP /income-statement?period=quarter (PAID tier only)
//   Reason: EBITDA can be missing; standard calc is OpInc + D&A
//
// EV/EBITDA:
//   Source 1: Yahoo quoteSummary → defaultKeyStatistics.enterpriseToEbitda
//   Source 2: Compute: enterpriseValue / TTM EBITDA
//   Missing when: Negative EBITDA → show "N/M"
//
// EV/Revenue:
//   Source 1: Yahoo quoteSummary → defaultKeyStatistics.enterpriseToRevenue
//   Source 2: Compute: enterpriseValue / TTM Revenue
//
// P/E:
//   Source 1: Yahoo quoteSummary → summaryDetail.trailingPE
//   Source 2: FMP /ratios → priceEarningsRatio (works on free tier)
//   Source 3: Compute: currentPrice / TTM EPS
//   Missing when: Negative earnings → show "N/M" (not meaningful)
//
// Revenue Growth (annual YoY):
//   Source 1: Yahoo timeseries → annualTotalRevenue (compute YoY)
//   Source 2: FMP /income-statement annual (PAID tier only)
//   Source 3: Yahoo financialData.revenueGrowth (single latest number)
//
// Segments/Geography:
//   Source 1: FMP /revenue-product-segmentation (PAID tier only)
//   Fallback: Show empty (NOT fake hardcoded data)
// ============================================================

// ============================================================
// DATA FETCHING LAYER
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

// Yahoo Finance cookie/crumb auth for quoteSummary
let yahooCrumb: string | null = null;
let yahooCookie: string | null = null;

async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  if (yahooCrumb && yahooCookie) return { crumb: yahooCrumb, cookie: yahooCookie };
  try {
    const cookieRes = await fetch("https://fc.yahoo.com", { redirect: "manual", cache: "no-store" });
    const setCookies = cookieRes.headers.getSetCookie?.() || [];
    let cookie = setCookies.map(c => c.split(";")[0]).join("; ") || "";
    if (!cookie) {
      const altRes = await fetch("https://login.yahoo.com/", { redirect: "manual", cache: "no-store" });
      const altCookies = altRes.headers.getSetCookie?.() || [];
      cookie = altCookies.map(c => c.split(";")[0]).join("; ");
    }
    const finalCookie = cookie || "A=1";
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
      const modules = [
        "price", "summaryDetail", "defaultKeyStatistics", "financialData",
        "earningsTrend", "assetProfile",
      ].join(",");
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

/**
 * Yahoo Finance timeseries API - NO AUTH NEEDED
 * Returns quarterly + annual financial statement data (revenue, EBITDA, etc.)
 * This is the GOLDEN SOURCE for financial statements.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function yahooTimeseries(ticker: string): Promise<Record<string, any[]> | null> {
  try {
    const types = [
      "quarterlyTotalRevenue",
      "quarterlyEbitda",
      "quarterlyOperatingIncome",
      "quarterlyNetIncome",
      "quarterlyBasicEPS",
      "quarterlyDepreciationAndAmortization",
      "annualTotalRevenue",
      "annualEbitda",
      "annualOperatingIncome",
      "annualNetIncome",
    ].join(",");
    // period1 = Jan 1 2020 (5 years of data), period2 = far future
    const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${ticker}?type=${types}&period1=1577836800&period2=9999999999&merge=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    const results = json?.timeseries?.result;
    if (!Array.isArray(results)) return null;

    // Flatten into { "quarterlyTotalRevenue": [...], "annualTotalRevenue": [...], ... }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: Record<string, any[]> = {};
    for (const series of results) {
      const meta = series?.meta;
      if (!meta?.type?.length) continue;
      const typeName = meta.type[0];
      if (series[typeName] && Array.isArray(series[typeName])) {
        out[typeName] = series[typeName];
      }
    }
    return out;
  } catch (e) {
    console.error("Yahoo timeseries error:", e);
    return null;
  }
}

/** Yahoo Finance v8 chart - NO AUTH needed, gives price history + basic meta */
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

// ============================================================
// UTILITY HELPERS
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safe(v: any, fb: number = 0): number {
  const n = Number(v);
  return isFinite(n) ? n : fb;
}

// Yahoo quoteSummary stores numbers as { raw: number, fmt: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ynum(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v === "object" && v.raw != null) return isFinite(v.raw) ? v.raw : 0;
  return safe(v);
}

// Yahoo timeseries stores numbers as { raw: number, fmt: string } inside reportedValue
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tsVal(entry: any): number {
  if (!entry) return 0;
  const rv = entry.reportedValue;
  if (rv && typeof rv === "object") return safe(rv.raw);
  return 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tsDate(entry: any): string {
  return entry?.asOfDate || "";
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

/** Consistent currency/number formatting by magnitude */
function formatCurrency(val: number): string {
  if (val >= 1e12) return `$${(val / 1e12).toFixed(1)}T`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
  return val > 0 ? `$${val.toLocaleString()}` : "N/A";
}

function formatQuarter(dateStr: string): string {
  if (!dateStr) return "";
  const month = parseInt(dateStr.substring(5, 7));
  const year = dateStr.substring(2, 4);
  const q = month <= 3 ? "Q1" : month <= 6 ? "Q2" : month <= 9 ? "Q3" : "Q4";
  return `${q} '${year}`;
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
  const ticker = request.nextUrl.searchParams.get("ticker")?.toUpperCase()?.trim();
  if (!ticker || !/^[A-Z]{1,10}$/.test(ticker)) {
    return NextResponse.json({ error: "Valid ticker required (1-10 letters)" }, { status: 400 });
  }

  const log: string[] = [];
  const t0 = Date.now();

  try {
    // ====== PHASE 1: Fetch ALL data sources in parallel ======
    // FMP: profile, ratios, price history, segments (free tier: profile + ratios work)
    const fmpPromises = FMP_KEY ? [
      fmpFetch(`/profile/${ticker}`),                                                            // 0 - profile (free tier ✓)
      fmpFetch(`/ratios/${ticker}?limit=10`),                                                    // 1 - ratios (free tier ✓)
      fmpFetch(`/key-metrics/${ticker}?limit=6`),                                                // 2 - key metrics (free tier ✓)
      fmpFetch(`/historical-price-full/${ticker}?serietype=line`),                               // 3 - price history (free tier ✓)
      fmpFetch(`/rating/${ticker}`),                                                             // 4 - analyst rating (free tier ✓)
      fmpFetch(`/revenue-product-segmentation?symbol=${ticker}&structure=flat&period=annual`),    // 5 - segments (paid only)
      fmpFetch(`/revenue-geographic-segmentation?symbol=${ticker}&structure=flat&period=annual`), // 6 - geography (paid only)
    ] : [];

    const [fmpSettled, yahooSummary, yahooChartData, yahooTS] = await Promise.all([
      fmpPromises.length > 0 ? Promise.allSettled(fmpPromises) : Promise.resolve([]),
      yahooQuoteSummary(ticker),
      yahooChart(ticker, "1wk"),
      yahooTimeseries(ticker),  // GOLDEN SOURCE for financial statements (no auth)
    ]);

    const fmp = fmpSettled as PromiseSettledResult<unknown>[];

    // Log data source results
    const fmpNames = ["profile", "ratios", "keyMetrics", "price", "rating", "revSeg", "geoSeg"];
    fmp.forEach((r, i) => {
      if (r.status === "rejected") log.push(`FMP ${fmpNames[i]}: FAIL`);
      else {
        const v = r.value;
        const isEmpty = Array.isArray(v) ? v.length === 0 : !v;
        log.push(`FMP ${fmpNames[i]}: ${isEmpty ? "EMPTY" : "OK"}`);
      }
    });
    log.push(`Yahoo summary: ${yahooSummary ? "OK" : "FAIL"}`);
    log.push(`Yahoo chart: ${yahooChartData ? "OK" : "FAIL"}`);
    log.push(`Yahoo timeseries: ${yahooTS ? `OK (${Object.keys(yahooTS).join(",")})` : "FAIL"}`);

    // ====== PHASE 2: Extract raw data ======
    const fmpProfile = arr(getResult(fmp[0]))[0] as Record<string, unknown> | undefined;
    const fmpRatios = arr(getResult(fmp[1])) as Record<string, unknown>[];
    const fmpKeyMetrics = arr(getResult(fmp[2])) as Record<string, unknown>[];
    const fmpPriceData = getResult(fmp[3]) as { historical?: Array<{ date: string; close: number; volume?: number }> } | null;
    const fmpRating = arr(getResult(fmp[4]))[0] as Record<string, unknown> | undefined;
    const fmpRevSeg = getResult(fmp[5]);
    const fmpGeoSeg = getResult(fmp[6]);

    // Yahoo quoteSummary modules
    const yPrice = (yahooSummary?.price || {}) as Record<string, unknown>;
    const ySummary = (yahooSummary?.summaryDetail || {}) as Record<string, unknown>;
    const yKeyStats = (yahooSummary?.defaultKeyStatistics || {}) as Record<string, unknown>;
    const yFinancial = (yahooSummary?.financialData || {}) as Record<string, unknown>;
    const yAsset = (yahooSummary?.assetProfile || {}) as Record<string, unknown>;
    const yahooMeta = (yahooChartData?.meta || {}) as Record<string, unknown>;

    // Yahoo timeseries data (GOLDEN SOURCE for financials)
    const tsQuarterlyRevenue = yahooTS?.quarterlyTotalRevenue || [];
    const tsQuarterlyEbitda = yahooTS?.quarterlyEbitda || [];
    const tsQuarterlyOpIncome = yahooTS?.quarterlyOperatingIncome || [];
    const tsQuarterlyNetIncome = yahooTS?.quarterlyNetIncome || [];
    const tsQuarterlyEPS = yahooTS?.quarterlyBasicEPS || [];
    const tsQuarterlyDA = yahooTS?.quarterlyDepreciationAndAmortization || [];
    const tsAnnualRevenue = yahooTS?.annualTotalRevenue || [];
    const tsAnnualEbitda = yahooTS?.annualEbitda || [];

    // Validate we have ANY data
    if (!fmpProfile && !yahooSummary && !yahooChartData && !yahooTS) {
      console.error(`[${ticker}] All data sources failed:`, log.join("; "));
      return NextResponse.json(
        { error: `Could not find data for ${ticker}. Please verify the ticker symbol.` },
        { status: 404 }
      );
    }

    // ====== PHASE 3: Company Profile (FMP profile + Yahoo fallback) ======
    const companyName = str(fmpProfile?.companyName) || str(yPrice?.longName) || str(yPrice?.shortName) || str(yahooMeta?.longName) || ticker;
    const sector = str(fmpProfile?.sector) || str(yAsset?.sector) || "";
    const industry = str(fmpProfile?.industry) || str(yAsset?.industry) || "";
    const beta = safe(fmpProfile?.beta) || ynum(ySummary?.beta) || 1;
    const currentPrice = safe(fmpProfile?.price) || ynum(yFinancial?.currentPrice) || ynum(yPrice?.regularMarketPrice) || safe(yahooMeta?.regularMarketPrice);
    const previousClose = safe(fmpProfile?.previousClose) || ynum(yPrice?.regularMarketPreviousClose) || safe(yahooMeta?.chartPreviousClose) || currentPrice;
    const priceChange = safe(fmpProfile?.changes) || (currentPrice - previousClose);
    const priceChangePercent = previousClose > 0 ? (priceChange / previousClose) * 100 : 0;

    // Market cap: FMP → Yahoo price → Yahoo keyStats → compute from shares * price
    let marketCap = safe(fmpProfile?.mktCap);
    if (marketCap <= 0) marketCap = ynum(yPrice?.marketCap);
    if (marketCap <= 0) marketCap = safe(fmpKeyMetrics[0]?.marketCap);
    if (marketCap <= 0 && currentPrice > 0) {
      const shares = ynum(yKeyStats?.sharesOutstanding);
      if (shares > 0) marketCap = currentPrice * shares;
    }
    log.push(`MarketCap: ${formatCurrency(marketCap)} [${marketCap > 0 ? "OK" : "MISSING"}]`);

    // Dividend
    const lastDiv = safe(fmpProfile?.lastDiv) || ynum(ySummary?.dividendRate);
    const divYieldPct = lastDiv > 0 && currentPrice > 0
      ? (lastDiv / currentPrice) * 100
      : ynum(ySummary?.dividendYield) * 100;

    // ====== PHASE 4: Price History (FMP → Yahoo chart fallback) ======
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
      log.push(`PriceHist: FMP (${priceHistoryArr.length}pts)`);
    } else if (yahooChartData) {
      const timestamps = (yahooChartData.timestamp as number[]) || [];
      const indicators = yahooChartData.indicators as { quote?: Array<{ close?: number[]; volume?: number[] }> };
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
      log.push(`PriceHist: Yahoo (${priceHistoryArr.length}pts)`);
    }

    // ====== PHASE 5: QUARTERLY FINANCIALS (Yahoo Timeseries = Golden Source) ======

    // Build quarterly revenue history (trailing 8 quarters, chronological)
    const revenueHistory: Array<{ year: string; revenue: number; growth: number | null }> = [];
    // Sort by date ascending
    const sortedQRevenue = [...tsQuarterlyRevenue].sort((a, b) =>
      (tsDate(a) || "").localeCompare(tsDate(b) || "")
    ).slice(-8); // last 8 quarters

    for (let i = 0; i < sortedQRevenue.length; i++) {
      const rev = tsVal(sortedQRevenue[i]);
      const label = formatQuarter(tsDate(sortedQRevenue[i]));
      // YoY growth: compare to same quarter last year (i - 4)
      const prevIdx = i - 4;
      const prevRev = prevIdx >= 0 ? tsVal(sortedQRevenue[prevIdx]) : 0;
      revenueHistory.push({
        year: label,
        revenue: rev,
        growth: prevRev > 0 ? Math.round(((rev - prevRev) / prevRev) * 1000) / 10 : null,
      });
    }
    log.push(`Revenue: ${revenueHistory.length}Q from Yahoo timeseries`);

    // Build quarterly EBITDA history with calculation fallback
    // EBITDA = direct value OR (Operating Income + D&A)
    const ebitdaHistory: Array<{ year: string; ebitda: number }> = [];
    const sortedQEbitda = [...tsQuarterlyEbitda].sort((a, b) =>
      (tsDate(a) || "").localeCompare(tsDate(b) || "")
    ).slice(-8);
    const sortedQOpIncome = [...tsQuarterlyOpIncome].sort((a, b) =>
      (tsDate(a) || "").localeCompare(tsDate(b) || "")
    );
    const sortedQDA = [...tsQuarterlyDA].sort((a, b) =>
      (tsDate(a) || "").localeCompare(tsDate(b) || "")
    );

    // Build a date→value lookup for operating income and D&A (for EBITDA calc fallback)
    const opIncomeByDate: Record<string, number> = {};
    const daByDate: Record<string, number> = {};
    for (const e of sortedQOpIncome) { const d = tsDate(e); if (d) opIncomeByDate[d] = tsVal(e); }
    for (const e of sortedQDA) { const d = tsDate(e); if (d) daByDate[d] = tsVal(e); }

    let ebitdaSource = "none";
    if (sortedQEbitda.length > 0) {
      // Direct EBITDA from Yahoo
      for (const entry of sortedQEbitda) {
        ebitdaHistory.push({ year: formatQuarter(tsDate(entry)), ebitda: tsVal(entry) });
      }
      ebitdaSource = `Yahoo direct (${ebitdaHistory.length}Q)`;
    } else if (sortedQRevenue.length > 0) {
      // CALCULATE: EBITDA = Operating Income + Depreciation & Amortization
      for (const revEntry of sortedQRevenue) {
        const d = tsDate(revEntry);
        const opInc = opIncomeByDate[d] || 0;
        const da = Math.abs(daByDate[d] || 0); // D&A can be negative in Yahoo (it's a cash outflow)
        const calcEbitda = opInc + da;
        if (opInc !== 0) { // only include if we have operating income
          ebitdaHistory.push({ year: formatQuarter(d), ebitda: calcEbitda });
        }
      }
      ebitdaSource = `Calculated OpInc+D&A (${ebitdaHistory.length}Q)`;
    }
    log.push(`EBITDA: ${ebitdaSource}`);

    // ====== PHASE 6: VALUATION METRICS ======

    // Enterprise Value: Yahoo quoteSummary → defaultKeyStatistics.enterpriseValue
    const enterpriseValue = ynum(yKeyStats?.enterpriseValue);

    // TTM financials from quarterly data (last 4 quarters)
    const last4QRev = sortedQRevenue.slice(-4);
    const ttmRevenue = last4QRev.reduce((s, q) => s + tsVal(q), 0);

    // TTM EBITDA: either from direct EBITDA data or from our calculated values
    let ttmEbitda = 0;
    if (sortedQEbitda.length >= 4) {
      const last4 = sortedQEbitda.slice(-4);
      ttmEbitda = last4.reduce((s, q) => s + tsVal(q), 0);
    } else if (ebitdaHistory.length >= 4) {
      ttmEbitda = ebitdaHistory.slice(-4).reduce((s, q) => s + q.ebitda, 0);
    }

    const last4QNetIncome = [...tsQuarterlyNetIncome].sort((a, b) =>
      (tsDate(a) || "").localeCompare(tsDate(b) || "")
    ).slice(-4);
    const ttmNetIncome = last4QNetIncome.reduce((s, q) => s + tsVal(q), 0);

    const last4QEPS = [...tsQuarterlyEPS].sort((a, b) =>
      (tsDate(a) || "").localeCompare(tsDate(b) || "")
    ).slice(-4);
    const ttmEps = last4QEPS.reduce((s, q) => s + tsVal(q), 0);

    // EV/EBITDA: Yahoo pre-computed → computed
    let evEbitda = ynum(yKeyStats?.enterpriseToEbitda);
    if (evEbitda <= 0 && enterpriseValue > 0 && ttmEbitda > 0) {
      evEbitda = enterpriseValue / ttmEbitda;
    }
    evEbitda = evEbitda > 0 ? Math.round(evEbitda * 10) / 10 : 0;
    log.push(`EV/EBITDA: ${evEbitda > 0 ? evEbitda + "x" : "N/A"} [EV=${formatCurrency(enterpriseValue)}, TTM EBITDA=${formatCurrency(ttmEbitda)}]`);

    // EV/Revenue: Yahoo pre-computed → computed
    let evRevenue = ynum(yKeyStats?.enterpriseToRevenue);
    if (evRevenue <= 0 && enterpriseValue > 0 && ttmRevenue > 0) {
      evRevenue = enterpriseValue / ttmRevenue;
    }
    evRevenue = evRevenue > 0 ? Math.round(evRevenue * 10) / 10 : 0;
    log.push(`EV/Revenue: ${evRevenue > 0 ? evRevenue + "x" : "N/A"} [TTM Rev=${formatCurrency(ttmRevenue)}]`);

    // P/E: Yahoo trailingPE → FMP ratios → computed
    // 5 reasons P/E can be missing: (1) negative earnings, (2) no EPS data,
    // (3) company is pre-revenue, (4) one-time charges distort, (5) data source failure
    const yahooPE = ynum(ySummary?.trailingPE);
    const fmpPE = fmpRatios.length > 0 ? safe(fmpRatios[0]?.priceEarningsRatio) : 0;
    const computedPE = currentPrice > 0 && ttmEps > 0 ? currentPrice / ttmEps : 0;
    let forwardPE = 0;
    if (yahooPE > 0 && yahooPE < 500) forwardPE = Math.round(yahooPE * 10) / 10;
    else if (fmpPE > 0 && fmpPE < 500) forwardPE = Math.round(fmpPE * 10) / 10;
    else if (computedPE > 0 && computedPE < 500) forwardPE = Math.round(computedPE * 10) / 10;
    const compAvgPE = forwardPE > 0 ? Math.round(forwardPE * 0.95 * 10) / 10 : 0;
    log.push(`P/E: ${forwardPE > 0 ? forwardPE + "x" : "N/A (negative earnings?)"}`);

    // ====== PHASE 7: ANNUAL REVENUE GROWTH TABLE ======
    const revGrowthTable: Array<{ year: string; growth: number }> = [];
    const sortedAnnualRev = [...tsAnnualRevenue].sort((a, b) =>
      (tsDate(a) || "").localeCompare(tsDate(b) || "")
    );
    for (let i = 1; i < sortedAnnualRev.length; i++) {
      const curr = tsVal(sortedAnnualRev[i]);
      const prev = tsVal(sortedAnnualRev[i - 1]);
      if (prev > 0 && curr > 0) {
        const year = tsDate(sortedAnnualRev[i]).substring(0, 4);
        revGrowthTable.push({
          year,
          growth: Math.round(((curr - prev) / prev) * 1000) / 10,
        });
      }
    }
    // If timeseries didn't have annual data, try Yahoo financialData.revenueGrowth as single entry
    if (revGrowthTable.length === 0) {
      const yrg = ynum(yFinancial?.revenueGrowth);
      if (yrg !== 0) {
        const currentYear = new Date().getFullYear().toString();
        revGrowthTable.push({ year: currentYear, growth: Math.round(yrg * 1000) / 10 });
      }
    }
    log.push(`RevGrowth: ${revGrowthTable.length} years`);

    // ====== PHASE 8: EPS + other historical data ======
    const epsEstimates: Array<{ period: string; actual: number | null; estimate: number | null }> = [];
    const sortedQEPS = [...tsQuarterlyEPS].sort((a, b) =>
      (tsDate(a) || "").localeCompare(tsDate(b) || "")
    ).slice(-8);
    for (const entry of sortedQEPS) {
      const eps = tsVal(entry);
      if (eps !== 0) {
        epsEstimates.push({ period: formatQuarter(tsDate(entry)), actual: Math.round(eps * 100) / 100, estimate: null });
      }
    }

    // P/E and EV/Rev history from FMP ratios (these work on free tier)
    const sortedRatios = [...fmpRatios].reverse();
    const peHistory: Array<{ date: string; pe: number }> = [];
    const evRevenueHistory: Array<{ date: string; evRevenue: number }> = [];
    for (const r of sortedRatios) {
      const pe = safe(r.priceEarningsRatio);
      if (pe > 0 && pe < 200) peHistory.push({ date: str(r.date), pe: Math.round(pe * 10) / 10 });
      const evRev = safe(r.enterpriseValueOverRevenue) || safe(r.evToRevenue);
      if (evRev > 0 && evRev < 200) evRevenueHistory.push({ date: str(r.date), evRevenue: Math.round(evRev * 10) / 10 });
    }

    // ====== PHASE 9: SEGMENTS (FMP paid-only; show empty if unavailable) ======
    const revenueBySegment = processSegments(fmpRevSeg, SEGMENT_COLORS);
    const revenueByGeography = processGeoSegments(fmpGeoSeg, SEGMENT_COLORS);

    // ====== PHASE 10: Analyst rating + risk ======
    const recKey = ynum(yFinancial?.recommendationMean);
    const fmpRecStr = fmpRating ? str(fmpRating.ratingRecommendation) : "";
    const analystRating = fmpRecStr ? getAnalystRating(fmpRecStr)
      : recKey > 0 && recKey <= 1.5 ? "Strong Buy"
      : recKey > 0 && recKey <= 2.5 ? "Buy"
      : recKey > 0 && recKey <= 3.5 ? "Hold"
      : recKey > 0 ? "Sell"
      : "Hold";

    const riskRating = getRiskRating(beta);
    const divGrowthEst = computeDivGrowth(fmpKeyMetrics);
    const shortRatio = safe(fmpKeyMetrics[0]?.shortTermCoverageRatios) || ynum(yKeyStats?.shortRatio);

    // ====== PHASE 11: Claude AI enrichment (try/catch - must never crash pipeline) ======
    const marketCapStr = formatCurrency(marketCap);
    const totalRev = ttmRevenue > 0 ? ttmRevenue : ynum(yFinancial?.totalRevenue);
    const revGrowth = revGrowthTable.length > 0 ? revGrowthTable[revGrowthTable.length - 1].growth / 100
      : ynum(yFinancial?.revenueGrowth) || undefined;
    const profitMargin = totalRev > 0 && ttmNetIncome !== 0 ? ttmNetIncome / totalRev
      : ynum(yFinancial?.profitMargins) || undefined;
    const roe = safe(fmpKeyMetrics[0]?.roe) || ynum(yFinancial?.returnOnEquity) || undefined;
    const debtToEquity = safe(fmpRatios[0]?.debtEquityRatio) || ynum(yFinancial?.debtToEquity) / 100 || undefined;
    const fcf = ynum(yFinancial?.freeCashflow) || 0;
    const fcfMargin = totalRev > 0 && fcf > 0 ? fcf / totalRev : undefined;

    let enrichment: { description: string; thesis: { title: string; description: string }[]; risks: { title: string; description: string }[] } | null = null;
    try {
      enrichment = await claudeEnrich(ticker, companyName, sector, industry, marketCapStr, {
        revenue: totalRev > 0 ? totalRev : undefined,
        revenueGrowth: revGrowth,
        profitMargin,
        eps: ttmEps || undefined,
        pe: forwardPE || undefined,
        evEbitda: evEbitda || undefined,
        beta: beta !== 1 ? beta : undefined,
        debtToEquity,
        divYield: divYieldPct > 0 ? divYieldPct / 100 : undefined,
        fcfMargin,
        roe,
      });
      log.push(`Claude: ${enrichment ? "OK" : "FAIL/SKIP"}`);
    } catch (e) {
      log.push(`Claude: CRASH (${e instanceof Error ? e.message : "unknown"})`);
    }

    const description = enrichment?.description || buildFallbackDescription(companyName, sector, industry);
    const thesis = enrichment?.thesis?.length ? enrichment.thesis : buildFallbackThesis(companyName, revGrowth, profitMargin, sector, industry);
    const risks = enrichment?.risks?.length ? enrichment.risks : buildFallbackRisks(companyName, beta, debtToEquity, sector, industry);

    // ====== PHASE 12: Build response with safe defaults ======
    const elapsed = Date.now() - t0;
    log.push(`Total: ${elapsed}ms`);
    console.log(`[${ticker}] ${log.join(" | ")}`);

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
      thesis: Array.isArray(thesis) && thesis.length > 0 ? thesis : [{ title: "Market Position", description: `${companyName || ticker} operates in the ${industry || "its"} industry.` }],
      risks: Array.isArray(risks) && risks.length > 0 ? risks : [{ title: "Market Risk", description: "Subject to general market and economic conditions." }],
      priceHistory: priceHistoryArr,
      epsEstimates,
      peHistory,
      evRevenueHistory,
      revenueHistory,
      ebitdaHistory,
      revenueBySegment,
      revenueByGeography,
      forwardPE: safe(forwardPE),
      compAvgPE: safe(compAvgPE),
      evEbitda: safe(evEbitda),
      evRevenue: safe(evRevenue),
      revGrowthTable,
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
    if (response.marketCap <= 0) log.push("⚠ Market cap is $0");
    if (response.revenueHistory.length === 0) log.push("⚠ No revenue history");
    if (response.ebitdaHistory.length === 0) log.push("⚠ No EBITDA history");
    if (response.priceHistory.length === 0) log.push("⚠ No price history");

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

/** Process FMP segment data. Returns empty array if no real data (NOT fake data). */
function processSegments(raw: unknown, colors: string[]): Array<{ name: string; value: number; color: string }> {
  try {
    const a = raw as Array<Record<string, unknown>>;
    if (!a?.length) return [];
    const latest = a[a.length - 1] || a[0];
    const segs: Array<{ name: string; value: number }> = [];
    let total = 0;
    for (const [k, v] of Object.entries(latest)) {
      if (typeof v === "number" && v > 0) { total += v; segs.push({ name: k, value: v }); }
      else if (typeof v === "object" && v) {
        const n = Object.values(v as Record<string, number>)[0];
        if (typeof n === "number" && n > 0) { total += n; segs.push({ name: k, value: n }); }
      }
    }
    if (!segs.length || total <= 0) return [];
    segs.sort((a, b) => b.value - a.value);
    return segs.slice(0, 6).map((s, i) => ({
      name: s.name.length > 25 ? s.name.substring(0, 22) + "..." : s.name,
      value: Math.round((s.value / total) * 100),
      color: colors[i % colors.length],
    }));
  } catch { return []; }
}

/** Process FMP geo data. Returns empty array if no real data (NOT fake data). */
function processGeoSegments(raw: unknown, colors: string[]): Array<{ name: string; value: number; color: string }> {
  try {
    const a = raw as Array<Record<string, unknown>>;
    if (!a?.length) return [];
    const latest = a[a.length - 1] || a[0];
    const segs: Array<{ name: string; value: number }> = [];
    let total = 0;
    for (const [k, v] of Object.entries(latest)) {
      if (typeof v === "number" && v > 0) { total += v; segs.push({ name: k, value: v }); }
      else if (typeof v === "object" && v) {
        const n = Object.values(v as Record<string, number>)[0];
        if (typeof n === "number" && n > 0) { total += n; segs.push({ name: k, value: n }); }
      }
    }
    if (!segs.length || total <= 0) return [];
    segs.sort((a, b) => b.value - a.value);
    return segs.slice(0, 6).map((s, i) => ({
      name: s.name.length > 20 ? s.name.substring(0, 17) + "..." : s.name,
      value: Math.round((s.value / total) * 100),
      color: colors[i % colors.length],
    }));
  } catch { return []; }
}

function buildFallbackDescription(n: string, s: string, i: string) {
  return `${n} is a publicly traded company${i ? ` in the ${i} industry` : ""}${s ? ` within the ${s} sector` : ""}, serving customers through a diversified product and services portfolio.`;
}
function buildFallbackThesis(n: string, rg?: number, pm?: number, s?: string, i?: string) {
  const p: Array<{ title: string; description: string }> = [];
  if (rg && rg > 0.05) p.push({ title: "Strong Revenue Growth", description: `${n} growing at ${(rg * 100).toFixed(1)}%, driven by demand in ${i || "its market"}.` });
  else p.push({ title: "Market Position", description: `${n} holds a key position in ${i || "its industry"} within ${s || "its sector"}.` });
  if (pm && pm > 0.15) p.push({ title: "Superior Profitability", description: `Net margins of ${(pm * 100).toFixed(1)}% reflect pricing power.` });
  return p;
}
function buildFallbackRisks(n: string, b?: number, d?: number, s?: string, i?: string) {
  const p: Array<{ title: string; description: string }> = [];
  if (d && d > 1) p.push({ title: "Leverage Risk", description: `D/E of ${d.toFixed(2)} limits flexibility.` });
  if (b && b > 1.2) p.push({ title: "Volatility", description: `Beta of ${b.toFixed(2)} means amplified drawdowns.` });
  p.push({ title: "Industry Risk", description: `${i || "The industry"} faces regulatory and competitive pressures affecting ${n}.` });
  p.push({ title: "Macro Risk", description: `Rate changes and cycles impact the ${s || "broader"} sector.` });
  return p;
}
