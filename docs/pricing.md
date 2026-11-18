# Pricing and trial

The plan catalogue in code is `src/billing/plans.ts`. It is the single source for the plan names, prices and features shown on the public guide (`/#pricing`) and on the dashboard's Billing page. Checkout charges the Stripe Price configured in `STRIPE_PRICE_ID`, which must match the Insights monthly price (**I-17**).

## Plans

| | Free trial | **Xaylo Insights** | **Xaylo Autopilot** |
| --- | --- | --- | --- |
| Status | Available | **Available**, the first paid plan | **Currently unavailable**: shown greyed out with a "Coming soon" button, and cannot be bought |
| Price | Free for 14 days, no card | **£49/month or £490/year** | **£149/month or £1,490/year** |
| Reports | Weekly reports during the trial | One AI report with one action every 7 days | Daily smart summaries and daily AI reports |
| Results tracking | Result of the first action | Result of the last change before each report | Continuous ROI tracking |
| Traffic | Traffic and visitor route analysis | Traffic, visitor routes and conversion analysis | The same, with smart alerts when performance shifts |
| Google Ads | Read-only conversions and clicks | Read-only conversions and clicks | Automatic ROI improvements (**I-18**) |
| Strategy | — | Advisory: you make the changes | Automated strategy that adapts as results come in |
| Journeys | Xaylo Journeys | Xaylo Journeys personalisation | **Custom AI journeys** that evolve from your Xaylo Journeys |
| HighLevel CRM | Optional | Optional | Optional |
| MCP assistant access | Yes | Yes | Yes |

Everything in the Autopilot column is planned, not built. The public guide says this beneath the plan cards.

The trial currently includes one AI report, because the report rules are unchanged until Step 8. Step 8 changes it to two weekly reports, so trial users see the result of their first action before deciding to subscribe.

## How the prices compare

Comparable tools mostly offer a **14-day trial**, which Xaylo matches. Prices are from third-party 2026 summaries and should be checked on the vendors' own sites before being quoted publicly.

| Product | Entry price | What it does |
| --- | --- | --- |
| Opteo | $129/month | Google Ads recommendations |
| Optmyzr | $209–299/month | PPC optimisation, priced by ad spend |
| WhatConverts | $30–160/month | Lead and call attribution |
| AgencyAnalytics | $20–25 per client per month | Client reporting |
| Ruler Analytics | About £199/month and up | Revenue attribution |

At £49, Insights is well under the Ads optimisation tools and costs about the same as mid-range attribution plans, while adding journey personalisation and a measured weekly action. At £149, Autopilot is still cheaper than Opteo's and Optmyzr's mid tiers, which matters because it is the automated tier.

## Cost to serve

Xaylo AI uses `claude-opus-5-5` for every report, chosen for report quality rather than the lowest cost. A weekly report costs roughly **£0.32** (about 25k input tokens and up to 15k output tokens at $4 / $20 per million tokens), or under £1.50 per workspace a month. That is about 3% of the Insights price. Daily Autopilot reports would cost roughly £10 a month per workspace at the same size, about 7% of £149. Caching and smaller daily summaries would bring that down further.

## The path to ROI improvement

1. **Insights (MVP):** each weekly action records a baseline and an observed result. Over time this becomes the ROI history that later automation learns from.
2. **Autopilot, read-only first:** daily summaries, smart alerts, an automated strategy that ranks the next actions, and custom AI journeys suggested from the routes that convert best.
3. **Autopilot, with writes:** automatic ROI improvements to Google Ads, such as uploading offline conversions and shifting budget between campaigns. These are the first write operations and need separate consent, policy and API-access work (**I-18**).
