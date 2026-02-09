export interface StockData {
  companyName: string;
  ticker: string;
  marketCap: number;
  sector: string;
  industry: string;
  dividendYield: number;
  dividendGrowthEst: number;
  shortInterestRatio: number;
  analystRating: string;
  riskRating: string;
  appropriatenessRating: string;
  description: string;
  thesis: ThesisPoint[];
  risks: RiskPoint[];
  priceHistory: PricePoint[];
  epsEstimates: EPSPoint[];
  peHistory: PEPoint[];
  evRevenueHistory: EVRevenuePoint[];
  revenueHistory: RevenuePoint[];
  ebitdaHistory: EBITDAPoint[];
  revenueBySegment: SegmentData[];
  revenueByGeography: SegmentData[];
  forwardPE: number;
  compAvgPE: number;
  evEbitda: number;
  evRevenue: number;
  revGrowthTable: RevGrowthPoint[];
  currentPrice: number;
  priceChange: number;
  priceChangePercent: number;
  generatedDate: string;
  analystName: string;
  firmName: string;
  telephone: string;
  citations: Citation[];
}

export interface PricePoint {
  date: string;
  close: number;
  volume: number;
}

export interface EPSPoint {
  period: string;
  actual: number | null;
  estimate: number | null;
}

export interface PEPoint {
  date: string;
  pe: number;
}

export interface EVRevenuePoint {
  date: string;
  evRevenue: number;
}

export interface RevenuePoint {
  year: string;
  revenue: number;
  growth: number | null;
}

export interface EBITDAPoint {
  year: string;
  ebitda: number;
}

export interface RevGrowthPoint {
  year: string;
  growth: number;
}

export interface SegmentData {
  name: string;
  value: number;
  color: string;
}

export interface ThesisPoint {
  title: string;
  description: string;
}

export interface RiskPoint {
  title: string;
  description: string;
}

export interface Citation {
  source: string;
  url: string;
  description: string;
  accessDate: string;
}

export interface NewsArticle {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
  imageUrl?: string;
}
