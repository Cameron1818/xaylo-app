# MVP issues and open decisions

This file lists the issues raised while scoping [the MVP plan](mvp-plan.md). Each one has a severity, the plan step it affects, and a proposed resolution. Items marked **Decision** need a product owner's answer before that step starts.

| ID | Severity | Step | Summary |
| --- | --- | --- | --- |
| I-1 | High | 1, 3 | Google Ads has no read-only OAuth scope |
| I-2 | High | 1 | The code treats the developer token as optional |
| I-3 | High | 1 | Testing-mode refresh tokens expire after 7 days, which breaks the weekly cycle |
| I-4 | High | 7 | The current AI provider is OpenAI, not Claude |
| I-5 | Decision | 7 | What "MCP takes a Claude API key" means |
| I-6 | Decision | 8 | The weekly cadence conflicts with the existing trial and monthly quotas |
| I-7 | Medium | 9 | Before/after results are correlational and affected by conversion lag |
| I-8 | Decision | 10 | "Journey" means two different things in the product |
| I-9 | Medium | 4, 9 | Storing Ads baselines conflicts with the documented storage policy |
| I-10 | Low | 2 | The Google callback page tells standalone users to return to HighLevel |
| I-11 | Low | 2 | Account discovery shows IDs only and needs a manual manager ID |
| I-12 | Medium | 4 | `click_view` limits for linking gclids |
| I-13 | Low | 1 | Google Ads API version upkeep |
| I-14 | Low | 6 | Scope of GHL reads and the Marketplace review |
| I-15 | Medium | 10 | Rings view payload size with all traffic visible |
| I-16 | Low | all | Pull request workflow |

---

### I-1 Google Ads has no read-only OAuth scope (High)

Google Ads API access uses one scope, `https://www.googleapis.com/auth/adwords`, which allows both reading and writing. "Read-only" therefore has to be enforced by Xaylo, not by Google.

**Resolution:** Step 3 adds an endpoint allowlist (`googleAds:search` and `listAccessibleCustomers` only) and a test that fails if a mutate path appears. GAQL stays in fixed server-side templates and is never exposed to MCP. Recommend in the UI that users connect with a Google user that has the **Read-only** role on the Ads account. Say plainly in the consent copy and the privacy policy that Xaylo never changes Ads data.

### I-2 The code treats the developer token as optional (High)

`src/google/client.ts:80` sends `developer-token` only when the token is set, and `docs/reporting.md` calls it optional. Google Ads API requests need a developer token, so production calls without one will fail. A new token is limited to test accounts until Basic access is approved, and Basic access requires a review, a design document and a reachable website.

**Resolution:** Step 1 makes the token required whenever Google is enabled, and lists the token's access level in the readiness check. Apply for Basic access in week 1. Check whether a lower production tier (such as Explorer access) is currently offered and whether its daily limit covers the pilot. Budget about 30 operations per weekly report per workspace (up to 7 `click_view` days, campaign and conversion-action queries, and discovery).

### I-3 Testing-mode refresh tokens expire after 7 days (High)

While the OAuth consent screen is in **Testing**, Google issues refresh tokens that expire after 7 days, and only listed test users (100 at most) can connect. Each weekly report would then find the connection expired. Moving to **In production** with a sensitive scope requires brand and sensitive-scope verification: a verified domain, privacy policy, demo video and scope justification.

**Resolution:** submit for verification as soon as the Step 2 connection UI can be recorded. Until then, show "Reconnect Google Ads" in the UI when a refresh fails with `invalid_grant`. This error should clear the connection and not show as a generic failure. Confirm during submission that no CASA assessment is required; `adwords` is expected to be a sensitive scope, not a restricted one.

### I-4 The current AI provider is OpenAI, not Claude (High)

`src/reporting/ai.ts` calls the OpenAI Responses API with `OPENAI_API_KEY`. The MVP requires a Claude API key.

**Resolution:** Step 7 switches to the official `@anthropic-ai/sdk` with structured outputs and adds a workspace key option. Environment variables, the README, `docs/reporting.md`, the privacy policy (list Anthropic as the sub-processor) and the public guide all need updating. Existing saved reports keep their `model` provenance. Remove the OpenAI code instead of keeping two providers, unless the product owner wants both.

### I-5 Decision: what "MCP takes a Claude API key" means

This requirement can be read three ways:

1. **Workspace key (recommended):** the workspace owner enters their Claude API key once in Connections. Xaylo stores it encrypted and uses it for every report, whether the report is requested from the dashboard or from MCP `generate_marketing_report`.
2. **Key as an MCP tool argument:** an assistant sends the key in a tool call. This is **not recommended**, because the key would then sit in the assistant's transcript and logs.
3. **Claude as the MCP client:** Claude (claude.ai or Claude Desktop) connects to Xaylo's MCP server as a custom connector. This already works through the existing OAuth flow and needs no API key at all.

The plan implements option 1 and supports option 3 as it is today. Confirm that this matches the intent.

