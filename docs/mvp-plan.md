# MVP plan: read-only Google Ads reporting, journey-aware MCP and weekly single-action reports

This plan builds on the existing implementation described in [docs/reporting.md](reporting.md): the self-hosted deployment, email/GHL workspaces, the Google Ads OAuth client, the MCP endpoint with OAuth grants, and saved reports. Each step is small enough for one pull request. Every step lands through a pull request into `main`; nothing is committed directly to `main`.

Open questions and risks are listed separately in [docs/mvp-issues.md](mvp-issues.md). Issue numbers below (for example, **I-3**) refer to that file.

## MVP scope

| Area | MVP behaviour |
| --- | --- |
| Hosting | Self-hosted, as today. No change. |
| Overview | A global **rings** view (concentric rings, no dartboard segments) showing all site traffic. Selecting one journey switches to the existing **topology** (roads) view for that journey. |
| Google Ads | Read-only. Connect once, pick an account from a named list, then read campaigns, conversion actions and clicks. There are no mutate calls. |
| GHL | Read-only reporting, using the existing scopes. Tag writes stay limited to the existing journey conversion feature. |
| MCP | Understands journeys, UTM sources, and how Google Ads traffic links to them, with a focus on conversions and clicks. Read-only tools for Ads and GHL. |
| AI | Uses a Claude API key. Reads the whole cleaned data pool and returns **one action**. |
| Cadence | At most one report per workspace every 7 days. Each new report opens with the measured result of the previous action. |

## Step overview

| # | Step | Depends on | Size |
| --- | --- | --- | --- |
| 1 | Google Cloud approvals and Ads configuration checks | none | S |
| 2 | One-click Google Ads connection | 1 | S–M |
| 3 | Conversion- and click-focused Ads read model, with a read-only guard | 2 | S |
| 4 | Linking Ads traffic to sessions and journeys | 3 | M |
| 5 | Cleaned, journey-aware data pool | 4 | M |
| 6 | MCP tools for journeys, sources, Ads and GHL | 5 | S |
| 7 | Claude API key and provider switch | none (can run alongside 1–6) | S–M |
| 8 | Weekly single-action report | 5, 7 | M |
| 9 | Results of the last change | 8 | S–M |
| 10 | Rings view and switching to the journey topology view | none (can run alongside 1–9) | M |

Start Step 1 first: Google's approvals take days to weeks, and the other work can go ahead while they are pending. Steps 7 and 10 do not depend on the Ads work.

---

## Step 1: Google Cloud approvals and Ads configuration checks

**Goal:** Start the Google approval process now, and make the app say exactly which Google setting is missing instead of failing in the middle of a request.

### 1a. Approvals and console setup (operator task, documented in `docs/google-ads-setup.md`)

| # | Where | Action | Approval? | Typical wait |
| --- | --- | --- | --- | --- |
| 1 | Google Cloud Console → **APIs & Services → Library** | Create or choose the production project. Enable **Google Ads API**. | No | Immediate |
| 2 | Google Search Console | Verify ownership of the production domain (the `PUBLIC_BASE_URL` host and the domain hosting the privacy policy). | Domain verification | Minutes |
| 3 | Google Cloud Console → **Google Auth Platform → Branding** (OAuth consent screen) | User type **External**. App name "Xaylo", support email, logo, homepage `https://YOUR_HOST/`, privacy policy URL, terms URL, authorised domain = verified domain. | **Brand verification** | 2–3 business days |
| 4 | **Google Auth Platform → Data Access** | Add exactly one scope: `https://www.googleapis.com/auth/adwords`. Do not add `openid`, `email` or Drive scopes. | **Sensitive-scope verification** (see 1b) | Several days to a few weeks |
| 5 | **Google Auth Platform → Clients** | Create a **Web application** OAuth client. Authorised redirect URI: `https://YOUR_HOST/oauth/google/callback`. Copy the ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. | No | Immediate |
| 6 | **Google Auth Platform → Audience** | While verification is pending, keep the app in **Testing** and add pilot users (100 at most). Move to **In production** once verification passes; Testing refresh tokens expire after 7 days (**I-3**). | Publishing | Immediate after verification |
| 7 | Google Ads **manager account** (MCC) → **Admin → API Center** | Apply for a **developer token**. Use: "Third-party reporting tool, read-only, for advertisers' own accounts". Attach the design document (1c). Copy the token into `GOOGLE_ADS_DEVELOPER_TOKEN`. | **Developer token review** | A new token starts at Test level; Basic access review usually takes days to a few weeks |
| 8 | Google Cloud Console → **IAM & Admin → Quotas** | Note the Ads API quota and the operations-per-day limit for the token's access level. | No | — |

