# MCP and reporting review: statistical accuracy and ROI

This review covers the MCP tools, the reporting prompts and the data behind them, against the MVP goal: users who connect their accounts and follow the weekly action should see a measurable, repeatable return. It covers what to change, which statistics to use, and which extra data sources a good report needs.

It builds on [the MVP plan](mvp-plan.md) and [the issues log](mvp-issues.md). New issues found here are numbered **R-1** and onward.

## Summary

- **The current design asks the AI to do the statistics.** The tools return raw counts and rates. The prompt tells the model to "explain small samples", but nothing computes uncertainty, significance, trends or expected value. Language models are unreliable at this. They tend to read noise as findings, and they compare rates that look different but aren't.
- **Principle for the redesign: code computes, the AI decides and explains.** Every number, interval, significance test and opportunity size is calculated deterministically in a new `src/stats` module. The model receives a short list of pre-scored candidate actions. It chooses one, explains why, and writes the steps. It cannot invent numbers or actions that are not in the evidence.
- **Several inputs that ROI depends on are missing.** These include the value of a conversion, target cost per acquisition, budget, prior-period baselines, Google Ads budget and impression-share data, conversion-action settings, change history and conversion lag. Without them, the report can rank by conversion rate but cannot rank by return.
- **"Consistent ROI" cannot be guaranteed, but the system can be built to win on average.** It can pick actions with the highest expected value, avoid false wins, measure each change honestly, and learn from past results. With small business volumes, many weekly results will be "inconclusive". The report must say so, and choose metrics that can actually be measured within a week.

---

## 1. Accuracy problems in the current code

| ID | Where | Problem | Effect | Fix |
| --- | --- | --- | --- | --- |
| R-1 | `src/reporting/service.ts:95` | Confidence is lowered only when the **whole site** has under 30 sessions. | A finding about a channel with 6 sessions on a 2,000-session site keeps "high" confidence. | Set confidence from each cited row's own sample (Section 2). |
| R-2 | `src/public/tracker.js:33` | Visitors from search engines without UTMs are recorded as `www.google.com / referral`. There is no channel grouping. | Organic Google traffic can be mistaken for Google Ads traffic, and "referral" mixes search, social and real referrals. | Group channels in code as Paid search, Organic search, Paid social, Organic social, Email, Referral and Direct, using referrer and UTM rules. Store the group with each session. |
| R-3 | `src/reporting/service.ts:58` | Mapping coverage counts every `utm_source=google` session as Google Ads, including tagged non-paid links such as `utm_medium=organic` from Google Business Profile. | Understates how much Ads traffic is linked to campaigns. | Count only the Paid search group with Google as the source (R-2). |
| R-4 | `src/reporting/period.ts:5,12` | Xaylo uses a rolling window of exactly N×24 hours in UTC. Ads uses calendar days in the account's timezone, **including today, which is only partly complete**. | The two windows don't match, and a partial day understates conversions because they arrive late. Comparing weeks also mixes different days of the week. | Use **complete calendar days ending yesterday, in the account's timezone**, for every source. With no Ads account, use the workspace's timezone. |
| R-5 | Everywhere | There is no comparison with earlier periods. | Trends ("conversions fell") cannot be stated, and the effect of an action cannot be separated from normal weekly variation. | Compute baselines from the previous 4–8 matching weeks (Section 2.5). |
| R-6 | `src/google/reporting.ts` | ROAS uses `conversions_value` without checking how the conversion actions assign value. | Many accounts give every conversion a default value of 1, which makes ROAS meaningless. | Read the conversion actions' value settings, and suppress ROAS when values are defaults (Section 5.1). |
| R-7 | `src/reporting/ai.ts` | Validation checks that cited evidence IDs exist, but not that the numbers in the text match the evidence. | The model can write a wrong figure and cite a real source for it. | Check every number in the output against the cited evidence, allowing for rounding, and reject the report otherwise (Section 4). |
| R-8 | `src/reporting/ai.ts` | 6,000 output tokens and a 90-second timeout. | Long reasoning can be cut off. | Step 7 replaces this with streaming and a larger limit. |
| R-9 | `src/reporting/service.ts` `contextSchema` | Goals are free text. There is no value per conversion, target CPA or ROAS, budget or margin. | ROI cannot be calculated or ranked. | Add structured inputs (Section 5.4). |
| R-10 | `src/public/tracker.js` | Only page views and final conversions are tracked. | Small sites get a handful of conversions a week, which is too few to measure most changes in 7 days. | Add micro-conversions such as CTA clicks and form starts (Section 5.3). |

