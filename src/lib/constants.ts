import type { Region, Scheme, Segment } from './types.ts';

export const REGIONS: Region[] = ['North', 'South', 'East', 'West', 'Central'];
export const SEGMENTS: Segment[] = ['Premium', 'Mid-Market', 'Value', 'Fleet'];
export const SCHEMES: Scheme[] = [
  '10% Service Discount',
  '₹500 Discount Voucher',
  'Free Car Wash',
  'Free Engine Check',
  'Service + Car Wash Bundle',
];

/** Portfolio ROI target (x) — incremental gross profit per ₹1 of promotion spend. */
export const ROI_TARGET = 1.3;

/** ROI definition, shown wherever ROI is displayed. */
export const ROI_DEFINITION = 'ROI = incremental gross profit ÷ promotion spend. 1.0x is break-even.';

export const SCHEME_COLORS: Record<Scheme, string> = {
  '10% Service Discount': '#0ea5e9',
  '₹500 Discount Voucher': '#f59e0b',
  'Free Car Wash': '#10b981',
  'Free Engine Check': '#ef4444',
  'Service + Car Wash Bundle': '#8b5cf6',
};