### 1b. What the sensitive-scope verification asks for

- Why the app needs `adwords`: "Read campaign, conversion-action and click performance for accounts the user selects, and show it beside their website journeys. Xaylo makes no changes to Google Ads." Google Ads has no read-only OAuth scope, so the read-only limit is enforced by the app (Step 3, **I-1**).
- A demo video (unlisted YouTube link) showing: the consent screen with the app name and scope, the account-selection screen, the data being displayed, and disconnecting.
- A privacy policy that states what Google user data is read and stored, how to revoke access, and compliance with the Google API Services User Data Policy, including Limited Use.
- No CASA security assessment is expected, because `adwords` is a sensitive scope rather than a restricted one. Confirm this during submission (**I-3**).

### 1c. Developer token design document (short PDF)

This covers: company and product summary; that the tool is reporting-only with no create or mutate features; the list of services and resources read (`GoogleAdsService.Search` over `customer`, `customer_client`, `campaign`, `ad_group`, `keyword_view`, `search_term_view`, `conversion_action`, `click_view`, plus `CustomerService.ListAccessibleCustomers`); estimated daily operations per workspace; screenshots of the Connections and Reports screens.

### 1d. Code (small PR)

- Treat `GOOGLE_ADS_DEVELOPER_TOKEN` as **required** whenever Google is enabled. Today the code treats it as optional (`src/google/client.ts:80`, **I-2**).
- Add a `readiness` object to `GET /api/google`: `{ clientConfigured, developerTokenConfigured, projectConfigured, apiVersion }`. The Connections panel then lists the missing items in plain language.
- Update `.env.example` and `.env.vm.example`, and link `docs/google-ads-setup.md` from the README.

**Done when:** `npm run check` passes. With only the client ID set, the Connections panel shows "Developer token missing". The setup document lists every approval above.

---

## Step 2: One-click Google Ads connection

**Goal:** Connecting Google Ads should take one click and one choice: **Connect → Google consent → choose a named account → done.**

- `POST /api/google/connect` opens Google in a **popup** instead of showing a "Continue to Google" link. The callback page (`src/google/routes.ts:186`) uses `postMessage({ type: 'xaylo:google-connected' })` to tell the opener, then closes itself. Its copy no longer says "Return to Xaylo in HighLevel" (**I-10**). If the popup is blocked, a normal link is shown instead.
- After the consent callback, the dashboard calls account discovery automatically:
  - `listAccessibleCustomers` returns only IDs, so run `SELECT customer.id, customer.descriptive_name, customer.manager, customer.currency_code, customer.time_zone FROM customer LIMIT 1` for each ID (capped at 25 and run in parallel). The user then sees names, not resource paths.
  - Manager accounts expand automatically one level through `customer_client`, setting `login_customer_id`.
- The UI shows a single list of advertising accounts: name, ID and currency, each with a **Use this account** button. If exactly one advertising account is found, it is pre-selected and needs one confirmation.
- Manual entry of an account ID and manager ID moves under an **Advanced** disclosure.
- The UI tip shown before connecting is: "Sign in with a Google user that has at least Read-only access to the Ads account."

**Files:** `src/google/client.ts` (`discoverAccounts`), `src/google/routes.ts`, `web/src/Connections.vue`.
**Tests:** a mocked discovery that returns 2 direct accounts and 1 manager with 2 children produces 4 named advertising accounts and no managers. The callback HTML contains no HighLevel wording.
**Done when:** a pilot user connects and selects an account without typing an ID.

---

## Step 3: Conversion- and click-focused Ads read model, with a read-only guard

**Goal:** Read conversions and clicks per campaign and per conversion action. Make it structurally impossible to call Ads write endpoints.

- Add a `conversionAction` level to `googleReport` (`src/google/reporting.ts`):
  `SELECT campaign.id, campaign.name, segments.conversion_action, segments.conversion_action_name, segments.conversion_action_category, metrics.conversions, metrics.conversions_value, metrics.all_conversions FROM campaign WHERE segments.date BETWEEN … ORDER BY metrics.conversions DESC`.