R-1 to R-4 are small, safe fixes and could go in one PR before the MVP steps.

---

## 2. Statistics to compute in code

These go in a new pure-function module, `src/stats/`, with no I/O, unit tests, and simulation tests (Section 7). Every rate the MCP tools or the AI see carries its sample size and uncertainty.

### 2.1 Rates and intervals

- **Conversion rate with a Wilson 95% interval.** For *k* conversions out of *n* sessions or clicks, report `rate`, `low`, `high` and `n`. Wilson stays sensible for small *n* and rates near 0.
- **A reliability label for each row, set in code:**
  - `reliable` when *n* ≥ 100 and *k* ≥ 10.
  - `indicative` when *n* ≥ 30.
  - `insufficient` otherwise.

  The AI may describe a row only at its label's strength.

### 2.2 Shrinking small samples (empirical Bayes)

When comparing many landing pages, campaigns or keywords, small rows look extreme by chance. Fit a Beta(α, β) prior across the rows using the method of moments, then rank by the **shrunk rate** `(k + α) / (n + α + β)`. A page with 1 conversion from 3 visits no longer outranks one with 40 from 400.

### 2.3 Comparing two rates

Use a Beta–Binomial posterior for each segment, then compute:

- **P(A > B)**, by Monte Carlo with 20,000 draws, or a normal approximation when *n* is large.
- **The relative difference with a 90% credible interval.**

Wording follows the probability, so the AI cannot overstate a result:

| P(A better than B) | Wording |
| --- | --- |
| ≥ 0.95 | "clearly higher" |
| 0.80–0.95 | "likely higher" |
| Otherwise | "no clear difference" |

### 2.4 Many comparisons at once

A report scans dozens of rows, so some will look significant by chance. Apply **Benjamini–Hochberg** at q = 0.10 across all candidate findings, and drop those that don't pass.

### 2.5 Baselines, seasonality and trends

- For every key metric, compute the same 7-day window for each of the previous **4–8 weeks**. That gives a mean, a standard deviation and a control band (mean ± 2 standard deviations).
- Report this week's position as a z-score, and flag it only if it falls outside the band.
- Use matched days of the week. Flag known one-off periods, such as bank holidays, from a short holiday calendar.

### 2.6 Wasted spend from search terms

For a search term with *n* clicks and no conversions, compute the chance of seeing no conversions if it converted like its ad group. Use the ad group's shrunk rate *p*: `P(0 | n, p) = (1 − p)^n`.

Flag the term as a negative-keyword candidate only if all of these hold:

- `P < 0.05`
- spend > 1× the target CPA, or the account's average CPA if there is no target
- the term is not brand traffic

This turns "this term didn't convert" into "this term is very unlikely to convert at the normal rate".

### 2.7 Conversion lag

Google credits conversions to the click date, so recent days are incomplete.

- Read `segments.conversion_lag_bucket` for the last 90 days.
- From it, estimate *c(d)*, the share of conversions that have arrived *d* days after the click.
- Adjust recent conversions as `observed / c(d)`, or wait until *c* ≥ 0.9 before measuring.

The report states which method it used.

### 2.8 Can the result be measured? (Minimum detectable effect)

Before choosing an action's metric, check whether a realistic effect could show up in the data. For a baseline rate *p* and *n* units per window, the minimum detectable relative effect at 80% power and 5% significance is about:

