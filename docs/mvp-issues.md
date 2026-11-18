# MVP issues and open decisions

This file lists the issues raised while scoping [the MVP plan](mvp-plan.md) and [the pricing proposal](pricing.md). Items marked **Decision** need a product owner's answer before the step they affect starts. Resolved items are kept as a record of what was decided.

| ID | Status | Step | Summary |
| --- | --- | --- | --- |
| I-1 | Resolved | 3 | Read-only enforced by Xaylo; MVP does read operations only |
| I-2 | Verify | 1 | Developer token retired; access now belongs to the Cloud project |
| I-3 | High | 1, 2 | Google verification, and Testing tokens that expire after 7 days |
| I-4 | Resolved | 7 | Xaylo AI only; the OpenAI code path is removed |
| I-5 | Resolved | 7 | No customer API keys anywhere |
| I-6 | Resolved | 8 | 14-day trial; Insights at £49; Autopilot shown as unavailable |
| I-7 | Medium | 9 | Before/after results are correlational and affected by conversion lag |
| I-8 | Resolved | 10 | "Routes" for traffic paths; "Xaylo Journeys" for configured journeys |
| I-9 | Medium | 4, 9 | Storing baselines conflicts with the documented storage policy |
| I-10 | Low | 2 | The callback page mentions HighLevel |
| I-11 | Low | 2 | Discovery shows IDs only and needs a manual manager ID |
| I-12 | Medium | 4 | `click_view` limits |
| I-13 | Low | 1 | Google Ads API version upkeep |
| I-14 | Low | 6 | GHL scopes |
| I-15 | Medium | 10 | Rings view payload size |
| I-16 | Resolved | all | `main` is protected; CI added |
| I-17 | Owner | 8 | Billing moves from Stripe to SwanPay |
| I-18 | Future | ROI Pro | The first write operation ends the read-only position |
| I-19 | Medium | 1 | Explorer quota is shared across all workspaces |
| I-20 | Medium | pricing | Advertising features that are not built yet |
| I-21 | Low | 7 | Opus report cost and latency |

---

### I-1 Read-only enforced by Xaylo (Resolved)

Google Ads has only one OAuth scope (`adwords`), which allows both reading and writing. Decision: Xaylo enforces read-only itself, and the MVP performs read operations only. Step 3 adds an endpoint allowlist and a test that fails if a mutate path is added. The consent copy, privacy policy and scope justification all state that Xaylo makes no changes.

### I-2 Developer token retired; access now belongs to the Cloud project (Verify)

Google's developer-token page (as quoted in search results) and several 2026 guides say developer tokens were retired on 9 September 2026. Access levels (Test, Explorer, Basic, Standard) now belong to the **Google Cloud project**, which requests identify through `x-goog-user-project`. A developer token that is still sent is ignored, and a future API version will reject it. This **replaces the earlier version of this issue**, which said the token was required.

**Effect on the one-click goal:** advertisers do nothing except approve OAuth consent. All access approval is a one-time task for Xaylo on its own Cloud project (Step 1).

**Action:** Google's official pages (`developers.google.com/google-ads/api/docs/api-policy/developer-token` and `…/access-levels`) could not be fetched from this session. A person should confirm the retirement and the quotas for each access level before Step 1 is merged.

### I-3 Google verification, and Testing tokens that expire after 7 days (High)

While the consent screen is in Testing, refresh tokens expire after 7 days and only listed test users (100 at most) can connect. Publishing for general use needs brand verification and sensitive-scope verification: a verified domain, privacy policy, demo video and scope justification. Basic API access also needs brand verification.

**Resolution:**
- Submit for verification as soon as the Step 2 connection flow can be recorded.
- Use the Testing mode for internal QA only.
- The Step 2 re-approval pause means an expired token pauses reports and shows a one-click reconnect, instead of an error.
- Confirm during submission that no CASA assessment is needed (`adwords` is expected to be a sensitive scope, not a restricted one).

### I-4 Xaylo AI only (Resolved)

Decision: there is no provider choice and no customer key. Every report uses Xaylo AI: Xaylo's Anthropic key and `claude-opus-5-5` at high effort, chosen for report quality. Step 7 removes the OpenAI code path and the `OPENAI_API_KEY` and `AI_MODEL` settings. List Anthropic as a sub-processor in the privacy policy.

### I-5 No customer API keys anywhere (Resolved)

With Xaylo AI as the only engine, customers never enter or send an API key, in the dashboard or through MCP. Claude and other assistants can still connect to Xaylo's MCP server through the existing OAuth flow; that needs no key.

### I-6 Trial and plan rules (Resolved)

- A 14-day trial is now the default (`FREE_TRIAL_DAYS=14`).
- **Xaylo Insights** costs £49/month or £490/year.
- **Xaylo Autopilot** costs £149/month or £1,490/year. It is shown as currently unavailable and cannot be bought.
- Both plans come from `src/billing/plans.ts`.
- The trial currently includes one report. Step 8 changes this to two weekly reports and replaces `PAID_REPORTS_PER_MONTH` with the 7-day gate.

### I-7 Before/after results are correlational and affected by conversion lag (Medium)

