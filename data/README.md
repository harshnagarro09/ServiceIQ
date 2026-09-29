# ServiceIQ — the dataset

`serviceiq_master_dataset.csv` is the **only** data file. The Dashboard, Planning, Simulation, Campaign Performance and every AI agent read from it, so all numbers agree.

It is synthetic (but internally consistent) data for a 10-center automotive servicing network, FY 2025-26 (Apr 2025 – Mar 2026), plus illustrative, anonymised competitor offers.

Regenerate (deterministic, seeded): `npm run data:generate` · validate: `npm run check`
The file is UTF-8 with BOM so Excel displays `₹` correctly. Money is in **₹ lakh** unless noted.

## One file, three record types
720 rows × 44 columns. The first column, `record_type`, says what a row is:

| `record_type` | rows | meaning | columns used |
|---|---|---|---|
| `Actual` | 480 | measured performance, one row per **month × service center × customer segment** (Apr 2025 – Mar 2026) | identity, performance, campaign |
| `Plan` | 21 | campaign months after the data window (remaining months of active campaigns, planned campaigns) — plan values only, every actual is 0 | identity, campaign |
| `Competitor` | 219 | external market data: a competitor's offer in a region in a month (5 competitors, Jan–Mar 2026) | competitor columns (performance columns are blank) |

Rows leave the other type's columns blank. Campaign attributes are repeated on every row of a campaign and plan amounts are allocated additively, so `SUM` grouped by `campaign_id` gives campaign totals (actual and plan) and the spend planned in each month.

## Columns

**Our records — `Actual` and `Plan` rows (30 columns)**

| group | columns |
|---|---|
| Identity | `record_type`, `month` (YYYY-MM), `fiscal_month` (1 = April), `center_id`, `center_name`, `city`, `region`, `segment` |
| Performance | `service_visits`, `service_revenue_lakh`, `cost_of_service_lakh`, `gross_profit_lakh`, `avg_service_value_inr` (derived), `customers_due`, `customers_retained` |
| Campaign | `campaign_id`, `campaign_name`, `scheme`, `campaign_status` (Planned/Active/Completed), `campaign_start`, `campaign_end`, `campaign_design_note`, `expected_roi` — blank when no campaign ran in the row |
| Campaign plan (allocated) | `planned_promo_spend_lakh`, `expected_incremental_revenue_lakh`, `expected_incremental_visits` |
| Campaign actuals | `promo_spend_lakh`, `incremental_visits`, `incremental_revenue_lakh`, `incremental_gross_profit_lakh` (already included in the performance totals) |

**Competitor observations — `Competitor` rows (14 further columns; `month` and `region` are shared)**

| column | meaning |
|---|---|
| `competitor_id`, `competitor_name`, `competitor_type` | anonymised competitor (A–E) and its type (multi-brand chain, OEM network, app aggregator, express chain, independent garages) |
| `mechanic` | the competitor's offer type (e.g. Percentage service discount, Fixed-value voucher, Free inspection) |
| `our_equivalent_scheme` | which of OUR five schemes it is comparable with |
| `offer_description` | plain-language description |
| `discount_depth_pct` | offer value as % of the ₹6,910 average service ticket (comparable across offer types) |
| `offer_value_inr`, `validity_days` | value in ₹ and how long the offer lasts |
| `repair_credit_inr` | repair credit bundled with a free inspection (0 = none) |
| `channel`, `market_reach_pct` | where it is sold and estimated share of local customers exposed |
| `source_type`, `confidence` | how it was collected (public price list / mystery shopper / app listing) and confidence |

**Our own offer terms** (depth, validity, repair credit) are configuration in `src/lib/benchmark.ts` (`OUR_TERMS`), not measured data.

## Definitions
- **Gross margin** = gross profit ÷ service revenue (before promotion spend)
- **Promotion ROI** = incremental gross profit ÷ promotion spend (1.0x = break-even). Target: 1.30x
- **Customer retention** = customers retained ÷ customers due
- **Baseline** (planning/simulation) = same months of FY 2025-26 excluding promotion-driven revenue, +6% growth

`npm run check` verifies this folder contains exactly this one CSV.