- Add `metrics.interactions` and `metrics.all_conversions` to the campaign level, and add `conversionRate = conversions / clicks` to `adsMetrics`.
- Add a `listConversionActions` query (`conversion_action.id, name, category, status, primary_for_goal`) so reports can tell primary goals apart from secondary actions.
- **Read-only guard:** `queryGoogle` and the discovery code may call only `…/googleAds:search` and `customers:listAccessibleCustomers`. Add an allowlist check in `src/google/client.ts`, and a unit test that fails if any other Ads URL path (`:mutate`, `/operations`) appears in `src/google/**`. All GAQL stays as fixed templates inside the server.

**Done when:** the new level returns per-action conversions from a mocked response, and the guard test passes.

---

## Step 4: Linking Ads traffic to sessions and journeys

**Goal:** Link each Google-sourced website session to an Ads campaign so conversions and clicks can be tied to journeys.

Each session is matched using the first method that applies, and each link is labelled with how it was made:

1. `xaylo_campaign_id` on the landing URL (already captured). Method: `explicit`.
2. `gclid` → campaign through a read-only **`click_view`** query (`click_view.gclid, campaign.id, ad_group.id WHERE segments.date = 'YYYY-MM-DD'`). `click_view` accepts one day per query, so run one query per day in the period. MVP periods are at most 7 days, so that is at most 7 queries. Matches are held in memory only (**I-9**, **I-12**). Method: `gclid`.
3. The UTM campaign mapping already configured under Connections. Method: `utm_mapping`.
4. `utm_source=google` with `utm_medium` in (`cpc`, `ppc`, `paid`) but no campaign. Method: `source_only`. This counts as Google paid traffic but has no campaign.

- New module `src/traffic/adsAssociation.ts` (a pure function plus a thin fetcher). Its output, per campaign: `{ campaignId, sessions, conversions, journeys: { [journeyId]: { sessions, conversions } }, methods: { explicit, gclid, utm_mapping } }`, plus coverage (the share of Google sessions linked to a campaign).
- The existing `mappingCoverage` in `src/reporting/service.ts` is replaced by this module's coverage.

**Tests:** fixture events using each of the four methods; check the priority order and that no session is counted twice.
**Done when:** the overview shows "X% of Google sessions linked to a campaign (gclid Y%, explicit Z%)".

---

## Step 5: Cleaned, journey-aware data pool

**Goal:** One deterministic, bounded dataset used by the dashboard, the MCP tools and the AI, so every consumer sees the same numbers.

- New `src/reporting/dataPool.ts` → `buildDataPool(locationId, period)` returns:
  - `site`: sessions, conversions, conversion rate, top landing pages (from `trafficSummary`).
  - `journeys`: for each **configured journey** (`events.journey_id`): name, status, sessions, conversions, conversion rate, top sources, linked Ads campaigns. Sessions with no journey are grouped as "No journey".
  - `sources`: per UTM source/medium/campaign: sessions, conversions, and whether the row is Google paid traffic.
  - `ads`: account totals, the top 25 campaigns, the conversion-action breakdown, and linking coverage (from Steps 3–4).
  - `crm`: the existing GHL aggregate summary (contacts, sources, tags, opportunity cohorts).
  - `quality`: small-sample flags (fewer than 30 sessions), partial or truncated sources, currency and timezone notes, attribution coverage.
- Cleaning rules (stated in code and in the docs): strip query strings from page URLs; lower-case and trim UTM values; merge `(direct)`, empty and `none` sources into `direct`; drop journeys with zero sessions from the evidence but keep them in the totals; cap every list at 25 rows; never include contact identities.
- `evidenceSnapshot` reads from the data pool, giving stable evidence IDs such as `journey.<slug>`, `source.<n>`, `ads.campaign.<n>`, `ads.action.<n>` and `crm.summary`.

**Done when:** `GET /api/analysis` returns the data pool, and a snapshot test pins its shape.

---

## Step 6: MCP tools for journeys, sources, Ads and GHL

**Goal:** An assistant connected over MCP can understand journeys and traffic sources and read Ads and GHL data. Every tool here is read-only.

New tools in `src/mcp/routes.ts`, each with `readOnlyHint: true` and `openWorldHint: false`, and each requiring the `reports:read` scope:

