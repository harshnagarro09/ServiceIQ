# ServiceIQ — master dataset

`serviceiq_master_dataset.csv` is the **only** data source of the app. The Dashboard, Planning,
Simulation, Campaign Performance and AI Advisor all read from it, so their numbers always agree.

It is synthetic (but internally consistent) data for a 10-center automotive servicing network,
FY 2025-26 (Apr 2025 – Mar 2026).

Regenerate (deterministic, seeded): `npm run data:generate` · validate: `npm run check`
The file is UTF-8 with BOM so Excel displays `₹` correctly. Money is in **₹ lakh** unless noted.

## Structure
One row per **month × service center × customer segment**, 501 rows × 30 columns.

| `record_type` | rows | meaning |
|---|---|---|
| `Actual` | 480 | measured performance for Apr 2025 – Mar 2026 |
| `Plan` | 21 | campaign months after the data window (active campaigns' remaining months and planned campaigns). Plan values only; every actual measure is 0 |

Campaign attributes are repeated on every row of a campaign and plan amounts are allocated
additively, so `SUM(...)` grouped by `campaign_id` gives campaign totals (actual and plan).

## Columns
| group | columns |
|---|---|
| Dimensions | `record_type`, `month` (YYYY-MM), `fiscal_month` (1 = April), `center_id`, `center_name`, `city`, `region` (North/South/East/West/Central), `segment` (Premium/Mid-Market/Value/Fleet) |
| Performance | `service_visits`, `service_revenue_lakh`, `cost_of_service_lakh`, `gross_profit_lakh`, `avg_service_value_inr` (derived), `customers_due`, `customers_retained` |
| Campaign | `campaign_id`, `campaign_name`, `scheme`, `campaign_status` (Planned/Active/Completed), `campaign_start`, `campaign_end`, `campaign_design_note`, `expected_roi` — blank when no campaign ran in the row |
| Campaign plan (allocated) | `planned_promo_spend_lakh`, `expected_incremental_revenue_lakh`, `expected_incremental_visits` |
| Campaign actuals | `promo_spend_lakh`, `incremental_visits`, `incremental_revenue_lakh`, `incremental_gross_profit_lakh` (already included in the performance totals) |

## Definitions
- **Gross margin** = gross profit ÷ service revenue (before promotion spend)
- **Promotion ROI** = incremental gross profit ÷ promotion spend (1.0x = break-even). Target: 1.30x
- **Customer retention** = customers retained ÷ customers due
- **Baseline** (planning/simulation) = same months of FY 2025-26 excluding promotion-driven revenue, +6% growth

---

# External benchmark — `competitor_benchmark_dataset.csv`

The **only other file** in this folder. It is *external market data* (what competitors offer), so it is kept separate from our own master dataset. It is illustrative and anonymised (Competitor A–E); replace it with real market intelligence in the same format.

One row per **competitor × region × offer × month** (219 rows: 5 competitors, Jan–Mar 2026).

| column | meaning |
|---|---|
| `observation_month` | month the offer was observed |
| `competitor_id`, `competitor_name`, `competitor_type` | anonymised competitor and its type (multi-brand chain, OEM network, app aggregator, express chain, independent garages) |
| `region` | where the offer was observed |
| `mechanic` | the competitor's offer type (e.g. Percentage service discount, Fixed-value voucher, Free inspection) |
| `our_equivalent_scheme` | which of OUR five schemes it is comparable with |
| `offer_description` | plain-language description |
| `discount_depth_pct` | offer value as % of the ₹6,910 average service ticket (comparable across offer types) |
| `offer_value_inr` | offer value in ₹ |
| `validity_days` | how long the offer is valid |
| `repair_credit_inr` | repair credit bundled with a free inspection (0 = none) |
| `channel`, `market_reach_pct` | where it is sold and estimated share of local customers exposed |
| `source_type`, `confidence` | how it was collected (public price list / mystery shopper / app listing) and confidence |

**Our own offer terms** (depth, validity, repair credit) are configuration in `src/lib/benchmark.ts` (`OUR_TERMS`), not measured data.
`npm run check` verifies this folder contains exactly these two CSVs.