A 7-day comparison cannot prove cause and effect. Google Ads credits conversions to the click date, so the "after" window is undercounted when it is first measured. Label results as "observed change", show sample-size warnings, add a lag note to Ads metrics, and offer to re-measure 7 days later. Prefer first-party website metrics where they fit the action.

### I-8 "Routes" for traffic paths (Resolved)

"Xaylo Journeys" means only the configured journeys. Observed traffic paths are now called **routes**, which matches the roads in the topology view, and the topology view is called the **route map**. Selecting a route in the rings view opens the route map, and a Xaylo Journey filter applies to both views. The UI text in `PathList.vue` and `TrafficView.vue` is renamed in Step 10.

### I-9 Storing baselines conflicts with the documented storage policy (Medium)

`docs/reporting.md` says Ads datasets are not mirrored. Store only the single aggregate metric and its supporting counts for each action, and hold gclid-to-campaign matches in memory only. Update the storage section of the docs and the privacy policy.

### I-10 The callback page mentions HighLevel (Low)

`src/google/routes.ts:186` tells users to "Return to Xaylo in HighLevel, refresh Settings". The popup flow in Step 2 replaces this page.

### I-11 Discovery shows IDs only and needs a manual manager ID (Low)

Step 2 fixes this by looking up account details and expanding manager accounts. Discovery is capped at 25 accounts; anything beyond that uses manual entry under **Advanced**.

### I-12 `click_view` limits (Medium)

`click_view` must be queried one day at a time, covers only about the last 90 days, and returns one row per click. Clicks with `gbraid`/`wbraid` instead of `gclid` cannot be matched to a campaign this way. Query only the days in the period and only when some sessions have a gclid, label truncated days as partial, and encourage `xaylo_campaign_id={campaignid}` in the final URL suffix.

### I-13 Google Ads API version upkeep (Low)

The code defaults to `GOOGLE_ADS_API_VERSION=v26`. Confirm that v26 is still supported at release, and check the version every quarter.

### I-14 GHL scopes (Low)

The MVP's GHL reads use scopes that are already requested. Adding more GHL scopes later means users must give consent again and the app may need another Marketplace review.

### I-15 Rings view payload size (Medium)

Aggregate on the server (pages × ring × source group, plus flows between rings), cap nodes at about 12 per ring with an "Other pages" node, and fetch detailed routes only when a route is selected.

### I-16 `main` is protected; CI added (Resolved)

`main` is protected. `.github/workflows/ci.yml` runs `npm ci` and `npm run check` on every pull request and on pushes to `main`. It starts a PostgreSQL 16 service, so the database integration test runs too. After the first green run, set **Build and test** as a required status check in the branch protection settings.

### I-17 Billing moves from Stripe to SwanPay (Owner, later)

Xaylo will not use Stripe. The product owner will implement a **SwanPay** checkout later. Until then:

- The existing Stripe code (`src/billing/stripe.ts`, `src/billing/routes.ts`, the `STRIPE_*` settings and the Stripe webhook) stays in place but unconfigured. With no Stripe settings, the Billing page shows "Subscriptions are not configured", and trial access works as before.
- The plan catalogue (`src/billing/plans.ts`) does not depend on any payment provider. SwanPay checkout should sell Insights monthly (£49) and yearly (£490) from it.

What the SwanPay work needs to cover:
- Replace `entitlement()`'s Stripe subscription check with SwanPay subscription status, verified on the server and never trusted from the checkout return URL.
- A signed webhook for subscription changes, deduplicated the way `billing_receipts` does today.
- Monthly and yearly intervals.
- A customer portal or cancellation path.
- Removing the Stripe code, settings and the `stripe` dependency, and updating `docs/reporting.md` and the integration test's billing section.

Autopilot needs no SwanPay product until it is built.

### I-18 The first write operation ends the read-only position (Future)

The ROI Pro ideas (offline conversion import, budget changes) write to Google Ads. These would need new consent wording, a privacy update, an updated scope justification and probably Standard API access. Keep them out of the MVP and treat them as a separate project with its own review.

### I-19 Explorer quota is shared across all workspaces (Medium)

Quotas belong to Xaylo's Cloud project, so Explorer's 2,880 operations a day is shared by every workspace. At about 30 operations per weekly report plus dashboard and MCP reads, that supports a pilot of roughly 50–100 active workspaces.

**Resolution:**
- Cache Ads responses for each workspace and period for 15 minutes.
- Log the operations count per request.
- Alert at 70% of the daily quota.
- Apply for Basic access (15,000 operations a day) as soon as brand verification passes.

### I-20 Advertising features that are not built yet (Medium)

Autopilot advertises daily reports, automatic ROI improvements, automated strategy and custom AI journeys, none of which exist yet. To keep the listing fair under UK consumer protection rules, the card is greyed out, labelled "Currently unavailable", has no purchase button, and the guide says its features are "planned, not available". Do not collect payment or pre-orders for it.

"Automatic ROI improvements" implies writing to Google Ads, which is a separate project (**I-18**). Avoid promising specific ROI figures.

### I-21 Opus report cost and latency (Low)

Each Xaylo AI report on `claude-opus-5-5` costs about £0.32 and can take a minute or more with thinking. Use streaming with a generous timeout, keep the "Generating…" state in the UI, and cache the fixed system prompt. If daily Autopilot reports are built later, revisit the model choice and size for each report type.

