# ServiceIQ — Complete Documentation

*One document for the whole project: the data, the model, every page and — in depth — every AI agent. All numbers are computed from the datasets in this repository (`data/`), and were re-verified against the running code.*

---

## Contents
1. [What ServiceIQ is](#1-what-serviceiq-is)
2. [Architecture at a glance](#2-architecture-at-a-glance)
3. [The data](#3-the-data)
4. [Metric dictionary](#4-metric-dictionary)
5. [The models behind the numbers](#5-the-models-behind-the-numbers)
6. [Page 1 — Dashboard](#6-page-1--dashboard)
7. [Page 2 — Planning](#7-page-2--planning)
8. [Page 3 — Simulation](#8-page-3--simulation)
9. [Page 4 — Campaign Performance](#9-page-4--campaign-performance)
10. [Page 5 — AI Advisor and the agents](#10-page-5--ai-advisor-and-the-agents)
11. [The seven agents, in depth](#11-the-seven-agents-in-depth)
12. [The chat orchestrator, in depth](#12-the-chat-orchestrator-in-depth)
13. [End-to-end story and demo scripts](#13-end-to-end-story-and-demo-scripts)
14. [Questions your manager may ask](#14-questions-your-manager-may-ask)
15. [Limitations, honesty notes and roadmap](#15-limitations-honesty-notes-and-roadmap)
16. [Cheat sheet of numbers](#16-cheat-sheet-of-numbers)

---

## 1. What ServiceIQ is

### The business
A network of **10 car-service centers** in 5 regions of India earns **service revenue** from periodic maintenance, brake work, AC service and so on. To attract customers it runs **promotions**. Promotions cost money, so management must know:

- Which promotions earn **more than they cost**?
- Where (region, customer type) do they work?
- If we have a budget next quarter, **where should it go**?
- How do **competitors'** offers compare with ours, and where are we losing ground?
- Are live campaigns on track — and are we learning from past ones?

### What is being targeted (it is *not* GMV)
The app does not try to maximise total sales value. It targets **profitable revenue growth from promotions**:

| Role | Metric |
|---|---|
| **Main target** | **Promotion ROI** = extra gross profit ÷ promotion spend (bar: **1.30x**, break-even 1.0x) |
| Supporting | Net profit after promotion cost, service revenue, visits, gross margin, customer retention |
| Closest thing to GMV | *Service revenue* — shown, but never optimised at the expense of profit |

A promotion that adds revenue but loses money (e.g. Free Engine Check) counts as a **bad** result.

### The storyline the app follows
**Understand → Plan → Simulate → Execute → Learn**, with the AI Advisor available at every step.

| Step | Page | Question |
|---|---|---|
| Understand | **Dashboard** | How are we doing, and where are the problems and opportunities? |
| Plan | **Planning** | Which campaigns should we run next, at what size, and are targets realistic? |
| Simulate | **Simulation** | If we change a campaign's scheme, budget, length or discount depth, what happens? |
| Execute · Learn | **Campaign Performance** | Are live campaigns healthy? Did past ones deliver? What did they teach us? |
| Ask | **AI Advisor** | Seven specialist agents plus a chat that answers in plain English. |

### Vocabulary

| Term | Plain meaning |
|---|---|
| **₹ lakh (L)** | ₹1,00,000. ₹100L = ₹1 crore. All money is in lakh. |
| **Visit / ASV** | One car in for service / revenue per visit (Average Service Value) |
| **Gross profit, margin** | Revenue minus the direct cost of the service; margin is that as a % of revenue |
| **Organic / baseline** | What we would earn *without* any promotion |
| **Incremental** | Extra visits/revenue/profit that exist *because of* a promotion |
| **Scheme** | A type of promotion (10% Service Discount, ₹500 Voucher, Free Car Wash, Free Engine Check, Service + Car Wash Bundle) |
| **Campaign** | One run of a scheme in one region for one segment over some weeks |
| **Segment** | Type of customer: Premium, Mid-Market, Value, Fleet |
| **Offer depth** | Value of the offer as a % of the average service ticket (₹6,910) — lets us compare a 10% discount with a ₹500 voucher |
| **Slice** | A region × segment pair (e.g. "South · Mid-Market") — the unit a campaign targets |
| **Guardrail** | A limit a scenario must respect (minimum ROI, maximum spend intensity) |
| **Spend intensity** | Promotion cost ÷ baseline revenue of the same window |

---

## 2. Architecture at a glance

```
data/serviceiq_master_dataset.csv          ← ONE CSV (720 rows × 44 cols), three record types:
                                               Actual (480) + Plan (21) = OUR performance & campaigns
                                               Competitor (219)         = EXTERNAL competitor offers
        │
src/lib/buildDataset.ts, benchmark.ts      ← load, validate and type both files
        │
src/lib/analytics.ts   filters, totals, trends, scheme/region/campaign results
src/lib/simulation.ts  baseline, response model, offer-depth model, scenarios
src/lib/insights.ts    Dashboard alerts/opportunities, campaign "learnings"
src/lib/benchmark.ts   market position, competitor pressure, gap suggestions
src/lib/planner.ts     campaign calendar, health monitor, guardrails, AI alternative
src/lib/agents.ts      the 7 agents (structured reports)
src/lib/advisor.ts     the chat orchestrator (routes questions to agents)
        │
src/pages/*.tsx  +  src/components/*       ← the 5 pages, charts, forms
```

Key design decisions:
- **Pure logic in `lib/`, screens in `pages/`.** The same logic runs in the browser and in Node (`npm run check`), so it is tested without a UI.
- **Our data is one file.** Every page and every agent reads the master dataset, so numbers can never disagree between pages. The competitor file is separate because it is *external market data*.
- **Shared state** (in `App.tsx`): the **Plan** (period, scope, targets, budget, objective) and the **decisions** (accept / reject / modify each recommended campaign). Change either and the Simulation, Campaign Performance and every agent respond.
- **Nothing is typed in.** Alerts, learnings, recommendations, agent findings and chat answers are all computed.

### Commands
| Command | Purpose |
|---|---|
| `npm run dev` | Start the app at http://localhost:5173 |
| `npm run build` | Production build |
| `npm run typecheck` / `npm run lint` | Code quality |
| `npm run data:generate` | Recreate the single CSV (seeded → identical every time) |
| `npm run check` | **98 automated checks** on data integrity, reconciliation, analytics, simulation, planner, monitor, benchmark, all 7 agents and 20 chat questions |

---

## 3. The data

### 3.1 Master dataset — `serviceiq_master_dataset.csv`
*Synthetic but internally consistent; generated by `scripts/generate-dataset.mjs` (seeded).*

**Granularity:** one row per **month × service center × customer segment**.
- 12 months (Apr 2025 – Mar 2026 = FY 2025-26) × 10 centers × 4 segments = **480 `Actual` rows**
- plus **21 `Plan` rows** (campaign months after March 2026: remaining months of active campaigns and the planned campaigns) → **501 rows of our own data** (plus 219 competitor rows in the same file, §3.2 → **720 rows × 44 columns** in total)

**Network:** North (Delhi, Jaipur) · South (Bengaluru, Hyderabad, Chennai) · East (Kolkata) · West (Mumbai, Pune) · Central (Nagpur, Indore).

**The 30 columns**

| Group | Columns |
|---|---|
| Identity | `record_type` (Actual/Plan), `month`, `fiscal_month`, `center_id`, `center_name`, `city`, `region`, `segment` |
| Performance | `service_visits`, `service_revenue_lakh`, `cost_of_service_lakh`, `gross_profit_lakh`, `avg_service_value_inr`, `customers_due`, `customers_retained` |
| Campaign descriptors *(blank if no campaign)* | `campaign_id`, `campaign_name`, `scheme`, `campaign_status`, `campaign_start`, `campaign_end`, `campaign_design_note`, `expected_roi` |
| Campaign plan (allocated to rows) | `planned_promo_spend_lakh`, `expected_incremental_revenue_lakh`, `expected_incremental_visits` |
| Campaign actuals | `promo_spend_lakh`, `incremental_visits`, `incremental_revenue_lakh`, `incremental_gross_profit_lakh` |

**How campaigns are encoded (important):** campaign details are repeated on every row of the campaign, and plan amounts are *split across rows*. So a `SUM` grouped by `campaign_id` gives the campaign total — for actuals and for plan. Campaign results therefore **cannot disagree** with Dashboard totals. `Plan` rows feed only campaign plan totals and never touch performance metrics, so the "latest month" stays March 2026.

**Three real rows**
- *Normal:* Delhi Downtown · Premium · Mar 2026 — 159 visits, ₹16.808L revenue, ₹7.317L gross profit (margin 43.5%), ASV ₹10,571, 127 due / 117 retained (92.1%).
- *Campaign:* Bengaluru Whitefield · Premium · Jan 2026 — 223 visits, ₹23.124L revenue; campaign **CMP-2508 Winter Wash Bundle**: spend ₹0.976L, +35 visits, +₹3.475L revenue, +₹1.497L gross profit → row ROI 1.53x against a 1.40x plan.
- *Plan:* Kolkata · Mid-Market · Apr 2026 — CMP-2512 Spring Refresh Promo, planned spend ₹0.8L, expected +₹2.8L revenue; every actual column is 0.

**Profile (full year)**

| Segment | Revenue | Share | ASV | Margin | Retention | Promo ROI |
|---|---|---|---|---|---|---|
| Premium | ₹1,503L | 26% | ₹9,946 | 43.4% | 92.3% | 1.46x |
| Mid-Market | ₹2,458L | 42% | ₹6,915 | 39.4% | 89.4% | 1.48x |
| Value | ₹1,066L | 18% | ₹4,688 | 34.3% | 86.4% | 1.23x |
| Fleet | ₹790L | 14% | ₹7,322 | 33.5% | **84.3%** | **1.01x** |

| Region | Revenue | Share | Promo spend | ROI |
|---|---|---|---|---|
| South | ₹1,989L | 34% | ₹17.7L | 1.37x |
| West | ₹1,478L | 25% | ₹18.5L | 1.44x |
| North | ₹1,119L | 19% | ₹12.5L | 1.34x |
| Central | ₹794L | 14% | ₹6.4L | 1.41x |
| East | ₹436L | 7% | ₹4.0L | 1.27x |

**Full-year totals:** revenue **₹5,816.7L**, visits **84,180**, ASV **₹6,910**, margin **38.7%**, retention **88.4%**, promotion spend **₹59.1L** (~1% of revenue) → **₹212.3L** promotion-driven revenue → **1.38x** ROI, **₹22.6L** net promotion profit.

**Stories deliberately built into the data** (so the analytics have something to discover)
1. Seasonality + growth: ₹413L (Apr) → ₹541L peak (Jan).
2. Promotion cliffs: Feb −8.4%, Mar −3.1% as big campaigns end.
3. Scheme hierarchy: Bundle 1.50x ≈ 10% Discount 1.48x > Car Wash 1.39x > Voucher 1.15x > Engine Check 0.99x.
4. Free Engine Check fails three times (0.92x, 1.01x, 1.02x): "free check, no repair credit".
5. 60-day vouchers underperform (1.11x, 1.16x vs 1.30x plan); 90-day ones are closer to plan.
6. Fleet is structurally weak (lowest margin and retention, ROI 1.01x, least promotion money).
7. March price squeeze: South Premium ASV falls ~6.5%.
8. East has no Bundle campaign and little competition.

**Quality safeguards.** The loader throws on unknown regions/segments/schemes, on non-numeric values, and on a campaign whose attributes differ between rows. `npm run check` additionally verifies: exactly ONE CSV in `/data`; 720 rows = 480 Actual + 21 Plan + 219 Competitor across 44 columns; plan rows carry no actuals; competitor rows carry no performance figures; each campaign's planned spend per month adds up to its investment; no duplicate month/center/segment rows; revenue − cost = gross profit on every row; incremental ≤ total; retained ≤ due; spend only where a campaign ran; campaign spend totals = Dashboard spend; region/segment slices sum to the network.

### 3.2 External benchmark — the `Competitor` rows of the same CSV
*Stored in the same single file as `record_type = Competitor`; the loader reads our rows (`Actual`, `Plan`) into the dataset and the `Competitor` rows into the benchmark. Competitor rows leave the performance columns blank (and our rows leave the competitor columns blank), which is why the file is 44 columns wide.*

*Illustrative and anonymised (Competitor A–E) — replace with real market intelligence in the same format.*

**Granularity:** one row per **competitor × region × offer × month** → **219 rows** (A: 60, B: 60, C: 27, D: 27, E: 45), January–March 2026.

| Column | Meaning |
|---|---|
| `month` | month the offer was observed (`YYYY-MM`) |
| `competitor_id/name/type` | anonymised; types: national multi-brand chain (A), OEM-authorised network (B), app-based aggregator (C), express chain (D), independent garages (E) |
| `region` | where observed (C only in North/South/West; D only South/West/Central) |
| `mechanic` | the competitor's offer type (Percentage service discount, Fixed-value voucher, Free add-on, Free inspection, Service bundle) |
| `our_equivalent_scheme` | which of **our** schemes it is comparable with — the join key to our data |
| `offer_description` | plain language, e.g. "First-booking 20% off in app" |
| `discount_depth_pct` | offer value as % of the ₹6,910 average ticket |
| `offer_value_inr`, `validity_days` | ₹ value and how long it lasts |
| `repair_credit_inr` | repair credit bundled with a free inspection (0 = none) |
| `channel`, `market_reach_pct` | where sold; estimated share of local customers exposed |
| `source_type`, `confidence` | public price list / mystery shopper / app listing; High/Medium |

Example row: `2026-01, COMP-A, National multi-brand chain, North, Percentage service discount → 10% Service Discount, "15% off periodic service", depth 16.5%, ₹1,140, 30 days, no credit, In-store, reach 28%, Public price list, High`.

**Regional aggressiveness built in:** South ×1.25, West ×1.15, North ×1.08, Central ×0.95, East ×0.70. Some competitors' percentage offers escalate ~2%/month in South and West.

**Our own offer terms** (what we compare against) are configuration in `src/lib/benchmark.ts` (`OUR_TERMS`), not measured data:

| Our scheme | Value | Depth | Validity | Repair credit |
|---|---|---|---|---|
| 10% Service Discount | ₹690 | 10.0% | 30 d | none |
| ₹500 Discount Voucher | ₹500 | 7.2% | 60 d | none |
| Free Car Wash | ₹350 | 5.1% | 30 d | none |
| Free Engine Check | ₹450 | 6.5% | 30 d | none |
| Service + Car Wash Bundle | ₹800 | 11.6% | 30 d | none |

---

## 4. Metric dictionary

| Metric | Formula | Example (full year, all) |
|---|---|---|
| Service revenue | Σ revenue | ₹5,816.7L |
| Avg Service Value | revenue × 1,00,000 ÷ visits | ₹6,910 |
| Gross margin | gross profit ÷ revenue (before promotion spend) | 38.7% |
| Promotion-driven revenue | Σ incremental revenue | ₹212.3L |
| **Promotion ROI** | Σ incremental gross profit ÷ Σ promotion spend | 81.7 ÷ 59.1 = **1.38x** |
| Net promotion profit | incremental gross profit − spend | ₹22.6L |
| Customer retention | retained ÷ due | 88.4% |
| Spend intensity | promotion cost ÷ baseline revenue of the window | ~1.0% |

**ROI worked example** — CMP-2508 Winter Wash Bundle: spent ₹4.7L; caused ₹17.0L extra revenue at ~43.5% margin → ₹7.4L extra gross profit. ROI = 7.4 ÷ 4.7 = **1.57x** (plan 1.40x); net profit ₹2.7L. *Why gross profit and not revenue?* A ₹100 sale at 40% margin only produces ₹40 of profit; comparing revenue to spend would flatter every promotion.

**ROI status labels:** ≥1.365x *Above target* · 1.235–1.365x *On target* · <1.235x *Below target* (±5% around 1.30x).

---

## 5. The models behind the numbers

### 5.1 Baseline
Baseline for a scope and period = the **same months of FY 2025-26, minus promotion-driven revenue/visits/profit, grown 6%**. Example (Q1, whole network): Apr–Jun revenue 413.5 + 431.9 + 459.0 = ₹1,304.4L, of which promotion-driven 22.1 → organic ₹1,282.3L × 1.06 = **₹1,359.2L**. For a single campaign window, the organic monthly run-rate of the slice is scaled to the campaign's weeks (`weeks ÷ 4.345`) and grown 6%.

### 5.2 Scheme response learned from history
For each scheme, over its past campaigns: **revenue per ₹1 spent** (Σ incremental revenue ÷ Σ spend), **profit margin of incremental revenue**, and a **reference spend intensity**. Bundle: 3.75 revenue per ₹1, 40.0% margin (→ historical ROI 1.50x).

**Evidence tiers.** For a scope like "South · Premium" the model first looks for ≥2 campaigns in exactly that slice, then the segment, then the region, then the whole network. The tier and the campaign count feed the **confidence** score (below).

**Diminishing returns.** Revenue per ₹1 is multiplied by `(spend intensity ÷ reference intensity) ^ −0.12` — larger budgets earn less per rupee. For single-campaign windows the reference is *what past campaigns of that scheme spent relative to their own window* (so a campaign sized like a typical past one reproduces its historical ROI).

*Worked example (network, Q1, ₹15L on Bundle):* intensity 15 ÷ 1,359.2 = 1.10%; reference 0.33% → ratio 3.35 → 3.35^−0.12 = 0.867 → 3.75 × 0.867 = 3.24 revenue per ₹1 → **₹48.6L** extra revenue → ×40% = ₹19.4L gross profit → **ROI 1.30x**, **net ₹4.4L**.

### 5.3 The offer-depth model (used by the Simulation page and the Competitor agent)
Three assumptions, all shown on the Simulation page:
1. **Cost scales with depth:** `cost = budget × (depth ÷ current depth)`.
2. **Take-up scales with depth^0.5:** deeper offers attract more customers, less than proportionally.
3. **Competitor leakage:** 4% of take-up is lost per percentage point our offer is shallower than the competitor median (capped at 40%). Deepening the offer recovers customers: the take-up factor is `(1 − leak(new)) ÷ (1 − leak(current))`.

At today's depth the factors equal 1, so **nothing changes unless you move depth**.

*Worked example — South · Mid-Market, 10% Service Discount, ₹5L, 6 weeks (market median 15.6%):*

| | Depth 10% | Depth 15% |
|---|---|---|
| Promotion cost | ₹5.0L | ₹7.5L (×1.5) |
| Volume factor | 1 | 1.5^0.5 = 1.225 |
| Take-up recovery | leak = 22.4% | leak = 2.4% → (1−0.024)/(1−0.224) = 1.258 |
| Extra revenue | ₹19.6L | ₹30.2L (×1.54) |
| ROI / net profit | 1.50x / ₹2.5L | 1.54x / ₹4.1L |

### 5.4 Confidence score (Planning)
`confidence = 45 + tier bonus + 4 × min(campaigns, 6) − min(40 × ROI spread, 20)`, clamped to 40–95, where tier bonus is slice 25 / segment 15 / region 12 / network 5, and *ROI spread* is the coefficient of variation of the past campaigns' ROIs.
*Example:* South · Mid-Market Bundle → segment tier (15) + 2 campaigns (8) − spread 0.043 × 40 (1.7) = 45 + 15 + 8 − 1.7 = **66%**.

### 5.5 Health score (live campaigns)
`health = 100 × (0.40·c(ROI ÷ plan ROI) + 0.30·c(revenue delivery) + 0.20·c(visit delivery) + 0.10·(1 − |spend pace − 1|))`, with `c(x) = min(max(x, 0), 1.25) ÷ 1.25`. A campaign exactly on plan scores 82. Bands: ≥75 **Healthy**, 55–74 **Watch**, <55 **Critical**.
*Example — Spring Refresh Promo:* ROI 1.22/1.35 = 0.90 → 0.72; delivery 0.84 → 0.68; visits 0.85 → 0.68; pace 0.95 → 0.95 ⇒ 0.4×0.72 + 0.3×0.68 + 0.2×0.68 + 0.1×0.95 = 0.72 → **72 (Watch)**.

---

## 6. Page 1 — Dashboard
*(Unchanged in this release — the manager approved it.)*

**Question:** *How is the business performing, and what needs attention?*

**Filters:** **Period** (Latest month · Last 3 months *(default)* · Last 6 months · Full year) sets the KPI window and the comparison ("vs previous N months"; Full year has none). **Region**, **Service center** (only centers in the chosen region; changing region resets it), **Customer segment**, **Reset filters**.

**KPIs.** Headline: Service Revenue, Gross Margin (change in pp), Promotion-driven Revenue, Promotion ROI (target 1.30x). Supporting: Service Visits, Avg Service Value, Customer Retention, Promotion Spend (neutral colour — spending more is not automatically bad). Green/red pills show movement vs the previous equal period.

**Charts.** Service Revenue Trend (total vs excluding promotions — the gap is the value promotions add) · Service Visits · Gross Margin Trend · Spend vs Incremental Revenue scatter (one dot per scheme; up-and-left is better) · Promotion Performance bars with a 1.30x target marker · Spend Mix donut · Regional Performance table (ignores the Region/Center filters).

**Alerts & opportunities** (computed, respond to Region/Center/Segment, not Period): revenue decline ≥3% MoM (High if ≥5%) with the biggest drags; schemes below the ROI line (High if <1.0x); "extend the best scheme to a region with no campaign", sized from how large past campaigns were relative to their slice; retention gap ≥2pp below the network.

**Default numbers (Last 3 months vs prior 3):** revenue ₹1,517.3L (−2.8%); margin 39.0%; promotion-driven revenue ₹51.9L (−33.1%); ROI 1.37x; visits 21,774; ASV ₹6,969; retention 88.6%; spend ₹14.8L. South ₹512.0L (−7.0%); Fleet ROI 0.92x, retention 84.3%.

**Message:** *"Revenue dipped mainly because promotions cooled off. Two schemes leak money (Engine Check, Voucher); Fleet is weak; the Bundle has room to grow in East."*

---

## 7. Page 2 — Planning

**Question:** *Which campaigns should we run next quarter, at what size, and are our targets realistic?* Audience: commercial / RGM planners.

### Layout, top to bottom
1. **Filter bar (7 filters)** · 2. **Four KPI tiles** · 3. **Plan Targets & Budget** · 4. **AI Recommended Campaigns** · 5. **Needs Attention** · 6. **Already Scheduled** · 7. **Charts** · 8. **Calendar Gaps**

### Filters — exact behaviour

| Filter | Options | Effect |
|---|---|---|
| Planning period | Q1–Q4, H1, H2, Full Year FY 2026-27 | Which months the calendar covers; which months of last year form the baseline |
| Region | All + 5 | Limits recommendations to that region; **resets the center** |
| Service center | centers of the chosen region | Restricts to that center's region (campaigns are region-level) |
| Customer segment | All + 4 | Limits recommendations to that segment |
| Promotion scheme | All + 5 | *List filter only* — shows campaigns using that scheme |
| Campaign purpose | All + 5 purposes | *List filter only* |
| Optimise for | Incremental revenue · ROI · Visits · Net profit | Decides which scheme wins each slice, and the ranking |

Region, center, segment, period and objective are stored in the shared **Plan**, so the Simulation page and the agents use them too. If you haven't typed your own targets, changing scope/period **re-suggests them** (baseline +5%).

### KPI tiles
| Tile | Definition |
|---|---|
| Total upcoming | recommended (not rejected) + already-scheduled campaigns |
| Budget committed | spend **planned inside the selected period** on already-scheduled campaigns + the cost of campaigns you have **accepted**. Only the part of a scheduled campaign that falls in the period counts (not its whole investment), and the tile shows the split, e.g. "₹15.7L scheduled (5) + ₹0.0L accepted (0)". It is ₹0.0L, with an explanation, in periods where nothing is scheduled (Q2–Q4) until you accept campaigns. |
| Needing action | flagged recommendations you have not yet decided |
| Budget at risk | cost of those flagged, undecided campaigns |

### Plan Targets & Budget
Inputs: **Revenue target**, **Service visit target**, **Promotion budget** — validated ("abc" → red error, last valid value kept; commas accepted; **Use suggested targets** = baseline +5%). Two progress bars:
- **Budget allocated to accepted campaigns** vs the plan budget (turns red and explains if exceeded).
- **Projected revenue vs target:** baseline + predicted revenue of accepted campaigns vs the target, with a marker at the baseline and the % of the gap closed.

### How the recommendations are made (Campaign Planner logic)
For every **region × segment slice** in scope that is *not already covered* by a Planned/Active campaign in the period:
1. Evaluate all 5 schemes at a **campaign sized like past ones** (share of the slice's revenue that past campaigns of the scheme spent), scheme-specific default length (Discount 6 w, Voucher 8, Car Wash 6, Engine Check 4, Bundle 8), current offer depth, through the response + depth model.
2. Drop schemes whose predicted ROI is below 1.0x (never recommend a loss-maker if an alternative exists).
3. **Diversify:** no scheme may take more than `max(2, ⌈40% × slices⌉)` campaigns (6 of 14 now); a slice takes its best scheme that still has capacity.
4. Rank slices by the chosen objective, keep the **top 14**, stagger start dates 5 days apart.
5. Give each a **Purpose**, the first that applies: *Recover decline* (slice revenue ≥4% down vs the prior 3 months) → *Defend vs competitor* (competitors ≥3pp deeper on the equivalent offer) → *Improve retention* (slice retention ≥2pp below network) → *Fill coverage gap* (never had a campaign) → *Scale a winner*.
6. Add **flags** and decide **Needs Attention** (ROI below 1.30x, or confidence below 65%).

For Q1 FY 2026-27 this yields **14 campaigns, ₹31.0L budget, ₹114L predicted extra revenue, ₹14.4L net profit, 4 flagged**; 5 slices are excluded because campaigns CMP-2512, 2513, 2521, 2601, 2602 already cover them; one calendar gap remains (East · Fleet). Mix: Bundle 6, 10% Discount 4, Free Car Wash 4; purposes: 5 Recover decline, 4 Improve retention, 2 Defend vs competitor, 2 Scale a winner, 1 Fill coverage gap.

### The campaign table (each row)
Title and tags (*Competitor deeper by …pp*, *Modified*) · green offer line (terms, depth, segment) · one-line rationale · **Purpose** (dark chip) · **start date and duration** · **budget** · **Predicted**: extra visits, ROI (green ≥1.30x, amber ≥1.0x, red below), extra revenue · **confidence** · **Accept / Reject / Modify** (after a decision: a status chip and **Undo**). **Modify** opens the Simulation for that campaign.

### Charts
- **Predicted ROI by Campaign** (top 8, target marker 1.30x)
- **Budget by Scheme** donut (rejected campaigns excluded)
- **Competitor Pressure by Region** — average depth gap in pp (market median − ours); South +3.8, North +2.8, West +2.9, Central +0.5, East −1.2
- **Historical Context** — same months last year for the scope

### Demo flow
1. Defaults: Q1, network, optimise net profit, budget ₹15L; baseline ₹1,359L, suggested target ₹1,427L.
2. Read the tiles, then the table: point at *Purpose*, the *Competitor deeper by…pp* tags, predicted ROI, confidence.
3. **Accept** two campaigns: *Budget committed* rises (e.g. ₹15.7L → ₹22.2L after one accept), progress bars move. **Undo**.
4. Set **Region = South**: list narrows to South's slices; targets re-suggest.
5. Type `abc` in Revenue target → error → `1,500` → cleared.
6. Change **Optimise for** → ranking changes.
7. Click **Modify** on a South campaign → Simulation.

**Key message:** *"The plan is a calendar of specific, sized campaigns with predicted results and a confidence level — and the plan is checked against the target and the budget as you accept them."*

---

## 8. Page 3 — Simulation

**Question:** *If we change this campaign's scheme, budget, length or discount depth, what happens — and does it respect our guardrails?*

### Layout
Filter bar (period, region, center, segment) → **campaign list** (left) and **workspace** (right): breadcrumb → header line → **Simulation Controls** → optional AI note → **guardrail banner** → **Scenario Comparison** → 4 charts → **Model assumptions**.

### The campaign list
Every recommended campaign with a status chip: **Accepted**, **Rejected**, **Needs attention**, or **Recommended**, plus its purpose and ROI. Click to select; **Modify** on Planning opens this page on that campaign.

### Controls

| Control | Range | What it does |
|---|---|---|
| Optimise for (pills) | 4 objectives | Objective used by **Get AI alternative** |
| Target | fixed | Region · segment of the campaign |
| Promotion scheme | 5 | Changing it resets depth to that scheme's current terms |
| **Offer depth** | 3–25%, step 0.5 | Value of the offer as % of ticket; hint shows today's depth and the market median |
| **Duration** | 2–12 weeks | Longer at the same budget = lower intensity |
| **Campaign budget (at current terms)** | ₹0.5L – max(₹20L, 4× AI budget) | Note: *promotion cost scales with depth* |
| **Min ROI guardrail** | 0.80–1.80x (default 1.10) | Scenario is blocked if predicted ROI is lower |
| **Max spend intensity** | 1–15% (default 8) | Blocked if promotion cost ÷ baseline revenue is higher |
| Reset to AI recommendation | button | Restores the planner's values |

### Guardrail violation and "Get AI alternative"
If either guardrail fails, a red banner lists exactly what failed and **Apply Simulated is disabled**. **Get AI alternative** searches **5 schemes × 5 budgets (0.5×–1.5×) × up to 3 depths (current, +2.5pp, +5pp, each capped at the market median)** — up to 75 options — and picks the one that best meets the chosen objective *within both guardrails*. If none qualifies it returns the highest-ROI option and says so. *Example (South · Mid-Market discount, ₹5L):* at a 1.30x floor it selects Bundle, ₹4L, 16.6% depth → ROI 1.64x, net ₹3.6L, feasible; at a 1.80x floor nothing qualifies and it reports the best available (Bundle, ₹2.5L, ROI 1.73x).

### Scenario comparison
Two cards: **AI Recommended** (the planner's original) and **Simulated** (your settings, with ▲▼ deltas against the AI card). Metrics: extra visits, extra revenue, ROI (colour-coded), net profit, promotion cost, spend intensity, competitor gap (pp), confidence. Buttons: **Apply AI Recommended** (accepts as recommended, clearing any override) and **Apply Simulated** (accepts with your overrides). After applying, a green note explains the campaign now counts toward the plan budget and appears under *Queued for Launch*; **Back to Planning** returns.

### Charts
1. **All Schemes for This Campaign** — extra revenue vs cost for each of the five schemes (same target, length, budget; each at its current terms) with ROIs underneath.
2. **Budget Sensitivity** — net profit as the budget changes.
3. **Offer Depth Sensitivity** — net profit at different depths; profit peaks where extra cost and recovered customers balance.
4. **Competitor Benchmark** table — our offer vs each competitor's actual offer in that region (depth, validity), and the market position.

### Demo flow
1. Arrive via **Modify**. Read the header: AI recommendation and ROI.
2. Drag **Offer depth** up toward the market hint; watch revenue, cost, ROI and net profit change and the competitor gap fall.
3. Raise **Min ROI guardrail** to 1.8 → banner → **Get AI alternative** → note explains the choice.
4. Lower the guardrail, change the scheme, **Apply Simulated** → confirmation → **Back to Planning**: the row shows *Accepted · Modified*.

**Limitations:** estimates, not forecasts; the depth/leakage parameters are assumptions; one scheme per scenario; if a slice has few campaigns the model falls back to broader evidence (shown in the confidence).

---

## 9. Page 4 — Campaign Performance

**Question:** *Are live campaigns healthy? Did past ones deliver against plan? What did each teach us?*

**Design idea:** the page shows **one topic at a time**. A short summary and three plain-language takeaways sit on top; four views underneath hold the detail, so nothing competes for attention.

### Layout
1. **Filter bar** — Region · Customer segment · Promotion scheme (they apply to everything below).
2. **Summary strip** — five numbers: Live campaigns · Avg health · Need attention · Invested to date · Portfolio ROI.
3. **Three takeaways** (computed, one sentence each): *Programme result* ("9 of 21 campaigns beat their plan; 1 lost money. Portfolio ROI is 1.38x against a 1.30x target"), *Scheme gap to plan* (best and worst scheme vs plan) and *Live campaigns* ("2 of 3 need attention, ₹3.3L at risk").
4. **Four views** (tabs): **Live campaigns** · **Results** · **What we learned** · **All campaigns**.

### View 1 — Live campaigns (default)
One **card per running campaign** (3 today):
- name, region · segment · scheme, and a **health pill** (score + band: Healthy ≥75, Watch 55–74, Critical <55);
- **delivery bar** — incremental revenue so far as % of the plan to date, with a marker at 100%, and the day counter;
- **three mini numbers** — ROI (with the plan), extra visits (vs predicted), spend pace;
- **plain-language advice** ("Delivery is 84% of plan — tighten targeting or extend outreach", "ROI is under plan — review the offer design", or "On track — no action needed") and, when it applies, "Competitors run deeper offers in West";
- **View details →** opens that campaign in the *All campaigns* view.

Below the cards: **Queued for Launch** — campaigns you accepted on Planning (start date, budget, predicted ROI, confidence). Health formula: §5.5.

### View 2 — Results (plan vs actual)
Four charts: **ROI vs Plan** (completed campaigns, planned vs actual), **How Campaigns Compare With Their Plan** (donut: *Beat plan* ≥105% of planned ROI, *On plan* ±5%, *Below plan*, *Lost money* <1.0x — currently 9 / 4 / 7 / 1 of 21), **Spend vs Incremental Revenue** (cumulative ₹59.1L → ₹212.3L) and **Spend and Return by Region** (West ₹18.5L → ₹70.1L, South ₹17.7L → ₹62.3L, East ₹4.0L → ₹14.2L).

### View 3 — What we learned
Two charts and a short list. **Which Schemes Beat Their Plan** (spend-weighted planned vs actual ROI: Bundle 1.50 vs 1.37, Discount 1.48 vs 1.27, Car Wash 1.39 vs 1.30, **Voucher 1.15 vs 1.29**, **Engine Check 0.99 vs 1.20**) and **What the Offer Design Taught Us** (average ROI vs plan by design: priority slot +0.16, flat 10% +0.16, **60-day voucher −0.17**, **free check without repair credit −0.19 and −0.28**). Under them, **Lessons to Carry Into the Next Plan** turns those numbers into *Rethink* / *Repeat* sentences. This is the bridge from *Learn* back to *Plan*.

### View 4 — All campaigns
Status pills (All · Planned · Active · Completed, with counts) and a five-column list (campaign, target, period, ROI vs plan, status). Selecting a row opens:
- four **Actual vs plan** tiles (extra revenue, extra visits, net profit, ROI — for an active campaign the plan is scaled to the months that have run),
- a **month-by-month** chart,
- **What it taught us** — a generated learning (*Did not recover its cost* / *Below plan* / *Ahead of plan* / *On plan*) with comparisons to the scheme's other campaigns, budget use, a recommendation, the offer design and the **market position** (our depth vs the market median).

### Demo flow
1. Read the summary strip and the three takeaways aloud: the whole story in ten seconds.
2. **Live campaigns:** point at the two Watch cards and their advice, then the Competitor note; open **Queued for Launch** after accepting a campaign on Planning.
3. **Results:** "9 of 21 beat plan, 1 lost money" (donut), then ROI vs Plan.
4. **What we learned:** "vouchers and engine checks are why we miss plan" (scheme chart), then the design chart and the *Rethink* lines.
5. Filter **Scheme = Free Engine Check** — every view re-cuts to the three failing campaigns.
6. **All campaigns → Completed →** *Engine Health Check* for the learning text.


---

## 10. Page 5 — AI Advisor and the agents

### What it is
An assistant that answers business questions in plain English, built as **one orchestrator and seven specialist agents**. **It is rule-based, not a large language model:** every number is calculated when you ask, from the same data as the other pages. That makes it instant, consistent with the dashboards, auditable, and unable to invent figures.

### Two modes — Chat is the default
Two explainer cards at the top let users choose, and say when to use each:
- **Chat** *(opens by default)* — "Ask in your own words". Type a question such as "Why did South revenue fall in March?" and get a short answer with the numbers. **Best for specific questions and follow-ups.** Free-text plus 10 suggested questions; every answer is labelled *Orchestrator → X Agent*, states its scope ("Based on: …") and offers follow-up chips. The right panel highlights the agent that answered last.
- **AI Agents** — "Run a full report with one click". Seven specialists each produce a complete report (key numbers, a table and recommended actions) with no typing. **Best for reviews, or when you are not sure what to ask.** Seven agent cards (Performance, Promotion, **Competitor Benchmark**, Simulation, **Campaign Planner**, **Campaign Monitor**, Recommendation; the newest are tagged *New*), each with its tagline, description, data used, a **Run** button and **Ask in chat** (which switches to Chat and asks that agent's typical question).

### Anatomy of an agent report
Every agent returns the same structure (`AgentReport`), which the UI renders and the chat converts into an answer:

| Part | Purpose |
|---|---|
| **Headline** | one sentence with the conclusion |
| **Metrics** | 2–4 key numbers, coloured good/bad |
| **Table** | the evidence (scheme scorecard, gap table, campaign list…) |
| **Findings / actions** | numbered actions or bullet findings, with impact |
| **Actions** | buttons that jump to the relevant page |
| **Scope + data used** | what slice and which datasets the answer rests on |

---

## 11. The seven agents, in depth

For each agent: its purpose, the business question, the data it reads, its algorithm step by step, what it outputs (with real output), how to run/ask/demo it, and its limits.

### 11.1 Performance Agent — "Why did the numbers move?"
**Business question:** *Why did revenue change, where did it come from, and which region is weakest?*
**Data:** master dataset (monthly performance, campaign start/end dates).

**Algorithm**
1. Take the latest month and the month before (March vs February 2026).
2. **Decompose the change** into a **volume effect** `(visits₁ − visits₀) × ASV₀` and a **price/mix effect** `visits₁ × (ASV₁ − ASV₀)`; they add up to the revenue change.
3. Compute the change for every **region × segment cell**; sort to find the **biggest drags** (most negative Δ revenue) along with each cell's visits % and ASV % change.
4. Count months in the year that fell ≥3% vs the previous month and list them.
5. Build a **regional table** for the last 3 months vs the prior 3 (revenue, change, margin, retention, ROI) and name the weakest region.

**Real output (default data)**
> *Headline:* March 2026 revenue fell 3.1% to ₹480.4L; visit volume drove most of the change.
> Volume effect −₹12.7L (visits 7,108 → 6,926); price/mix −₹2.5L (ASV 6,972 → 6,936). Biggest drags: Central · Mid-Market −₹7.9L; North · Premium −₹4.8L; South · Mid-Market −₹3.6L. Three months fell ≥3% (Nov 2025, Feb 2026, Mar 2026), mostly after campaigns ended. Weakest region over 3 months: South (−7.0%).

**Ask in chat:** "Why did service revenue decline in March?", "Why did South revenue fall in March?" (scopes to South: −5.5%, with the South Premium ASV squeeze visible), "Identify low-performing periods.", "How is Fleet retention?". Chat versions also name the campaigns that **ended** in the prior month and say "no promotions were running, so the change is organic" when that is true.
**Demo tip:** run it, then ask the South question to show the same logic scoped to a region.
**Limits:** explains *what* changed and *where*; it attributes causes only through what the data contains (campaign end dates, ASV vs volume) — it does not know about weather, competitors' actions in March or staffing.

### 11.2 Promotion Agent — "Which promotions earn their keep?"
**Business question:** *Which schemes and campaigns return more than they cost?*
**Data:** master dataset (campaign-tagged spend, incremental revenue/visits/profit; planned ROI).

**Algorithm**
1. Group all campaign-tagged rows by scheme; for each: spend, incremental revenue, ROI = incremental gross profit ÷ spend, visits uplift (incremental visits ÷ organic visits in those rows), campaign count.
2. Label each scheme against the 1.30x target (±5% band).
3. Compute portfolio ROI and net profit; find the best and worst **completed** campaigns; list schemes below target.

**Real output**
> *Headline:* Service + Car Wash Bundle leads at 1.50x; Free Engine Check trails at 0.99x. Portfolio ROI is 1.38x against a 1.30x target.
> Metrics: ROI 1.38x · spend ₹59.1L · net profit ₹22.7L · 2 schemes below target. Best campaign Winter Wash Bundle (1.57x vs 1.40x planned); worst Engine Health Check (0.92x vs 1.20x). Below target: ₹500 Voucher (1.15x on ₹7.2L) and Free Engine Check (0.99x on ₹4.9L) — "consider reallocating this spend".
> Table: Bundle 1.50x/₹18.5L/₹69.2L · 10% Discount 1.48x/₹14.4L/₹54.8L · Car Wash 1.39x/₹14.1L/₹49.3L · Voucher 1.15x/₹7.2L/₹24.5L · Engine Check 0.99x/₹4.9L/₹14.4L.

**Ask in chat:** "Which promotion performed best?", "Compare Free Car Wash and ₹500 Voucher." (head-to-head with a verdict — efficiency vs absolute revenue), "How is campaign ROI trending, and why?" (ROI by quarter 1.33x → 1.39x → 1.40x → 1.37x: *held up*, drag is individual campaigns; share of spend in below-target schemes fell 36% → 21%).
**Limits:** ROI is gross-profit based (no fixed costs); "incremental" is taken from the data, which in real life needs a measurement design (control groups).

### 11.3 Competitor Benchmark Agent — "How do we compare with the market?" *(new)*
**Business question:** *Where are our offers weaker than competitors' (e.g. our discount is lower), what does that cost us, and exactly what should we change?*

**Data (four inputs):** the **external benchmark** (219 competitor offers), **our offer terms** (`OUR_TERMS`), the **master dataset** (revenue by region, campaign results) and the **simulation model** (to price each suggestion).

**Algorithm, step by step**

*Step 1 — Market position per scheme (and per region if scoped).* Using the latest observation month, for each of our schemes gather the competitors' equivalent offers and compute: number of competitors, **median depth**, min/max, the top competitor, median value (₹) and validity (days), the **share of offers that include a repair credit**, and the **trend** (median now − median in the first month). Then `gap = market median − our depth` and **position**: *Behind* if gap ≥ +3pp, *Ahead* if ≤ −3pp, otherwise *Parity*. A validity gap is computed too.

*Step 2 — Regional pressure.* For each region, average the gap across schemes that have competitors: **High** ≥3pp, **Medium** ≥1pp, **Low** otherwise; add the region's revenue share and last-3-month revenue change.

*Step 3 — Suggestions.* Four rule families, each quantified through the model:
 1. **Match depth** (Discount, Voucher, Bundle where *Behind*, per region): search depths from today's up to the market median in 0.5pp steps and choose the one with the highest **net-profit gain** for a reference **₹10L, 8-week campaign** in that region; **cap the increase at +5pp per step** (phased, not a full match). Priority follows the money: net gain <₹0.5L → *Low*; gap ≥5pp **and** gain ≥₹1L → *High*; else *Medium*. If a deeper offer does not pay back and you scoped to one region, it says **Hold** and recommends non-price levers.
 2. **Extend validity** — if competitors' median validity is ≥20 days longer than ours (voucher: 60 vs 90): recommend extending to ≤90 days at the same face value, with **evidence computed from our own campaigns** (60-day vouchers' ROI vs plan versus 90-day ones).
 3. **Add repair credit** — if ≥50% of competitors' free inspections include a repair credit and we have none: recommend a ₹500 credit (or retire the scheme), citing our Free Engine Check campaigns' ROIs against plan.
 4. **Expand where competition is low** — where we are ≥1pp *Ahead*: scale at current depth and consider trimming depth.

*Step 4 — Impact estimate.* `impact = simulate(depth = suggested) − simulate(depth = current)` using the offer-depth model (§5.3): Δ revenue, Δ visits, Δ net profit and Δ cost per ₹10L campaign.

**Real output — network view**

| Our scheme | Ours | Market median | Gap | Position | Validity (ours / market) | Top competitor |
|---|---|---|---|---|---|---|
| 10% Service Discount | 10% | 14.0% | +4.0pp | **Behind** | 30d / 30d | Competitor C (25.7%) |
| ₹500 Voucher | 7.2% | 11.1% | +3.9pp | **Behind** | **60d / 90d** | Competitor C (16.5%) |
| Free Car Wash | 5.1% | 4.8% | −0.3pp | Parity | 30d / 30d | Competitor B (5.6%) |
| Free Engine Check | 6.5% | 6.4% | −0.1pp | Parity | 30d / 30d | Competitor B (8.4%) — **67% include a ₹500 repair credit** |
| Bundle | 11.6% | 13.6% | +2.0pp | Parity (South: **+7.1pp Behind**) | 30d / 30d | Competitor C (21.3%) |

> *Headline:* We are behind the market on 2 of 5 comparable offers; pressure is highest in South (our offers are 3.8pp shallower on average). 5 actions recommended.
> 1. **[High]** South: Bundle is 7.1pp shallower → raise from 11.6% to 16.6% (phased); per ₹10L campaign **+₹20.9L revenue, +317 visits, +₹4.1L net profit** (cost +₹4.3L).
> 2. **[High]** South: 10% Discount is 5.6pp shallower → raise from 10% to 15.0%; **+₹21.6L revenue, +328 visits, +₹3.4L net profit** (cost +₹5.0L).
> 3. **[High]** 67% of competitor free checks include a ₹500 repair credit — ours has none → add a credit or retire for Fleet.
> 4. **[High]** Our voucher expires in 60 days; competitors give 90 → extend to 90 days at the same face value.
> 5. **[Medium]** South: ₹500 Voucher is 5.0pp shallower → +5pp gives only +₹0.7L net profit for +₹6.9L cost, so fix validity first.

**Scoped views.** *South*: behind on 3 of 5 (Discount +5.6pp, Voucher +5.0pp, Bundle +7.1pp). *East*: "at or ahead of the market", with the Bundle deeper than competitors → scale it there without deepening.

**Where it appears in the app:** the **AI Agents** tab (with a Region selector); the **chat** ("How do our promotions compare with competitors?", "Where is our discount lower than competitors?", "What should we do about competitor pressure in the South?", or naming a scheme — "Is our voucher weaker than the competition in the North?"); the **Planning** page (*Competitor deeper by …pp* tags, the Competitor Pressure chart, purpose *Defend vs competitor*); the **Simulation** page (competitor gap metric, depth slider hint, Competitor Benchmark table); **Campaign Performance** (Competitor flag on live campaigns, Market line in the detail).

**Demo:** run it → point at the gap table (red *Behind*) → read action 2 with its impact numbers → switch Region to South → then ask "Where is our discount lower than competitors?" in chat.
**Limits:** benchmark data is illustrative; depth and leakage are stated assumptions (listed on the Simulation page) that should be calibrated from a pilot; it compares *offers*, not competitors' volumes or margins; depth is % of the network-average ticket, not segment tickets.

### 11.4 Simulation Agent — "What happens if we change the plan?"
**Business question:** *At my plan's budget, which scheme is best for my objective, and how do returns change as the budget moves?*
**Data:** the shared **Plan**, master dataset, response model.

**Algorithm:** build the baseline for the plan's period and scope → evaluate the 5 schemes at the plan budget (scoped evidence, diminishing returns) → rank by the plan's objective → compute budget sensitivity (0.5×–2×) for the plan's scheme → list schemes that lose money.

**Real output (default plan: Q1, network, ₹15L)**
> *Headline:* At a ₹15.0L budget, Service + Car Wash Bundle is best for "Maximize Net Profit" (₹4.4L). ₹500 Voucher and Free Engine Check would lose money.
> Bundle +₹48.6L / 745 visits / 1.30x / +₹4.4L · Discount +₹47.8L / 733 / 1.24x / +₹3.6L · Car Wash +₹43.9L / 674 / 1.16x / +₹2.5L · Voucher +₹39.5L / 605 / 0.89x / −₹1.7L · Engine Check +₹32.8L / 503 / 0.73x / −₹4.1L. Sensitivity: ₹7.5L → 1.41x … ₹15L → 1.30x … ₹30L → 1.19x.

**Chat:** "What happens if I increase the promotion budget by 25%?" → ₹15.0L → ₹18.8L: revenue ₹48.6L → ₹59.1L, ROI 1.30x → 1.26x, net ₹4.4L → ₹4.9L, marginal ₹1.12 of gross profit per extra ₹1 ("still worth it, returns per ₹ fall"). It understands "+X%", "reduce by X%", "double", "halve", a scheme or region in the question; asked to raise a discount "from 10% to 15%" it explains depth isn't tracked historically and models it as proportionally higher spend.
**Limits:** one scheme at a time; whole budget on that scheme.

### 11.5 Campaign Planner Agent — "What should we run next?" *(new)*
**Business question:** *For the planning period, which campaigns should we launch, when, at what size, and how confident are we?*
**Data:** master dataset, competitor benchmark, the Plan (period, scope, objective), the simulation model — and your **decisions** (so a modified campaign is reflected).

**Algorithm** (the same engine as the Planning page — §7): exclude slices already covered → evaluate 5 schemes per slice at a typical campaign size → drop loss-makers → diversify (scheme cap) → rank by objective → top 14 → assign purpose, flags, confidence, start dates.

**Real output**
> *Headline:* 14 campaigns recommended for Q1 FY 2026-27: ₹31.0L budget, ₹114L predicted extra revenue, ₹14.4L net profit. 4 need review.
> 5 campaigns already scheduled and excluded (CMP-2512, 2513, 2521, 2601, 2602). Top five: South · Mid-Market — Bundle, ₹6.5L, ROI 1.49x, conf 66% (*Recover decline*: slice revenue is 11.0% lower) · North · Mid-Market — Bundle, ₹3.5L, 1.50x (*Defend vs competitor*: competitors run 15.2% vs our 11.6%) · West · Premium — Bundle, ₹3.0L, 1.53x · South · Value — Bundle · Central · Mid-Market — Bundle. Calendar gap: East · Fleet.

**Chat:** "Which campaigns should we run next quarter?"
**Demo:** run it, open Planning, and show that the table is the same list; accept some, run the agent again — decisions are reflected.
**Limits:** region-level campaigns (not per center); default lengths and budget sizing are rules of thumb learned from history; the calendar is a recommendation, not a scheduler.

### 11.6 Campaign Monitor Agent — "Are live campaigns on track?" *(new)*
**Business question:** *Which running campaigns are at risk, why, and what should we do?*
**Data:** master dataset (active campaigns' results to date vs plan), benchmark (competitor pressure).

**Algorithm:** for each Active campaign compute **delivery** (incremental revenue ÷ expected to date), **spend pace**, **visit delivery**, **ROI vs plan**; combine into the **health score** (§5.5); raise **flags** (Underperform, Below ROI plan, Overspend, Underspend, Competitor); band it; compute **budget at risk**; then map each flag to a **recommended intervention**:
- *Underperform* → "delivery is behind plan — tighten targeting or extend outreach"
- *Below ROI plan* → "ROI is under plan — review offer design"
- *Overspend* → "spend is ahead of pace — cap the budget"; *Underspend* → "check redemption friction"
- *Competitor* → "competitors run deeper offers here — see the Competitor Benchmark Agent"

**Real output**
> *Headline:* 3 campaigns are live: average health 76/100, 2 need attention, ₹3.3L of planned budget at risk.
> Spring Refresh Promo — D30 of 60, delivery 84%, ROI 1.22x (plan 1.35x), health **72 Watch**: Underperform, Below ROI plan. Highway Care Drive — D30 of 90, delivery 88%, ROI 1.17x (1.25x), **74 Watch**: + Competitor. Spring Bundle Push — delivery 101%, ROI 1.43x (1.40x), **82 Healthy**: Competitor.

**Chat:** "Are my active campaigns on track?"
**Limits:** active campaigns currently have one month of data, so scores are early signals; days are approximated as 30 per month.

### 11.7 Recommendation Agent — "What should we do first?"
**Business question:** *Across everything, what are the highest-value next actions?*
**Data:** all of the above.

**Algorithm:** gather (a) the top 3 Dashboard alerts/opportunities for the plan's scope, (b) the top 3 non-Hold **competitor suggestions**, (c) a note if the planner flagged campaigns for attention, (d) an intervention item if any live campaign is not Healthy → sort **High before Medium** → number them with source agent and impact. (Sentences are cut at the first full stop followed by a space, so decimals such as "0.99x" stay intact.)

**Real output**
> *Headline:* 6 high-priority actions across performance, competitors, planning and live campaigns.
> 1 Free Engine Check below target (ROI 0.99x on ₹4.9L, 3 campaigns) · 2 Extend the Bundle to East (+₹6.3L) · 3 Raise Bundle depth in South (+₹4.1L per ₹10L campaign) · 4 Raise the 10% discount in South to 15% (+₹3.4L) · 5 Add a ₹500 repair credit to Free Engine Check · 6 Intervene on Spring Refresh Promo and Highway Care Drive (₹3.3L at risk) · 7 [Medium] March revenue decline (−₹15.2L) · 8 [Medium] Review 4 flagged campaigns.

**Chat:** "What should I do next?" (the chat version also states whether your plan already uses the best scheme for your objective, with runner-up and weakest).

### 11.8 How the agents work together
The agents are independent functions over the same data, and each points to the next: the **Monitor** flags "Competitor" and refers you to the **Competitor Agent**; the **Competitor** agent's actions can be tried in the **Simulation**; accepted changes flow into the **Planner** calendar and **Campaign Performance**; the **Recommendation** agent merges their outputs into one ranked list.

---

## 12. The chat orchestrator, in depth

### 12.1 Routing order
The orchestrator lowercases the question, extracts entities, then applies the **first matching rule**:

| # | Rule (keywords) | Routes to |
|---|---|---|
| 1 | greeting / help | Orchestrator help |
| 2 | competitor, competition, competitive, benchmark, rival, "the market", "market rate/median/offer", industry, "how do we compare" | **Competitor Benchmark Agent** |
| 3 | campaign + (on track / health / at risk / pacing), or active/live/running campaigns, monitor | **Campaign Monitor Agent** |
| 4 | "which/what campaigns … run/launch/next", campaign calendar/plan, upcoming/recommended campaigns, next quarter | **Campaign Planner Agent** |
| 5 | ROI + (decline/drop/fall/trend/change/why…) | Promotion Agent (ROI trend) |
| 6 | low-performing, weak/worst month/period | Performance Agent (weak periods) |
| 7 | why/explain/reason + revenue/visits/margin/decline words | Performance Agent (explain a change) |
| 8 | what if / budget / increase / reduce / double / simulate | Simulation Agent |
| 9 | two schemes named | Promotion Agent (comparison) |
| 10 | recommend / should I / next step / opportunity | Recommendation Agent |
| 11 | promotion, scheme, campaign, offer, ROI … | Promotion Agent (ranking) |
| 12 | retention / churn / loyal | Performance Agent (retention) |
| 13 | region, segment, center words, or a parsed scope | Performance Agent (breakdown) |
| 14 | revenue, visits, margin, KPI … | Performance Agent (summary) |
| 15 | nothing matched | honest fallback: says it can't map the question, offers examples and a KPI snapshot |

Rules 2–4 need the benchmark and data context; without the benchmark loaded the competitor route replies that benchmark data is missing rather than guessing.

### 12.2 Entity extraction
- **Months:** "March", "Feb", … → the matching month of the data.
- **Regions:** north, south, east, west, central.
- **Segments:** premium, mid-market/"mid market", fleet, and "value segment/customers" (plain "value" is ignored so "average service value" isn't misread).
- **Service centers:** by name or city ("Bengaluru", "Delhi") → also sets the region.
- **Schemes:** bundle/"service + car wash"/combo → Bundle; "engine (check)" → Engine Check; voucher/₹500 → Voucher; discount/10% → Discount; car wash/wash → Car Wash. Matched in that order, and matched text is removed so "car wash bundle" isn't also counted as a car wash.

### 12.3 Answer format
`{ agent, text (headline), bullets (findings), scope ("Based on: …"), followUps[] }`. Agent reports are converted to this format (headline → text, findings → bullets). The UI renders indented sub-lines (e.g. "→ action", "Impact: …") as sub-bullets.

### 12.4 The ten suggested questions
Why did service revenue decline in March? · Which promotion performed best? · How do our promotions compare with competitors? · Where is our discount lower than competitors? · What should we do about competitor pressure in the South? · Which campaigns should we run next quarter? · Are my active campaigns on track? · What happens if I increase the promotion budget by 25%? · How is campaign ROI trending, and why? · What should I do next?

### 12.5 Adding an LLM later
`answerQuestion(ds, question, plan, { bm, decisions })` is the single integration point. Keep the deterministic agents as the **source of numbers** and let an LLM handle phrasing and intent, so it can never invent a figure.

---

## 13. End-to-end story and demo scripts

### The story
1. **Understand (Dashboard):** ₹58 Cr revenue; promotions ≈1% of revenue at 1.38x — but Engine Check and the Voucher leak money, Fleet is weak, and the last two months dipped as campaigns ended.
2. **Ask (Competitor agent):** we're behind on discount (10% vs 14%) — and worst in the South; our free check lacks the repair credit competitors include; our voucher expires sooner.
3. **Plan (Planning):** 14 recommended campaigns for Q1 — ₹31.0L, ~₹114L extra revenue, 4 flagged; accept the good ones, review the flagged.
4. **Simulate (Simulation):** modify a South campaign, deepen the offer toward the market, hit a guardrail, take the AI alternative, apply.
5. **Execute (Campaign Performance):** the applied campaign is queued; live campaigns show health and a Competitor flag.
6. **Learn (Campaign Performance):** outcome mix, plan-vs-actual by scheme and *what the offer design taught us* (60-day vouchers, no-credit checks) feed the next plan.

### 10-minute demo
| Time | Page | Do | Say |
|---|---|---|---|
| 0:00–0:45 | — | Pitch | Problem, loop, synthetic data, one CSV |
| 0:45–2:45 | Dashboard | Defaults → South → Fleet → Opportunities | "Dip = promotions cooling; two leaks, two opportunities" |
| 2:45–4:15 | AI Advisor → Agents | Competitor agent → gap table → action 2 | "We're behind the market on discount, mostly in the South" |
| 4:15–6:00 | Planning | Calendar → Accept two → Modify a South row | "Specific campaigns with predicted ROI and confidence" |
| 6:00–7:30 | Simulation | Depth slider → guardrail → AI alternative → Apply | "Test before committing; guardrails protect ROI" |
| 7:30–9:00 | Campaign Performance | Monitor → health → analytics charts → Queued | "Live health, and what the design taught us" |
| 9:00–10:00 | Chat | 3 questions | "Same data, plain English, seven agents" |

### 20-minute demo
Add: dataset walkthrough (open the single CSV, the three sample rows and the depth worked example), every agent's *Run*, all nine campaign charts, the leakage assumption discussion, `npm run check` in a terminal (98 checks).

### If something goes wrong
- Blank page → refresh; ensure `npm run dev` is running.
- Numbers differ → someone regenerated with different settings; run `npm run data:generate`.
- Plan/decisions vanished → they live in memory; re-accept (30 seconds).
- Chat says it can't map a question → use a suggested question.

---

## 14. Questions your manager may ask

**Is this real data?** Synthetic but consistent, with known stories planted. Real data in the same formats drops in without code changes.

**Why a separate competitor file when you said one master CSV?** Our own data is one master file; competitor data is external market intelligence with a different owner, refresh cycle and grain.

**Is the competitor data real?** No — illustrative and anonymised. The mechanism (compare on a common "% of ticket" depth, find gaps, price the fix) is what is being demonstrated.

**How reliable is the "raise the discount" advice?** It is an estimate under stated assumptions (cost ∝ depth, take-up ∝ depth^0.5, 4%/pp leakage). It is capped at +5pp per step precisely because the assumptions are untested; the Simulation page lets you vary depth and see the sensitivity, and a real pilot should calibrate the leakage rate.

**Why not simply match the market everywhere?** The agent checks whether a deeper offer pays back; for the Voucher in some regions it does not (+₹0.7L profit for +₹6.9L cost), so it recommends fixing validity first, and for regions where we are ahead (East) it recommends *not* deepening.

**How do you know which sales a promotion caused?** The `incremental_*` columns record it. In real life this needs control groups or baseline modelling — a data-engineering step, not an app change.

**Why ROI on gross profit?** Revenue overstates promotion value; gross profit is what we keep.

**Is the AI a language model?** No — deterministic, auditable, cannot invent numbers; an LLM can be layered on top for phrasing.

**How do you test it?** `npm run check` runs 98 automated checks (data integrity and reconciliation, analytics, simulation, planner rules, monitor, benchmark, all seven agents, 20 chat questions). The interface was also exercised with a scripted click-through of all five pages.

**What's next?** Real data + attribution method; persistence and campaign creation; calibrate elasticities from pilots; roles/permissions; LLM phrasing layer.

---

## 15. Limitations, honesty notes and roadmap

**Limitations**
- Synthetic data; a single year (no year-over-year view).
- Competitor benchmark is illustrative; depth elasticity (0.5), leakage (4%/pp) and diminishing-returns exponent (−0.12) are assumptions, not measurements.
- Plan and accept/reject/modify decisions live in memory (lost on refresh); accepted campaigns are not written back to the CSV.
- Recommended campaigns are region-level (not per center) with rule-of-thumb lengths and sizes.
- Active campaigns have one month of data → health scores are early signals.
- Agents are rule-based: they understand the question types listed in §12, not any sentence; the chat has no memory between questions.
- Gross-profit basis only; no fixed costs; no cannibalisation or competitor-reaction modelling.
- No user accounts or permissions; not yet audited for accessibility or very large data.
- The interface was tested by script (jsdom) and never visually reviewed in this document's creation; review layout on a real screen.

**Roadmap**
1. Real data pipeline and an agreed definition of "incremental".
2. Persist decisions; create campaigns from an accepted plan (close Plan → Execute in data).
3. Calibrate depth/leakage from pilots; add pricing and mix levers.
4. Live competitor feeds with refresh dates and source confidence.
5. Roles, export to Excel/PDF, alerts by email.
6. LLM layer for natural language, keeping agents as the source of numbers.

---

## 16. Cheat sheet of numbers

| Item | Value |
|---|---|
| The single CSV | 720 rows × 44 cols = 480 Actual + 21 Plan + 219 Competitor · our data: 12 months × 10 centers × 4 segments |
| Competitor rows | 219 offers · 5 competitors · Jan–Mar 2026 |
| Full-year revenue / visits / ASV | ₹5,816.7L / 84,180 / ₹6,910 |
| Margin / retention | 38.7% / 88.4% |
| Promotion spend → incremental revenue | ₹59.1L → ₹212.3L |
| Portfolio ROI (target 1.30x) / net profit | 1.38x / ₹22.6L |
| Scheme ROI | Bundle 1.50 · 10% Discount 1.48 · Car Wash 1.39 · Voucher 1.15 · Engine Check 0.99 |
| Last 3 months vs prior | revenue ₹1,517.3L (−2.8%) · promotion-driven ₹51.9L (−33.1%) · ROI 1.37x |
| Campaigns | 23: 18 completed · 3 active · 2 planned |
| Outcome mix (21 that ran) | 9 beat plan · 4 on plan · 7 below · 1 lost money |
| Best / worst campaign | Winter Wash Bundle 1.57x (plan 1.40x) / Engine Health Check 0.92x (plan 1.20x) |
| Weakest segment | Fleet: margin 33.5%, retention 84.3%, ROI 1.01x |
| Default plan | Q1 FY26-27 · baseline ₹1,359.2L · target ₹1,427L · budget ₹15L · Bundle |
| Simulation (Bundle, ₹15L) | +₹48.6L revenue · 1.30x · +₹4.4L net · Voucher −₹1.7L · Engine Check −₹4.1L lose money |
| Planner (Q1) | 14 campaigns · ₹31.0L · ₹114L extra revenue · ₹14.4L net · 4 flagged · 5 slices already scheduled |
| Market gaps | Discount 10% vs 14.0% (+4.0pp) · Voucher 7.2% vs 11.1% and 60d vs 90d · Bundle South +7.1pp · 67% of competitor free checks include a repair credit |
| Pressure by region (avg gap pp) | South +3.8 · West +2.9 · North +2.8 · Central +0.5 · East −1.2 |
| Live campaigns | 3 · avg health 76 · 2 at risk · ₹3.3L budget at risk |
| Depth example (South · Mid-Market discount, ₹5L) | 10% → 15%: revenue ₹19.6L → ₹30.2L · cost ₹5.0L → ₹7.5L · net ₹2.5L → ₹4.1L |
| Model constants | growth 6% · diminishing-returns exponent −0.12 · depth elasticity 0.5 · leakage 4%/pp (cap 40%) · ticket factor 0.95 · ROI target 1.30x |
| Automated checks | 98 (`npm run check`) |
