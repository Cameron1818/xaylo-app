# MVP plan: read-only Google Ads reporting, journey-aware MCP and weekly single-action reports

This plan builds on the existing implementation described in [docs/reporting.md](reporting.md): the self-hosted deployment, email/GHL workspaces, the Google Ads OAuth client, the MCP endpoint with OAuth grants, and saved reports. Each step is small enough for one pull request. All work lands through pull requests into the protected `main` branch.

Open questions and risks are in [docs/mvp-issues.md](mvp-issues.md); issue numbers below (for example, **I-3**) refer to that file. Pricing and the trial are in [docs/pricing.md](pricing.md).

## Terms

| Term | Meaning |
| --- | --- |
| **Xaylo Journey** | A configured personalisation journey: rules, content and tags (the `journeys` table, recorded on events as `journey_id`). |
| **Route** | An observed sequence of pages in one visitor session, from landing page to conversion or exit. The current dashboard calls these "journeys"; MVP renames them **routes**. |
| **Rings view** | The new primary Overview: the whole site's traffic on concentric rings. |
| **Route map** | The existing topology (two-way roads) view, opened when one route is selected. |

## MVP scope

| Area | MVP behaviour |
| --- | --- |
| Hosting | Self-hosted, as today. |
| Overview | The rings view (concentric rings, no dartboard segments) of all traffic. Selecting one route opens the route map. A Xaylo Journey filter applies to both views. |
| Google Ads | **Read operations only**, enforced by Xaylo. The advertiser's only setup is one click on **Connect Google Ads** and approving Google's consent screen. If Google requires them to approve again, reports pause until they reconnect. |
| GHL | Read-only reporting with the existing scopes. Tag writes remain limited to the existing journey conversion feature. |
| MCP | Understands Xaylo Journeys, routes, UTM sources and how Google Ads traffic links to them, with a focus on conversions and clicks. Read-only tools for Ads and GHL. |
| AI | The workspace chooses a provider: **Xaylo AI** (included, using Xaylo's own key and a low-cost model), **OpenAI (your key)** or **Claude (your key)**. Each report reads the whole cleaned data pool and returns **one action**. |
| Cadence | At most one report every 7 days. Each new report opens with the measured result of the previous action. |

## Step overview

| # | Step | Depends on | Size |
| --- | --- | --- | --- |
| 1 | Google Cloud access approvals and configuration checks | none | S |
| 2 | One-click Google Ads connection and the re-approval pause | 1 | M |
| 3 | Conversion- and click-focused Ads read model, with a read-only guard | 2 | S |
| 4 | Linking Ads traffic to sessions, routes and Xaylo Journeys | 3 | M |
| 5 | Cleaned data pool | 4 | M |
| 6 | MCP tools for journeys, routes, sources, Ads and GHL | 5 | S |
| 7 | AI provider choice: Xaylo AI, OpenAI or Claude | none (can run alongside 1–6) | M |
| 8 | Weekly single-action report, trial and plan rules | 5, 7 | M |
| 9 | Results of the last change | 8 | S–M |
| 10 | Rings view and the route map | none (can run alongside 1–9) | M |

Start Step 1 first, because Google's reviews take days to weeks.

---

## Step 1: Google Cloud access approvals and configuration checks

**Goal:** Get Xaylo's Google Cloud project approved for Google Ads API access. All of this is done **once, by Xaylo**; advertisers never see or handle any of it.

### How access works now

Google retired the Google Ads **developer token** on 9 September 2026, according to Google's developer-token page as quoted in search results and several 2026 guides. API access levels now belong to the **Google Cloud project**, which requests identify through the `x-goog-user-project` header. The existing client already sends that header (`src/google/client.ts:81`). A developer token that is still sent is ignored, and Google says a future API version will reject it. See **I-2**: the official page could not be fetched from this session, so check it before Step 1 is merged.

| Access level | Daily operations | Accounts | How to get it |
| --- | --- | --- | --- |
| Test | 15,000 | Test accounts only | Default |
| **Explorer** | **2,880** | Production | Request from the Google Ads API overview page in the Cloud Console; usually approved automatically. **Use this for the pilot.** |
| **Basic** | **15,000** | Production | Apply in the Cloud Console; needs **brand verification** on the project. Apply for this before general launch. |
| Standard | Unlimited | Production | Apply only after Basic; needed only at scale. |

A weekly report uses about 30 operations per workspace, and the dashboard and MCP reads add some more. Explorer comfortably covers a pilot of roughly 50–100 active workspaces; Basic covers launch.

### Console checklist (operator task, written up in `docs/google-ads-setup.md`)

| # | Where | Action | Approval |
| --- | --- | --- | --- |
| 1 | Cloud Console → APIs & Services → Library | Enable **Google Ads API** on the production project. Set `GOOGLE_CLOUD_PROJECT`. | — |
| 2 | Cloud Console → Google Ads API → Overview | Request **Explorer** access. | Usually automatic |
| 3 | Google Search Console | Verify the production domain and the domain hosting the privacy policy. | Domain verification |
| 4 | Google Auth Platform → Branding | User type External; app name, logo, support email, homepage, privacy policy and terms URLs; authorised domain. | **Brand verification** (about 2–3 business days) |
| 5 | Google Auth Platform → Data Access | Add only `https://www.googleapis.com/auth/adwords`. | **Sensitive-scope verification**: scope justification and a demo video (**I-3**) |
| 6 | Google Auth Platform → Clients | Create a Web client with redirect URI `https://YOUR_HOST/oauth/google/callback`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. | — |
| 7 | Google Auth Platform → Audience | Keep the app in Testing for internal QA only, then publish **In production** after verification. While in Testing, refresh tokens expire after 7 days. | Publishing |
| 8 | Cloud Console → Google Ads API → Overview | Once brand verification passes, apply for **Basic** access. Describe Xaylo as a read-only reporting tool for advertisers' own accounts. | Review |

**Scope justification text:** "Xaylo reads campaign, conversion-action and click performance for the Google Ads accounts the user selects, and shows it beside their website routes. Xaylo performs read operations only and makes no changes to Google Ads." The demo video shows the consent screen, choosing an account, the data on screen, and disconnecting.

### Code (small PR)

- Stop sending `developer-token` and remove `GOOGLE_ADS_DEVELOPER_TOKEN` from the examples. While it still exists, log a one-time deprecation warning if it is set.
- Make `GOOGLE_CLOUD_PROJECT` **required** when Google is enabled.
- Add `readiness: { clientConfigured, projectConfigured, apiVersion }` to `GET /api/google`, so the Connections panel can explain what is missing.

**Done when:** `npm run check` passes, and the readiness check flags a missing project ID.

---

## Step 2: One-click Google Ads connection and the re-approval pause

**Goal:** The advertiser clicks **Connect Google Ads**, approves Google's screen, and is done. If Google later needs fresh approval, Xaylo pauses reports and offers the same single click to reconnect.

### Connect

- The button opens Google consent in a **popup**. The callback page calls `postMessage({ type: 'xaylo:google-connected' })` to tell the dashboard and closes itself. Its wording is fixed: it no longer mentions HighLevel (**I-10**). If the popup is blocked, a normal link is shown.
- When the popup closes, the dashboard runs discovery automatically. It calls `listAccessibleCustomers`, looks up each account's name, currency, timezone and manager flag (at most 25 accounts), and expands manager accounts one level through `customer_client`.
- **One advertising account found:** it is linked automatically. The panel shows "Linked: Acme Ltd · GBP" with a **Change** option.
- **More than one:** a single list of named accounts, each with **Use this account**.
- Manual account and manager ID entry moves under **Advanced**.

### Connection health and the re-approval pause

- Add `status` (`connected` | `needs_reauth`), `status_reason` and `status_changed_at` to `google_connections` (migration `006_google_status.sql`).
- If a token refresh or an Ads call returns `invalid_grant`, or a 401/403 error showing revoked access or a lost account permission, set `needs_reauth`. Keep the selected account references, so reconnecting does not require choosing the account again when the same Google user approves.
- While the status is `needs_reauth`:
  - The dashboard shows a banner, **Google Ads needs re-approval · Reconnect**, which is the same one-click popup.
  - **Report generation is paused** (enforced in Step 8). The 7-day timer does not count against the user: once they reconnect, the next report is available straight away if 7 days have passed.
  - MCP Ads tools return "Google Ads needs re-approval in Xaylo → Connections".
  - Measuring an action's result (Step 9) is paused for Ads-based metrics.
- When reconnecting succeeds, the status returns to `connected`. If the new Google user cannot reach the previously selected account, the account picker is shown.

**Files:** `src/google/client.ts`, `src/google/routes.ts`, `web/src/Connections.vue`, a banner in `web/src/App.vue`.
**Tests:** discovery mock (2 direct accounts plus a manager with 2 children gives 4 named advertising accounts); `invalid_grant` sets `needs_reauth`; reconnecting keeps the account selection.
**Done when:** a pilot user connects with one click and one approval, and revoking access in their Google account settings shows the banner and pauses reports.

---

## Step 3: Conversion- and click-focused Ads read model, with a read-only guard

**Goal:** Read conversions and clicks per campaign and per conversion action, and make Ads write calls impossible.

- Add a `conversionAction` level to `googleReport`: `campaign.id, campaign.name, segments.conversion_action, segments.conversion_action_name, segments.conversion_action_category, metrics.conversions, metrics.conversions_value, metrics.all_conversions FROM campaign`.
- Add `metrics.interactions` and `metrics.all_conversions` to the campaign level, and `conversionRate` to `adsMetrics`.
- Add `listConversionActions` (`conversion_action.id, name, category, status, primary_for_goal`) so reports can tell primary goals apart from secondary actions.
- **Read-only guard (I-1):** Ads requests may go only to `…/googleAds:search` and `customers:listAccessibleCustomers`. This is enforced in `src/google/client.ts`, with a test that fails if `:mutate`, `/operations` or any other Ads path appears under `src/google/**`. GAQL stays in fixed server-side templates.

**Done when:** a mocked response gives conversions for each action, and the guard test passes.

---

## Step 4: Linking Ads traffic to sessions, routes and Xaylo Journeys

**Goal:** Link each Google-sourced session to a campaign, so Ads conversions and clicks can be compared with routes and Xaylo Journeys.

Each session is matched using the first method that applies, and each link is labelled with how it was made:

1. `xaylo_campaign_id` on the landing URL. Method: `explicit`.
2. `gclid` → campaign through a read-only `click_view` query, one query per day in the period (at most 7). Matches are held in memory only (**I-9**, **I-12**). Method: `gclid`.
3. The UTM campaign mapping configured under Connections. Method: `utm_mapping`.
4. `utm_source=google` with a paid medium but no campaign. Method: `source_only`.

New module `src/traffic/adsAssociation.ts`. Its output, per campaign: `{ campaignId, sessions, conversions, xayloJourneys: {id: {sessions, conversions}}, topRoutes[≤5], methods }`, plus coverage (the share of Google sessions linked to a campaign). It replaces the existing `mappingCoverage`.

**Tests:** fixtures for each of the four methods; priority order; no session counted twice.
**Done when:** the overview shows "X% of Google sessions linked to a campaign (gclid Y%, explicit Z%)".

---

## Step 5: Cleaned data pool

**Goal:** One deterministic, bounded dataset used by the dashboard, the MCP tools and every AI provider.

`src/reporting/dataPool.ts` → `buildDataPool(locationId, period)` returns:

- `site`: sessions, conversions, conversion rate, top landing pages.
- `xayloJourneys`: for each configured journey: sessions, conversions, conversion rate, top sources, linked campaigns. Sessions with no journey are grouped as "No journey".
- `routes`: the top 25 routes, each with its steps, sessions, conversion flag and loops.
- `sources`: per UTM source/medium/campaign: sessions, conversions, and whether the row is Google paid traffic.
- `ads`: totals, the top 25 campaigns, the conversion-action breakdown, linking coverage, and the connection status.
- `crm`: the existing GHL aggregates.
- `quality`: small samples, partial sources, currency and timezone notes, coverage.

Cleaning rules: strip query strings from page URLs; lower-case and trim UTM values; merge empty, `none` and `(direct)` sources into `direct`; cap every list at 25 rows; never include contact identities. Evidence IDs are stable, for example `journey.<slug>`, `route.<n>`, `source.<n>`, `ads.campaign.<n>`, `ads.action.<n>`, `crm.summary`.

**Done when:** `GET /api/analysis` returns the data pool, and a snapshot test pins its shape.

---

## Step 6: MCP tools for journeys, routes, sources, Ads and GHL

Every tool here is read-only (`readOnlyHint: true`) and needs the `reports:read` scope.

| Tool | Returns |
| --- | --- |
| `get_xaylo_journeys` | Configured journeys: name, slug, status, priority, matching rules, content summary. |
| `get_journey_performance` | `days`, optional `journeySlug` → sessions, conversions, sources and linked campaigns for each journey. |
| `get_routes` | `days` → the top routes, with conversion and exit points. |
| `get_traffic_sources` | `days` → the UTM table, with Google paid traffic flagged. |
| `get_google_ads_conversions` | `customerId`, `days` → conversions by campaign × conversion action. |
| `get_ads_traffic_association` | `customerId`, `days` → the Step 4 output. |
| `get_data_pool` | `days`, optional `customerId` → the full Step 5 dataset. |
| `get_current_action` | The current action, its status, and its result once measured. |
| `get_ai_status` | The chosen provider, model, whether it is ready, and the next report date. |

The existing tools stay; `get_crm_summary` remains the GHL read tool. Update the server's MCP `instructions` text with the suggested order: `get_connected_accounts` → `get_data_pool` → drill down. Update `docs/reporting.md`.

**Done when:** the MCP inspector lists every tool, each returns valid JSON on the preview seed, and an Ads account the workspace has not selected is rejected.

---

## Step 7: AI provider choice: Xaylo AI, OpenAI or Claude

**Goal:** The workspace chooses who runs its weekly report. Xaylo AI is the default and needs no setup.

| Option (UI label) | Key | Model | Notes |
| --- | --- | --- | --- |
| **Xaylo AI** (default, included) | Xaylo's server key (`XAYLO_AI_API_KEY`) | A low-cost model: `claude-haiku-5-5` ($0.10 / $0.50 per million input/output tokens) | About $0.01 per report at the expected size of 20–30k input tokens. Can be switched to `claude-sonnet-5-5` for paid plans if testing shows better quality. |
| **OpenAI (your key)** | The workspace's own OpenAI key | Chosen from an allowlist; defaults to the current `AI_MODEL` | Reuses the existing Responses API code in `src/reporting/ai.ts`. |
| **Claude (your key)** | The workspace's own Anthropic key | Chosen from an allowlist (`claude-opus-5-5` by default, `claude-sonnet-5-5`, `claude-haiku-5-5`) | Official `@anthropic-ai/sdk`, with structured outputs through `output_config.format` and a server-side refusal fallback. |

See **I-4** for why the labels name the provider rather than products such as "ChatGPT" or a specific model name.

- **Provider interface** `src/reporting/providers/{index,xaylo,openai,anthropic}.ts`, each with `generate(input, schema) → analysis`. The shared Zod validation and evidence-ID check run after every provider. The output schema is the same for all of them.
- **Keys:** migration `007_ai_settings.sql` adds `ai_settings(location_id PK, provider, model, api_key_enc, last4, validated_at)`.
  - `PUT /api/ai/settings` validates a workspace's own key with a cheap model-list call, then stores it encrypted. `GET /api/ai/settings` never returns the key.
  - Keys are entered only in the dashboard and **never through MCP**. The MCP tool `get_ai_status` returns only the provider and its status.
- **UI:** an "AI provider" panel in Connections with three cards. Selecting OpenAI or Claude shows a password-type key field and a **Test & save** button.
- **Failure handling:** if a workspace key fails (invalid key, out of credit or rate limited), the report is not consumed, and the user sees "Your OpenAI key was rejected — update it or switch to Xaylo AI".
- The weekly cadence and plan rules apply whichever provider is chosen. Report provenance records the provider and model.

**Tests:** each provider is mocked and checked against the same schema; invalid evidence is rejected; a saved key is never returned; a failed key releases the report reservation.
**Done when:** the preview workspace generates a valid report with each of the three providers.

---

## Step 8: Weekly single-action report, trial and plan rules

**Goal:** One report with one action, at most every 7 days, using the plan rules in [docs/pricing.md](pricing.md).

- **Schema (prompt version bumped):**
  ```
  { summary, previousActionReview | null,
    action: { title, why, steps[≤5], effort: 'low'|'medium',
              metric: { name, evidenceId, baseline, direction }, evidenceIds[≥1] },
    dataQuality[] }
  ```
  Prompt rules: pick the single change with the best ratio of evidence to effort; prefer low-risk changes (landing-page message, Xaylo Journey rules, negative keywords, conversion-tracking fixes) over spend increases; choose a metric that can be re-measured within 7 days; when the evidence is weak, the action is to fix measurement.
- **Cadence:** migration `008_report_cycles.sql` adds `report_cycles(id, location_id, report_id, created_at, next_available_at, action, action_status, action_done_at, baseline, result, paused_reason)`. `reserveReport` checks, in order:
  1. A plan or trial that allows reports.
  2. `now() ≥ next_available_at`; otherwise a 429 "Next report available on <date>".
  3. **Paused** if a linked Google Ads connection is `needs_reauth`: a 409 "Reconnect Google Ads to resume reports". The pause does not push back the next report date.
  4. The AI provider is ready.
- The reporting period is fixed at the last 7 days. `get_reporting_allowance` returns `nextReportAt` and `pausedReason`.
- **Plan rules** (replacing `PAID_REPORTS_PER_MONTH` and the one-report trial; see **I-6**): a 14-day trial gives two weekly reports, so the user sees the first action's result. Paid plans get one report every 7 days.
- **Reports page:** a card for the current action with **Mark as done** and **Skip**, a countdown to the next report, any pause banner, and the history collapsed.

**Done when:** a second request within 7 days is refused; a `needs_reauth` connection pauses generation; the report contains exactly one action, whose metric's evidence ID exists in the data pool.

---

## Step 9: Results of the last change

- When the report is generated, store the action's baseline: the metric value and its supporting counts from the 7 days before the report.
- **Mark as done** sets `action_done_at`, and the comparison window runs for 7 days from then. If the action is never marked done, the window starts at the report date and the result is labelled "not confirmed".
- `computeActionResult(cycle)` re-runs `buildDataPool` for the comparison window and returns `{ before, after, change, changePct, directionMet, sampleWarning, caveats }`. It waits while Google Ads needs re-approval.
- The Reports page shows a **Result of your last change** card above the generate button, or "Measuring… results on <date>" until the window ends.
- The next report's input includes `previousAction` and `previousResult`, and the AI fills in `previousActionReview` first.
- These saved results are the start of the ROI history that later paid tiers build on (see [docs/pricing.md](pricing.md)).

**Tests:** a conversion rate going from 2% to 3% gives `+1pt` with the direction met; under 30 sessions sets `sampleWarning`; an Ads metric is paused while the connection is `needs_reauth`.
**Done when:** the full cycle (report → done → result → next report) works end to end with a mocked clock.

---

## Step 10: Rings view and the route map

**Goal:** The rings view is the primary Overview of all site traffic. Selecting a single route switches to the route map (the current topology view).

- **Rename** "journeys" to **routes** in `PathList.vue`, `TrafficView.vue`, the captions and the tooltips. "Journey" now means only Xaylo Journeys.
- **`web/src/components/RingsBoard.vue`** reuses the geometry in `Dartboard.vue` (`center`, `ringRadius`, the bullseye, the glow filters) without `decoWedges` or `decoBand`:
  - Each ring is a step depth from entry: ring 1 holds landing pages, and the bullseye is conversion. Nodes are sized by sessions and coloured by their main source group (Google paid / organic / direct / referral / other), with a legend.
  - All traffic is shown as thin aggregate flows between rings. There are no two-way roads in this view.
  - Hovering a node shows its sessions, conversions and source mix, and highlights the routes through it.
- **`web/src/OverviewView.vue`:**
  - `mode: 'rings' | 'route'`, `selectedRoute`, `journeyFilter`.
  - The rings view sits beside a list of the top **routes**. Choosing a route switches to `TrafficView` (the route map) with that route selected and highlighted. **← All traffic** returns to the rings view.
  - A **Xaylo Journey** filter (All, plus each journey) applies to both views.
  - Shared header statistics and a cross-fade, so the switch feels like zooming in.
- **Data:** `GET /api/traffic?days=…&journey=<id>` filters by `journey_id`. A new server-side `ringsDataset` sends aggregates, not raw sessions (**I-15**).
- `App.vue` renders `OverviewView`.

**Tests:** in the rings model, landing pages are on ring 1 and there is no segment data; the journey filter returns only that journey's sessions; selecting a route switches the mode.
**Done when:** the preview opens on the rings view, choosing a route opens the route map, the journey filter works in both views, and **All traffic** returns to the rings view.

---

## Release checklist

- `npm run check` and the database integration tests pass.
- Google: the consent screen is verified and In production; the Cloud project has **Basic** access; every Ads level has been read on a live account; revoking access shows the re-approval pause.
- All three AI providers produce valid reports on staging.
- The weekly gate, the pause and the before/after result have been checked with a shifted clock.
- The docs, the public guide and the pricing page are updated.