`MDE ≈ 2.8 × √(2p(1−p)/n) / p`

- **If the MDE is above 30%:** measure a higher-volume metric instead (CTR, CTA clicks, form starts), or extend the window to 14 or 28 days. Say so up front.
- **Example:** 1,000 sessions a week at a 3% conversion rate gives an MDE of about 71%, so a conversion-rate change cannot be measured in one week. CTA clicks at 15% of sessions give an MDE of about 30%, which is borderline but workable. Smaller sites need 14–28-day windows or higher-volume metrics.

### 2.9 Expected value of an action

Every candidate action gets an expected weekly gain, calculated as affected volume × expected relative uplift × value per conversion. It is reported with a low/high range. **The uplift priors come from a small reviewed table per action type**, such as "negative keywords recover 50–100% of the flagged spend", not from the model. The table is replaced over time by Xaylo's own measured results (Section 6.3).

---

## 3. The opportunity engine

The weekly report should not ask the model to find problems in raw data. Instead, a deterministic engine (`src/reporting/opportunities.ts`) runs a library of candidate generators. Each one has eligibility rules, the evidence it requires and an expected-value formula.

| Candidate | Eligible when | Metric to measure | Risk |
| --- | --- | --- | --- |
| **Fix conversion tracking** | Ads clicks and Paid search sessions differ by > 30%; a primary conversion action looks wrong (a page view counted as primary, or "count every" on leads); zero conversions on a day after steady volume | Tracking coverage | None; always first if eligible |
| **Add negative keywords** | Search terms flagged by Section 2.6 | Wasted spend recovered | Low |
| **Fix a landing page** | High-traffic landing page whose shrunk rate is below the site's, with P ≥ 0.9 after BH correction | Landing-page CTA clicks or conversions | Low |
| **Sharpen a Xaylo Journey** | A journey's conversion rate is clearly below the same traffic's rate without the journey, or its content no longer matches the campaign intent | Journey conversion rate | Low |
| **Align an ad with its landing page** | Ads landing page (`landing_page_view`) with good CTR but a poor on-site rate | Conversion rate from that ad's sessions | Low |
| **Change ad schedule or device bids** | A device or time segment is clearly worse after shrinkage and BH, with enough spend to matter | CPA for that segment | Medium |
| **Pause a waste segment** | An ad group or keyword with spend ≥ 2× target CPA and P(meeting target CPA) < 0.1 | Spend saved at the same conversion volume | Medium |
| **Lift a budget-capped winner** | CPA ≤ target, budget-lost impression share ≥ 20%, ≥ 15 conversions in the window | Conversions at the same CPA | Medium; never on sparse data |
| **Fix follow-up** (GHL) | Opportunity win rate or time-to-close for one source is clearly worse than for others | Win rate by source | Low |

Ranking score = `expectedValue × P(improvement) ÷ effort`, with penalties for these cases:

- **Overlap:** the action touches the same campaign or page as a recent change or one still being measured.
- **Repetition:** the same type of action failed in the last 8 weeks.
- **Can't be measured:** the MDE is above the threshold even over 28 days.

The engine sends the **top 3 to 5 candidates** to the model, each with its evidence, statistics, metric, MDE and risk. The model must choose one by `candidateId`, which is an enum in the output schema. If none is worth doing, it must choose the measurement-improvement fallback.

---

## 4. Prompt changes

