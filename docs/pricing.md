# Pricing and trial proposal

This is a proposal for the product owner to decide on. Competitor prices come from third-party summaries published in 2026, which cite the vendors' pricing pages; check them on each vendor's own site before publishing anything.

## Comparable products

| Product | What it does | Entry price | Trial | Pricing basis |
| --- | --- | --- | --- | --- |
| Opteo | Google Ads recommendations | $129/mo (10 accounts, $25k spend); $249, $499, Enterprise | 14 days | Number of accounts and ad spend |
| Optmyzr | PPC optimisation suite | About $209/mo yearly or $299 monthly (up to $25k spend) | 14 days, no card | Ad spend |
| WhatConverts | Lead and call attribution | $30–$160/mo for one account; agency plans $500+ | 14 days | Features, plus usage fees |
| AgencyAnalytics | Client reporting dashboards | $20/client/mo yearly ($25 monthly) | 14 days, no card | Per client |
| Ruler Analytics | Marketing attribution to revenue | About £199/mo (small) up to £1,149/mo+ | Demo-led | Website traffic |

**What this means for Xaylo:** a 14-day trial is the norm in this market. Ads optimisation tools start at $129–$300 a month and price by ad spend. Reporting tools charge about $20–$25 per client. Attribution tools charge more as they get closer to revenue. Xaylo's MVP is read-only insight plus journey personalisation with one weekly action, so it should sit **below Opteo** and **above simple reporting**. It can then move up as the ROI features arrive.

## Cost to serve

At one report per week, Xaylo AI on `claude-haiku-5-5` costs about **$0.01 per report**: roughly 25k input tokens and 5k output tokens at $0.10 / $0.50 per million. On `claude-sonnet-5-5` it is about $0.10. The AI cost is therefore negligible; hosting, support and Google API quota matter more. Users who bring their own OpenAI or Claude key pay their provider directly, so they do not need a discount.

## Proposed tiers

| | Trial | **Insights** (MVP launch) | **Growth** (after MVP) | **Agency** (after MVP) | **ROI Pro** (future) |
| --- | --- | --- | --- | --- | --- |
| Price | Free, 14 days, no card | **$49/mo** or $490/yr | $99/mo or $990/yr | $249/mo for 10 workspaces, then $19 per extra workspace | From $199/mo, or a share of the value proven (to be decided) |
| Workspaces / sites | 1 | 1 | 1 | 10+ | 1 |
| Google Ads accounts | 1 | 1 | 3 | 3 per workspace | Unlimited |
| Weekly single-action report | 2 (weeks 1 and 2) | Every 7 days | Every 7 days | Every 7 days per workspace | Every 7 days, plus ROI reviews |
| Result of last change | Yes (week 2) | Yes | Yes, with a 12-month ROI history | Yes | Full ROI ledger |
| Lookback for analysis | 7 days | 30 days | 90 days | 90 days | 12 months |
| Xaylo Journeys | 3 | 10 | Unlimited | Unlimited | Unlimited |
| AI provider | Xaylo AI | Xaylo AI, or your own key | All three | All three | All three |
| MCP | Read | Read | Read and generate | Read and generate | Read and generate |
| GHL | Yes | Yes | Yes | Yes | Yes, with revenue matching |

**Why $49 for Insights:** it is under half of Opteo's entry price, it is in WhatConverts' mid range, and it is low enough for small GHL businesses to buy without a sales call. A weekly action with a measured result is something users can check for themselves. Yearly billing at 10 months' price matches the discounts competitors offer.

**Launch with the Trial and Insights only.** The billing code supports a single Stripe price today (`STRIPE_PRICE_ID`). Growth and Agency need multiple prices and plan-based limits (**I-6**, **I-17**).

## Trial design

- 14 days, no card, starting when the workspace is created (`FREE_TRIAL_DAYS=14`).
- Day 0: the first weekly report and action. Day 7: the result of that action, plus the second report. Day 14: the second result, which is the prompt to upgrade.
- If Google Ads needs re-approval during the trial, the trial is extended by the length of the pause, up to 7 days, so a token problem does not cost the user their trial.
- After the trial, the dashboard, Xaylo Journeys, tracking and saved reports stay readable. Generating new reports and running new analysis require a subscription, as today.

## The path to advanced ROI

Each later tier is built on data the MVP already starts collecting:

1. **MVP:** each action stores a baseline and an observed result (Step 9). This becomes a record of the changes the user made and what happened afterwards.
2. **Growth:** an ROI history across 12 months, cost per conversion for each Xaylo Journey from linked Ads spend, and alerts when a measured change reverses.
3. **ROI Pro:** revenue matching between GHL opportunities that were won and linked sessions; actions that move budget between campaigns, with a forecast; more ad channels.
   - Uploading offline conversions to Google Ads would be the first **write** operation. It ends the read-only position, so it needs new consent wording, a privacy update and probably Standard API access (**I-18**).
   - Pricing based on the value proven should wait until the ROI record is trustworthy.
