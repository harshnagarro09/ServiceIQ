// Shared domain types for ServiceIQ.

export type Region = 'North' | 'South' | 'East' | 'West' | 'Central';
export type Segment = 'Premium' | 'Mid-Market' | 'Value' | 'Fleet';
export type Scheme =
  | '10% Service Discount'
  | '₹500 Discount Voucher'
  | 'Free Car Wash'
  | 'Free Engine Check'
  | 'Service + Car Wash Bundle';
export type CampaignStatus = 'Planned' | 'Active' | 'Completed';

export interface Center {
  id: string;
  name: string;
  city: string;
  region: Region;
}

/** One row of service_performance.csv — month x service center x customer segment. */
export interface PerfRow {
  month: string;            // YYYY-MM
  centerId: string;
  region: Region;
  segment: Segment;
  visits: number;
  revenue: number;          // ₹ lakh
  cost: number;             // ₹ lakh — cost of service
  grossProfit: number;      // ₹ lakh
  due: number;              // customers due for a repeat visit
  retained: number;         // ... of which returned
  campaignId: string;       // '' when no campaign ran in this row
  scheme: Scheme | '';
  promoSpend: number;       // ₹ lakh
  incrVisits: number;
  incrRevenue: number;      // ₹ lakh (already included in `revenue`)
  incrGrossProfit: number;  // ₹ lakh (already included in `grossProfit`)
}

export interface CampaignPlan {
  id: string;
  name: string;
  scheme: Scheme;
  region: Region;
  segment: Segment;
  startMonth: string;
  endMonth: string;
  status: CampaignStatus;
  investment: number;            // ₹ lakh planned
  expectedRoi: number;           // x
  expectedIncrRevenue: number;   // ₹ lakh
  expectedIncrVisits: number;
  designNote: string;
}

export interface Dataset {
  centers: Center[];
  rows: PerfRow[];
  campaigns: CampaignPlan[];
  months: string[];       // sorted, e.g. 2025-04 … 2026-03
  latestMonth: string;
}

/** Slice of the network to look at. 'All' = no restriction. */
export interface Scope {
  region: Region | 'All';
  centerId: string | 'All';
  segment: Segment | 'All';
}

export interface Metrics {
  revenue: number;        // ₹ lakh
  organicRevenue: number; // revenue excluding promotion-driven revenue
  visits: number;
  asv: number;            // ₹ per visit
  grossProfit: number;
  grossMargin: number;    // %
  promoSpend: number;
  incrRevenue: number;
  incrVisits: number;
  incrGrossProfit: number;
  roi: number | null;     // incremental gross profit / promo spend — null when no spend
  incrNetProfit: number;  // incremental gross profit - promo spend
  due: number;
  retained: number;
  retention: number;      // %
}