1. **Role and inputs.** The model is given the business context, the previous action and its measured result, the candidate list, and supporting evidence. It is told the statistics are already computed and correct.
2. **No arithmetic.** It may quote only numbers that appear in the evidence. A post-check extracts every number from the output and matches it against the cited evidence, within rounding. If any don't match, the report is regenerated once, then the attempt fails without consuming the user's report.
3. **Wording follows the statistics.** "Clearly", "likely" and "no clear difference" map to the thresholds in Section 2.3. Rows labelled `insufficient` can only be described as "too little data".
4. **One change at a time.** The action must not overlap with changes recorded in Ads change history during the measurement window, so its result can be attributed.
5. **Learn from the last result.** If the previous action's result was "worse", the model must not recommend the same type of action for the same target. If it was "inconclusive", it can continue measuring or choose a more measurable action.
6. **Explain uncertainty plainly.** Give the expected gain as a range, for example "about 2–6 extra leads a week", never as a single promise.
7. **Untrusted input.** Keep the existing rules: business context and source labels are data, not instructions.
8. **Version and evaluate.** Every prompt change bumps the version, and must pass the evaluation set before release (Section 7).

---

## 5. Data and tools needed for a good report

### 5.1 Google Ads: extra read-only queries

All of these are `googleAds:search` reads, so the read-only guard still holds. Check each field against the current Google Ads API field reference when implementing.

| Data | GAQL resources and fields | Why it matters |
| --- | --- | --- |
| Daily time series for 8 weeks | `campaign` with `segments.date` | Baselines, trends and control bands (Section 2.5) |
| Budget and bidding | `campaign.campaign_budget`, `campaign_budget.amount_micros`, `campaign.bidding_strategy_type`, the target CPA/ROAS fields on the bidding strategy | Whether an increase is possible; the user's targets |
| Impression share | `metrics.search_impression_share`, `metrics.search_budget_lost_impression_share`, `metrics.search_rank_lost_impression_share` | Separates "capped by budget" from "losing on rank" |
| Conversion-action setup | `conversion_action` status, category, `primary_for_goal`, `counting_type`, lookback windows, value settings | Tracking health; whether ROAS can be trusted (R-6) |
| Conversion lag | `segments.conversion_lag_bucket` | Lag adjustment (Section 2.7) |
| Landing pages | `landing_page_view.unexpanded_final_url` with click and conversion metrics | Joins Ads landing pages to Xaylo's on-site behaviour |
| Device and schedule | `segments.device`, `segments.day_of_week`, `segments.hour` | Schedule and device candidates |
| Keyword quality | `ad_group_criterion.quality_info.*` | Explains losses due to rank, and ad relevance |
| **Change history** | `change_event`, last 30 days, filtered by date | Confirms that "Mark as done" happened, and **detects other changes that could confound** a result |
| Google's own recommendations | `recommendation`, `customer.optimization_score` | Context only; Xaylo should not simply repeat them |

Performance Max campaigns give limited search-term and placement detail, so report that as a limitation. These queries roughly double the Ads operations per report. Fetch them once per report and cache them for the day (issue **I-19**, quota).

### 5.2 HighLevel CRM

| Data | Scope | Why |
| --- | --- | --- |
| Won and lost status changes with dates (already readable) | `opportunities.readonly` (current) | Win rate and time to close by source; the real outcome behind a lead |
| Contact attribution (UTM/gclid fields on contacts, if present) | `contacts.readonly` (current) | Joins leads to campaigns in aggregate. Check which fields the API returns. |
| Appointments | `calendars.readonly` (**new scope**) | Booked calls are often the real conversion for service businesses |
| Response time | `conversations.readonly` (**new scope**) | Speed-to-lead is one of the largest levers on lead value |

New scopes require users to grant consent again and may require another HighLevel Marketplace review (**I-14**). Keep the current scopes for the MVP, and add appointments first after launch.

### 5.3 Website tracker

- **Micro-conversions:** `window.Xaylo.track('cta_click' | 'form_start' | 'phone_click' | 'email_click')`, plus automatic tracking of `tel:` and `mailto:` link clicks. These give the volume needed to measure changes within a week (Section 2.8).
- **Device class** (mobile, tablet, desktop) from the viewport, with no fingerprinting.
- **Basic bot filtering:** drop sessions with no interaction and a sub-second dwell, and sessions from known crawler user agents. Report the share filtered out.
- **Channel group** stored at collection time (R-2).

### 5.4 Business inputs in Connections → Your marketing goals

