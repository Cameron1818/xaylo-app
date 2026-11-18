# MVP issues and open decisions

This file lists the issues raised while scoping [the MVP plan](mvp-plan.md) and [the pricing proposal](pricing.md). Items marked **Decision** need a product owner's answer before the step they affect starts. Resolved items are kept as a record of what was decided.

| ID | Status | Step | Summary |
| --- | --- | --- | --- |
| I-1 | Resolved | 3 | Read-only enforced by Xaylo; MVP does read operations only |
| I-2 | Verify | 1 | Developer token retired; access now belongs to the Cloud project |
| I-3 | High | 1, 2 | Google verification, and Testing tokens that expire after 7 days |
| I-4 | Resolved, with naming caution | 7 | User chooses the AI provider: Xaylo AI, OpenAI or Claude |
| I-5 | Resolved | 7 | Keys are entered in the dashboard, never through MCP |
| I-6 | Decision | 8 | Trial and plan rules replace the monthly quota |
| I-7 | Medium | 9 | Before/after results are correlational and affected by conversion lag |
| I-8 | Resolved | 10 | "Routes" for traffic paths; "Xaylo Journeys" for configured journeys |
| I-9 | Medium | 4, 9 | Storing baselines conflicts with the documented storage policy |
| I-10 | Low | 2 | The callback page mentions HighLevel |
| I-11 | Low | 2 | Discovery shows IDs only and needs a manual manager ID |
| I-12 | Medium | 4 | `click_view` limits |
| I-13 | Low | 1 | Google Ads API version upkeep |
| I-14 | Low | 6 | GHL scopes |
| I-15 | Medium | 10 | Rings view payload size |
| I-16 | Partly resolved | all | `main` is protected; no CI yet |
| I-17 | Medium | 8 | Billing supports only one Stripe price |
| I-18 | Future | ROI Pro | The first write operation ends the read-only position |
| I-19 | Medium | 1 | Explorer quota is shared across all workspaces |

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

### I-4 User chooses the AI provider (Resolved, with naming caution)

Decision: workspaces choose between **Xaylo AI** (included, using Xaylo's key and a low-cost model), **OpenAI with their own key** (reusing the existing code) and **Claude with their own key**.

**Naming caution:** avoid labels such as "ChatGPT-Astra" or "Claude-Fable".
- ChatGPT is OpenAI's consumer product, and an OpenAI API key does not use ChatGPT.
- "Claude Fable" is the name of a real Anthropic model family, so the label would suggest a model or partnership the setting does not provide.
- Inventing sub-brands on top of other companies' trademarks invites confusion and possible objections.

Use plain descriptive labels: "Xaylo AI", "OpenAI (your key)", "Claude (your key)". Show the selected model as a separate field.

**Model for Xaylo AI:** `claude-haiku-5-5`, costing about $0.01 per report. Measure report quality against `claude-sonnet-5-5` (about $0.10 per report) on staging data before launch. The cost is low enough to use the better model for paid plans if it gives better results.

**Privacy policy:** list Anthropic as a sub-processor for Xaylo AI. For keys the user brings, the user's own agreement with OpenAI or Anthropic applies.

### I-5 Keys are entered in the dashboard, never through MCP (Resolved)

"MCP takes a Claude API key" is implemented as a workspace setting: the key is entered once in Connections, stored encrypted, and used for reports requested from both the dashboard and MCP. Keys are never accepted as MCP tool arguments, because they would end up in assistant transcripts. Claude can still connect to Xaylo's MCP server as a custom connector through the existing OAuth flow, with no key needed.

### I-6 Decision: trial and plan rules

Proposal (see [docs/pricing.md](pricing.md)):
- A 14-day trial with two weekly reports, replacing the current 7-day trial with one report.
- **Insights** at $49 a month as the only paid plan at launch.
- The weekly gate replaces `PAID_REPORTS_PER_MONTH`.
- Source analysis and MCP read tools stay unlimited while a plan or trial is active.

Confirm the price point, the trial length, and whether customers who bring their own key pay the same price.

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

### I-16 `main` is protected; no CI yet (Partly resolved)

`main` is now protected. The repository has no CI workflow yet, so add a GitHub Actions job that runs `npm run check` on pull requests and make it a required status check.

### I-17 Billing supports only one Stripe price (Medium)

`STRIPE_PRICE_ID` and `subscriptionPaid` in `src/billing` assume one plan. Launch with Insights only. Growth and Agency need a mapping from price to plan, limits per plan (Ads accounts, Xaylo Journeys, lookback period) and per-workspace billing for agencies. Plan that as a follow-up after the MVP.

### I-18 The first write operation ends the read-only position (Future)

The ROI Pro ideas (offline conversion import, budget changes) write to Google Ads. These would need new consent wording, a privacy update, an updated scope justification and probably Standard API access. Keep them out of the MVP and treat them as a separate project with its own review.

### I-19 Explorer quota is shared across all workspaces (Medium)

Quotas belong to Xaylo's Cloud project, so Explorer's 2,880 operations a day is shared by every workspace. At about 30 operations per weekly report plus dashboard and MCP reads, that supports a pilot of roughly 50–100 active workspaces.

**Resolution:**
- Cache Ads responses for each workspace and period for 15 minutes.
- Log the operations count per request.
- Alert at 70% of the daily quota.
- Apply for Basic access (15,000 operations a day) as soon as brand verification passes.
