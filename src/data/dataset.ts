// Browser entry point for the data. ONE CSV in /data is the source of truth — every page, chart, KPI and
// the AI agents read from the objects exported here. Regenerate the file with: npm run data:generate

import csv from '../../data/serviceiq_master_dataset.csv?raw';
import { buildDataset } from '@/lib/buildDataset';
import { buildBenchmark } from '@/lib/benchmark';

/** Our own records: performance (Actual) and campaign plans (Plan). */
export const dataset = buildDataset(csv);

/** External competitor offers (record_type = Competitor) from the same file — illustrative market data. */
export const benchmark = buildBenchmark(csv);