| Tool | Returns |
| --- | --- |
| `get_journeys` | Configured journeys: name, slug, status, priority, matching rules (UTM, path, referrer, tag), content summary. |
| `get_journey_performance` | `days`, optional `journeySlug` → sessions, conversions, sources and linked campaigns for each journey. |
| `get_traffic_sources` | `days` → the UTM source/medium/campaign table, with Google paid traffic flagged. |
| `get_google_ads_conversions` | `customerId`, `days` → conversions by campaign × conversion action, and primary vs secondary actions. |
| `get_ads_traffic_association` | `customerId`, `days` → the Step 4 output and its coverage. |
| `get_data_pool` | `days`, optional `customerId` → the full Step 5 dataset (the same input the AI receives). |
| `get_current_action` | The open action from the latest report, its status and the metric it is tracked against (from Step 9). |

- Keep the existing tools. `get_crm_summary` remains the GHL read tool, and its description is updated to name the GHL sources it reads.
- Update the server `instructions` string so assistants know the order: `get_connected_accounts` → `get_data_pool` → drill down.
- Update the tool list in `docs/reporting.md`.

**Tests:** each tool rejects a `customerId` the workspace has not selected; a grant with only `reports:read` cannot see `generate_marketing_report`.
**Done when:** an MCP inspector session lists all the tools and gets valid JSON from each against the preview seed.

---

## Step 7: Claude API key and provider switch

**Goal:** Reports are generated with Claude, using either a workspace-supplied Claude API key or the server's key.

- Replace the OpenAI Responses call in `src/reporting/ai.ts` with the official `@anthropic-ai/sdk`:
  - `client.messages.create({ model, max_tokens: 16000, system: [...prompts], messages: [{ role: 'user', content: JSON.stringify(pool) }], output_config: { format: { type: 'json_schema', schema } } })` (structured outputs). Keep the existing Zod validation and the evidence-ID check after the call.
  - Default model `claude-opus-5-5`, configurable with `AI_MODEL`. Use the `"default"` server-side refusal fallback, and handle `stop_reason: 'refusal'` and `'max_tokens'` with clear 502 messages.
  - Env: `ANTHROPIC_API_KEY` (server fallback) replaces `OPENAI_API_KEY`. `aiConfigured` reports whether either a workspace key or the server key is available.
- **Workspace key (bring your own key):** migration `006_ai_credentials.sql` adds `ai_credentials(location_id PK, provider, api_key_enc, last4, validated_at)`. The key is encrypted with the existing `ENCRYPTION_KEY`.
  - `PUT /api/ai/key` validates the key with a cheap `client.models.list()` call before saving. `GET /api/ai/key` returns `{ configured, last4, validatedAt }` and never the key itself. `DELETE /api/ai/key` removes it.
  - Connections gets an "AI provider" panel with a password-type field and a "Test & save" button.
  - Order used: workspace key first, then the server key. The usage and audit record notes which one was used.
- The MCP tool `get_ai_status` returns `{ configured, source: 'workspace' | 'server' | 'none', model }`. **The key itself is never accepted or returned through MCP** (**I-5**).
- Prompt provenance (`promptVersion`) records `provider: 'anthropic'`.

**Tests:** a mocked SDK checks that the response is parsed and validated; invalid evidence IDs are rejected; a saved key is never returned; with no key, the 503 message reads "Add a Claude API key in Connections".
**Done when:** a preview workspace with a test key generates a report end to end.

---

## Step 8: Weekly single-action report

**Goal:** Each report reads the whole data pool and gives the user exactly **one** action. A new report is available only after 7 days.

- **Prompt and schema** (`src/reporting/prompts.ts`, `src/reporting/ai.ts`; bump the prompt version):
  ```
  { summary, previousActionReview | null,
    action: { title, why, steps[≤5], effort: 'low'|'medium',
              metric: { name, evidenceId, baseline, direction: 'increase'|'decrease' },
              evidenceIds[≥1] },
    dataQuality[] }
  ```
  Prompt rules: choose the single change with the best ratio of evidence to effort; prefer low-risk changes (landing-page message, journey rules, negative keywords, conversion-tracking fixes) over budget increases; ground the action in a metric that the data pool can re-measure in 7 days; when evidence is thin, the action is to fix measurement.
- **Cadence gate:** migration `007_report_cycles.sql` adds `report_cycles(id, location_id, report_id, created_at, next_available_at, action jsonb, action_status 'open'|'done'|'skipped', action_done_at, baseline jsonb, result jsonb)`.
  - `reserveReport` refuses with 429 "Your next report is available on <date>" while `now() < next_available_at` (`created_at + 7 days`). This applies to the dashboard and to MCP `generate_marketing_report`.
  - The reporting period is fixed at the **last 7 days** for this report type.
  - `get_reporting_allowance` returns `nextReportAt`.