### I-6 Decision: the weekly cadence conflicts with existing quotas

Current tier rules: the free tier gets a 7-day trial with 1 report; the paid tier gets `PAID_REPORTS_PER_MONTH=30`. The MVP rule is one report every 7 days.

**Proposal:** the 7-day gate applies to every tier and replaces the monthly count, so a paid tier gives 4–5 reports a month. The free trial still gets one report, and its "result of last change" card is shown as an upgrade prompt. Decide whether `PAID_REPORTS_PER_MONTH` is removed or kept as an upper limit, and update the Stripe product copy to match. Also decide whether ad-hoc source analysis (`/api/analysis` and the MCP read tools) remains unlimited. The proposal is yes, because those tools do not call the AI.

### I-7 Before/after results are correlational and affected by conversion lag (Medium)

A 7-day before/after comparison cannot prove the action caused the change. Google Ads also credits conversions to the click date, and conversions can arrive days later, so the "after" window will be undercounted when it is first measured. Seasonality, budget changes and low volume can hide or invent effects.

**Resolution:** label results as "observed change", not "impact". Show sample-size warnings (under 30 sessions or under 5 conversions) and a lag note for Ads metrics. Offer to re-measure 7 days later. Prefer first-party website metrics for the watched metric when they fit the action.

### I-8 Decision: "journey" means two different things in the product

The product uses **configured journeys** (personalisation rules stored in the `journeys` table and recorded on each event as `journey_id`). The current Overview's "journeys" list shows **observed session paths**. The requirement says "when a single journey is selected, switch to the current topology view".

**Proposal (Step 10):** the selector beside the rings lists configured journeys plus "All traffic". Selecting one shows the topology view filtered to that journey's sessions. Inside the topology view, the existing path list still works for highlighting individual paths. Confirm before starting Step 10.

### I-9 Storing Ads baselines conflicts with the documented storage policy (Medium)

`docs/reporting.md` says "Ads datasets and upstream API payloads are not mirrored". Step 9 stores the action's baseline and result, and Step 4 links gclids to campaigns.

**Resolution:** store only the single aggregate metric and its supporting counts for each action (the evidence snapshots already contain comparable aggregates). Hold gclid-to-campaign matches only in memory, for the duration of a request. Update the storage section of the docs and the privacy policy to say this.

### I-10 The Google callback page tells standalone users to return to HighLevel (Low)

`src/google/routes.ts:186` reads "Return to Xaylo in HighLevel, refresh Settings…", which is wrong for email-account workspaces and refers to a screen that is now called Connections. Fixed in Step 2.

### I-11 Account discovery shows IDs only and needs a manual manager ID (Low)

`listAccessibleCustomers` returns resource names, which the UI shows as account names. Users of a manager account have to type its ID. Fixed in Step 2 by looking up each account's details and expanding managers automatically. Discovery is capped at 25 accessible accounts; agencies with more accounts use the manual entry under **Advanced**.

### I-12 `click_view` limits for linking gclids (Medium)

`click_view` must be filtered to a single day, covers only recent clicks (about the last 90 days), and returns one row per click. High-volume accounts may hit `REPORT_SOURCE_MAX_PAGES`. Clicks from Safari and iOS often carry `gbraid`/`wbraid` instead of `gclid`, and these cannot be matched to a campaign this way.

**Resolution:** query only the days in the 7-day period and only when some sessions have a gclid. Mark truncated days as partial. Report `gbraid`/`wbraid` sessions as "Google paid, campaign unknown". Encourage `xaylo_campaign_id={campaignid}` in the final URL suffix, because that is the most reliable method.

### I-13 Google Ads API version upkeep (Low)

The code defaults to `GOOGLE_ADS_API_VERSION=v26`. Google retires old versions about every year. Check that v26 is still supported before release, and add a reminder to the release checklist to check the version every quarter.

### I-14 Scope of GHL reads and the Marketplace review (Low)

The new GHL reads (business profile, contact aggregates and opportunities) use scopes that are already requested, so no renewed consent is needed. If an MCP tool later needs pipelines or calendars, adding `opportunities.readonly`-style scopes would trigger renewed consent and possibly a new Marketplace review. Keep the MVP within the current scopes.

### I-15 Rings view payload size with all traffic visible (Medium)

"All traffic visible" across 90 days could mean thousands of sessions sent to the browser and drawn as SVG.

**Resolution:** aggregate on the server (pages × ring × source group, plus flows between rings), cap the number of nodes per ring (for example, 12, with an "Other pages" node), and fetch the detailed paths only after a journey is selected.

### I-16 Pull request workflow (Low)

All MVP work goes through pull requests into `main`; nothing is committed directly to `main`. **Recommendation:** enable branch protection on `main` in GitHub (require a pull request and require the `npm run check` status check). This repository has no CI workflow yet, so add a small GitHub Actions workflow that runs `npm run check` on pull requests.
