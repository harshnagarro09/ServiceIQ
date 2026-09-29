// Browser entry point for the dataset. The single master CSV in /data is the source of
// truth — every page, chart, KPI and the AI Advisor read from the `dataset` exported here.
// Regenerate the file with: npm run data:generate

import masterCsv from '../../data/serviceiq_master_dataset.csv?raw';
import benchmarkCsv from '../../data/competitor_benchmark_dataset.csv?raw';
import { buildDataset } from '@/lib/buildDataset';
import { buildBenchmark } from '@/lib/benchmark';

export const dataset = buildDataset(masterCsv);

/** External competitor promotion benchmark (illustrative market data, separate from our own master file). */
export const benchmark = buildBenchmark(benchmarkCsv);