- **Reports page:** one large card for the current action (title, why, steps, metric to watch) with **Mark as done** and **Skip** buttons, and a countdown to the next report. Older reports move into a collapsed history list.
- Billing copy says "One focused report every 7 days". How this fits with the existing trial and monthly quota is in **I-6**.

**Done when:** two report requests 1 minute apart give one report and one 429; the report contains exactly one action whose `metric.evidenceId` exists in the data pool.

---

## Step 9: Results of the last change

**Goal:** Before the user can generate the next report, show what happened after the last action.

- When the action is generated, store its baseline: the metric value and supporting counts (for example, sessions and conversions) from the 7-day window before the report.
- When the user marks the action **done**, record `action_done_at`. The comparison window then runs from `action_done_at` for 7 days. If the user never marks it done, the window starts at `created_at` and the result is labelled "action not confirmed".
- `computeActionResult(cycle)` (a pure function) re-runs `buildDataPool` for the comparison window, finds the same evidence path, and returns `{ before, after, change, changePct, direction met?, sampleWarning, caveats }`. Caveats include Ads conversion lag and seasonality (**I-7**).
- The **Reports** page shows a "Result of your last change" card above the generate button once the comparison window ends. Until then it shows "Measuring… results on <date>".
- The next report's prompt input includes `previousAction` and `previousResult`, and the AI must fill in `previousActionReview` first.
- MCP `get_current_action` returns the cycle together with its result.

**Tests:** fixtures with the conversion rate going from 2% to 3% give `change = +1pt` with `direction met = true`; under 30 sessions sets `sampleWarning`.
**Done when:** the end-to-end flow (report → mark done → 7 days pass → result card → next report) works with a mocked clock.

---

## Step 10: Rings view and switching to the journey topology view

**Goal:** The primary Overview is a website-wide **rings** view of all traffic. Selecting a single journey switches to the existing topology (roads) view for that journey. Both views share the same visual language.

- **New `web/src/components/RingsBoard.vue`**, reusing the geometry in `Dartboard.vue` (`center`, `ringRadius`, the bullseye, glow filters):
  - Draw concentric ring guides only. Remove the decorative segments (`decoWedges` and `decoBand` in `Dartboard.vue`).
  - Ring = step depth from entry (ring 1 = landing pages, the bullseye = conversion). Page nodes sit on their ring and are sized by sessions.
  - All traffic is visible: aggregate flows between rings are thin radial strokes (no two-way roads). Node colour shows the leading source group (Google paid / organic / direct / referral / other), with a legend.
  - Hover shows page sessions, conversions and source mix. Clicking a node highlights the journeys that pass through it.
- **New `web/src/OverviewView.vue`** coordinates the two views:
  - State `mode: 'rings' | 'journey'` and `selectedJourney`.
  - The journey list (configured journeys plus "All traffic") sits beside the rings. Choosing a journey sets `mode = 'journey'` and renders the existing `TrafficView` with the traffic filtered to that journey's sessions. A **← All traffic** control returns to the rings view.
  - Shared header statistics and a short cross-fade transition so the switch feels like zooming in.
- **Data:** `GET /api/traffic?days=…&journey=<id>` filters by `events.journey_id`. The rings view uses a server-side aggregation (`src/traffic/aggregate.ts` → `ringsDataset`) so the browser never receives raw sessions (**I-15**).
- `App.vue` renders `OverviewView` instead of `TrafficView` directly.

**Tests:** extend `test/dartboard.test.ts`: the rings model puts landing pages on ring 1 and has no segment data; filtering by journey ID returns only that journey's sessions.
**Done when:** the preview seed shows the rings view by default, selecting a journey opens the roads view for that journey only, and "All traffic" returns.

---

## Release checklist (after Step 10)

- `npm run check` and the database integration tests pass.
- Google: the OAuth app is **In production** and verified; the developer token has **Basic** access or higher; a live test account has been read for every Ads level.
- A Claude key has been tested in both modes (workspace key and server key).
- The weekly gate and the before/after result have been checked on a staging workspace with a shifted clock.
- `docs/reporting.md`, `README.md` and the public guide are updated: AI provider, cadence, MCP tools, and the Google setup link.