Add structured, optional fields alongside the free text:

- value per lead or per sale, and currency
- target CPA or target ROAS
- monthly ad budget
- gross margin %, optional
- brand terms (so brand searches aren't flagged as waste)
- service areas, with a link to Ads geo targets later

Use these defaults when a field is empty, and say so in the report:

- value per conversion: Ads conversion values when they are real, otherwise "unknown", and the report ranks by conversions instead of value
- target CPA: the account's 8-week average CPA

### 5.5 Optional sources for later

- **Google Search Console** (`webmasters.readonly`) for organic queries and landing-page click-through rate. It is useful for organic opportunities, but it is another sensitive Google scope that needs verification. Add it after launch.
- **Microsoft Ads and Meta Ads** for more channels. Out of MVP scope.
- **Call tracking.** Phone calls are often the main conversion for small businesses. Tracking `tel:` link clicks (Section 5.3) covers the basics, and HighLevel call data could later supply connected calls.

GA4 is not needed: Xaylo's own tracker and Ads cover what the report uses, and adding it would introduce a third conflicting conversion definition.

---

## 6. Measuring results (upgrade to plan Step 9)

### 6.1 Agree the measurement up front

When an action is issued, store the following:

- the metric and its direction
- the window, normally 7 days, or 14–28 if the MDE requires it
- a **control segment**: comparable traffic the change does not touch, such as other campaigns, other landing pages or the same pages on other devices
- the baseline from the previous 4–8 weeks for both the target and the control

### 6.2 Evaluate the result

- **Difference-in-differences:** (target after − target before) − (control after − control before). Use a Beta–Binomial or Poisson model for uncertainty, and report P(improved) and the effect with a 90% interval.
- **Lag adjustment** for Ads conversions (Section 2.7).
- **Confounders:** list any changes from the Ads change history in the window, unusual weeks outside the control band, and tracking gaps.

Verdict:

| Condition | Verdict |
| --- | --- |
| P(improved) ≥ 0.9 | Improved |
| P(improved) ≤ 0.1 | Worse |
| Otherwise | Inconclusive (offer to keep measuring) |

Re-check the same action at 14 and 28 days. Conversions arrive late and effects build up, so the verdict can change.

### 6.3 ROI ledger and learning

- For each workspace, keep a running ledger of actions, verdicts and estimated weekly gains with their ranges. It underpins the user's trust, and later the Autopilot tier.
- Calibrate the engine's uplift priors (Section 2.9) from Xaylo's own results across workspaces. Use aggregated action-type statistics only, never one client's data in another's report. Disclose this in the terms and privacy policy. **This is what makes ROI more consistent over time:** the system learns which action types actually pay off for businesses like the user's.

---

## 7. Testing and proving accuracy

- **Unit tests** for each `src/stats` function against known values: Wilson intervals, shrinkage, BH correction, MDE.
- **Simulation tests:**
  - Generate synthetic traffic with **no real effect** and check that the engine reports "no clear difference" or "inconclusive" at least 90% of the time (false-positive control).
  - Inject known effects (for example +30% on one landing page) and check that the engine finds them at the expected rate (power).
  - Run these in CI with a fixed seed.
- **An end-to-end evaluation set:** 15–25 data pools with a known correct top candidate, including traps:
  - a tiny-sample "winner"
  - organic Google traffic labelled as referral
  - a week distorted by a holiday
  - a broken conversion action
  - a confounding change in Ads

  The engine and prompt must choose the correct candidate, and every number must pass the number check.
- **Live monitoring:**
  - the share of actions with "improved", "worse" and "inconclusive" verdicts
  - the median realised gain against the predicted range
  - the calibration error

  These are reported internally on the admin page.

---

## 8. MCP changes

### 8.1 Review of the current tools

| Tool | Assessment | Change |
| --- | --- | --- |
| `get_reporting_allowance` | Fine | Add `nextReportAt` and `pausedReason` (plan Step 8) |
| `get_connected_accounts` | Fine | Add the Google connection status |
| `get_business_context` | Free text only | Return the structured inputs from Section 5.4 |
| `get_crm_summary` | Counts only | Add win rate and time to close by source, with intervals |
| `get_traffic_analysis` | Raw rates with no intervals or channel groups | Use the stats-enriched rows and channel groups |
| `get_google_ads_performance` | Up to 200 raw rows; leaves the assistant to do the maths | Add intervals and shrunk rates; default to the top 25 plus a summary |
| `get_marketing_overview` | Snapshot only | Add the baseline comparison |
| `generate_marketing_report` | Fine once the weekly gate exists | Uses the opportunity engine |
| `list_reports`, `get_report` | Fine | Include the action, its measurement and its result |

### 8.2 New read-only tools

These are in addition to plan Step 6's `get_xaylo_journeys`, `get_journey_performance`, `get_routes`, `get_traffic_sources`, `get_google_ads_conversions`, `get_ads_traffic_association`, `get_data_pool`, `get_current_action` and `get_ai_status`.

| Tool | Returns |
| --- | --- |
| `get_opportunities` | The ranked candidate actions with expected value, probability, metric, MDE and risk, from the same engine the report uses |
| `compare_periods` | `metric`, `segment`, `weeks` → this week against the baseline band, with a z-score and trend |
| `get_tracking_health` | Click-to-session match, conversion-action configuration problems, gclid capture rate, bot-filtered share, gaps |
| `get_ads_diagnostics` | Budget, bidding, impression share lost to budget and to rank, quality-score summary, device and schedule splits |
| `get_landing_page_performance` | Xaylo landing pages joined to Ads `landing_page_view`, with shrunk rates and intervals |
| `get_search_term_waste` | The terms flagged by Section 2.6, with P(0 conversions), spend and brand exclusion |
| `get_change_history` | Recent Ads changes (from `change_event`), summarised |
| `get_action_history` | The ROI ledger: past actions, verdicts and estimated gains |

Every row-level output carries `n`, `rate`, `low`, `high`, `reliability` and, where relevant, `shrunkRate`. Each tool description tells assistants to quote these fields and not to compute their own differences.

### 8.3 Other MCP features to use

- **Server `instructions`:** a short methodology covering the recommended tool order, how to read the reliability labels, and never to treat Ads conversions, website conversions and CRM wins as the same thing.
- **An MCP `prompts` entry, `weekly_review`:** gives assistants such as Claude Desktop the same review approach Xaylo AI uses, so a user's own assistant reaches compatible conclusions.
- **An MCP resource, `xaylo://definitions`:** a glossary of metrics, channel groups, the attribution model and the date conventions.
- **Consistency:** tools and reports read from the same cached data pool for each workspace and period, identified by a hash. An assistant and a report generated in the same hour therefore see identical numbers.

---

## 9. Proposed changes to the MVP plan

| Plan step | Change |
| --- | --- |
| Before Step 1 | **New PR: accuracy fixes R-1 to R-4.** Per-row confidence, channel grouping, Paid-search-only coverage, complete calendar days in the account timezone. |
| Step 3 | Add the Ads queries from Section 5.1. |
| Step 5 | Split into **5a, the statistics module** (Section 2), with unit and simulation tests, and **5b, the opportunity engine** (Section 3). Add structured business inputs (Section 5.4) and tracker micro-conversions (Section 5.3). |
| Step 6 | Add the tools and features in Section 8. |
| Step 7 | Prompt changes from Section 4, including the number check and the candidate enum. |
| Step 8 | The action must come from the engine's candidates, and the metric is chosen using the MDE check. |
| Step 9 | Agreed measurement, control segment, difference-in-differences, lag adjustment, re-checks at 14 and 28 days, and the ROI ledger (Section 6). |

This adds about 3 PRs to the MVP. The order would be: accuracy fixes, then the statistics module, then the opportunity engine. Each is still a small, testable step.
