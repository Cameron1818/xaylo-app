# Accounts, analysis and subscriptions

Xaylo is an integrator and report provider. Each workspace owns its website tracking, GHL connection, selected Google Ads accounts, marketing goals, reports and assistant grants. Xaylo's own GHL location is an ordinary, separate workspace for its internal business and marketing. It has no implicit access to client workspaces.

## Enable the integrations

Run `npm install`, configure `.env` (or `.env.vm`), run `npm run db:migrate`, and build with `npm run build`. Migrations are additive and safe to rerun. Existing GHL installations retain their workspace IDs; `ghl_location_id` is now an explicit external reference. The production Compose service forwards the new environment settings.

1. **Email accounts:** Set `RESEND_API_KEY` and `EMAIL_FROM` to a verified Resend sender. Opening `/app` outside GHL offers account creation/sign-in by email. A one-use, 15-minute email link verifies ownership before creating a workspace. Sign-in links use URL fragments so they do not enter HTTP access logs. Account sessions last 30 days, with one-hour access tokens; signing out revokes that session. No passwords are stored. GHL's embedded administrator sign-in remains available without the email service.
2. **GHL (optional):** Leave all four GHL credential settings empty for a website-only deployment. GHL authorisation endpoints remain disabled until all four are configured. Configure the existing Marketplace credentials and callback `/oauth/callback`. Request `contacts.readonly`, `contacts.write`, `oauth.write`, `locations.readonly`, `locations/customFields.readonly`, and `opportunities.readonly`. Existing installations need renewed consent after changing scopes. Connect from **Connections** to link GHL to an existing website workspace, or install through the Marketplace pilot link. A GHL location cannot be linked to two workspaces. GHL uninstall/disconnect removes its credentials and invalidates GHL sessions and MCP grants; it preserves website data and saved reports for standalone account owners.
3. **Google Ads:** Enable approved Google Ads API access for your Google Cloud project, configure a web OAuth client, and register `/oauth/google/callback` under `PUBLIC_BASE_URL`. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CLOUD_PROJECT`. The REST endpoint version defaults to `v26`; use a supported version when upgrading. `GOOGLE_ADS_DEVELOPER_TOKEN` is optional for access configurations that still require that header. Connect in **Connections**, then explicitly select advertising accounts. For manager accounts, explore the manager or enter the advertising ID and login manager ID directly. Reconnecting requires selecting accounts again. There are no Ads mutation endpoints.
4. **AI:** Set `OPENAI_API_KEY` and `AI_MODEL` to a model available to your project that supports Structured Outputs through the Responses API. Missing AI configuration disables generation while leaving source analysis available. Xaylo's prompts are maintained in `src/reporting/prompts.ts`; change their version when editing them. Report provenance records the prompt version/hash, model, reporting period and a hash of the client's strategy context. Provider requests use `store:false`; this is not a guarantee about the provider's separate abuse-monitoring retention policy.
5. **Subscriptions:** Create a recurring Stripe Price; set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET`. Enable Stripe's customer portal. Register `/webhooks/stripe` for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`. The checkout success URL never grants access. Verified webhook processing links the current subscription reference; analysis checks the current subscription with Stripe. Canceled, expired, unpaid and past-due subscriptions do not grant paid access. Cancellation scheduled for period end keeps access while Stripe reports the subscription active and its item period is current.

No live accounts, sender domains, subscription products, prices or webhook endpoints are created by the repository. Use provider test credentials first. Production credentials remain server-side.

## Tier rules

Defaults implement a seven-day trial starting when the workspace is created, with **one AI report total** and a maximum **seven-day reporting lookback**. The report quota applies across the dashboard and MCP, and is reserved atomically before fetching sources or calling AI. Failed generations release reservations. Concurrent requests cannot produce extra free reports. Deleting a report does not reset usage. Expired reservations are cleaned automatically.

- `FREE_TRIAL_DAYS=7`: trial duration. Set to `0` for one free report without a time-limited trial.
- `FREE_REPORT_LOOKBACK_DAYS=7`: maximum free reporting window; public reporting periods are 7, 30 or 90 days.
- `PAID_REPORTS_PER_MONTH=30`: initial paid allowance, configurable independently of the Stripe Price. Paid users can analyse up to 90 days. Quotas reset on the first day of each calendar month in UTC, regardless of billing interval.

Within a valid trial, source analysis can be refreshed; only AI generation consumes the report allowance. Once the trial ends, new source analysis and report generation require a subscription. Basic journey management, tracking and reading/deleting saved reports remain available. Paid monthly report exhaustion blocks generation but does not block live source analysis.

## What is stored

Persisted data is limited to authentication/billing references, encrypted OAuth credentials, explicit source account references, Xaylo journeys/goals, first-party visitor events for 90 days, usage counts, OAuth grant metadata and saved reports with summary evidence. Source contacts, individual opportunities, Ads datasets and upstream API payloads are not mirrored. Operational logs omit request queries, bearer tokens, email links and upstream error payloads.

GHL contacts are reduced in memory to tag/source/choice-field counts. Only explicitly selected custom fields with defined picklist options are used for segmentation; free-text values and contact names/emails/phone numbers are excluded from model input. CRM opportunity values are labelled as pipeline values with unverified currency, never collected revenue or CRM ROAS. Keyword/search-term tools return bounded live results; saved reports use campaign summary metrics instead.

The app expires first-party events older than 90 days on startup and hourly. It removes expired sign-in links, account sessions, OAuth requests, assistant grants and pending report reservations. Saved reports remain until their owner deletes them. Completed usage counters remain so report deletion cannot reset a free quota. Database backups have their own retention policy; apply that policy to expiry/deletion expectations too.

## Attribution

The tracker captures all five UTMs, `gclid`, `gbraid`, `wbraid`, `xaylo_campaign_id`, landing page and referrer. First touch and last non-direct touch persist in first-party browser storage for up to 90 days; session acquisition uses the existing 30-minute inactivity rule. Data is scoped to the tracker site key and site origin. There is no cross-device or cross-domain identity stitching. Storage-blocked browsers use document memory and cannot retain attribution across reloads.

SPA `pushState`, `replaceState` and `popstate` navigation is tracked. The script does not copy arbitrary query strings into event page URLs or referrers. All five UTM fields can drive journey rules. Call `window.Xaylo.conversion()` after a confirmed conversion; new tracker conversions are deduplicated per visitor/session by the database and browser. CRM lookup/tagging outages do not discard browser events. The tracker emits `xaylo:tracking-status` with `tagSync` (`not_requested`, `synced`, `unavailable`, or `failed`); failed tag delivery is recorded for diagnosis and does not have a background retry queue.

Add `xaylo_campaign_id={campaignid}` to your Google Ads final URL suffix to carry an explicit campaign reference. Existing UTM campaign names can instead be mapped to numeric Ads campaign IDs under **Connections → Campaign attribution setup**. A Google click ID alone is not treated as a campaign mapping. The dashboard reports mapping coverage; it does not infer an identity or revenue join between Ads, browser visitors and CRM contacts.

Xaylo uses UTC rolling windows. Google Ads uses the selected account's calendar dates and timezone, including partial today; Google conversion action/window definitions can differ from browser events. Currency, source timestamps, partial data and these boundary differences are included in reports. `REPORT_SOURCE_MAX_PAGES` defaults to 20 per paginated source; capped results are labelled partial. MCP Ads responses return at most 200 rows; report evidence contains at most 25 leading channel, landing-page and campaign rows.

## MCP and HTTP interfaces

The MCP endpoint is `PUBLIC_BASE_URL/mcp` using stateless Streamable HTTP POST. It supports OAuth discovery, public-client registration, exact registered redirects, S256 PKCE, resource-bound grants, single-use authorization codes, rotating refresh tokens and revocation. An assistant opens an authorization page; the workspace administrator enters its code in **Connections**, reviews the app/callback/scopes and explicitly approves it. Grants are scoped to one workspace and expire after 90 days; access tokens expire after one hour.

Scopes are `reports:read` and optional `reports:generate`. Granting generation does not bypass tier limits. Tools are:

- `get_connected_accounts`
- `get_reporting_allowance`
- `get_business_context`
- `get_crm_summary`
- `get_traffic_analysis`
- `get_google_ads_performance` (campaign, adGroup, ad, keyword or searchTerm)
- `get_marketing_overview`
- `generate_marketing_report`
- `list_reports`
- `get_report`

Dashboard interfaces use the existing bearer session and derive workspace ownership on the server:

- `POST /api/auth/email`, `/api/auth/redeem`, `/api/auth/session`, `/api/auth/logout`
- `GET /api/ghl`, `POST /api/ghl/connect`, `DELETE /api/ghl`
- `GET /api/google`, `POST /api/google/connect`, `DELETE /api/google`
- `GET|POST /api/google/accounts`, `DELETE /api/google/accounts/:id`, `PUT /api/google/accounts/:id/mappings`
- `GET|PUT /api/reporting/context`, `GET /api/analysis?days=7&customerId=...`
- `GET|POST /api/reports`, `GET|DELETE /api/reports/:id`
- `GET /api/billing`, `POST /api/billing/checkout`, `POST /api/billing/portal`
- `GET /api/mcp/requests/:code`, `POST /api/mcp/approve`, `GET /api/mcp/grants`, `DELETE /api/mcp/grants/:id`

The production app should be reachable only behind Caddy; it trusts one proxy hop for client IP rate limiting. Source access, report ownership, active workspace/session status and assistant grants are checked on the server. No tool accepts an arbitrary workspace ID, source URL or GAQL query.

## Verification

`npm run check` builds and runs unit tests. Database integration tests require a separate disposable PostgreSQL database through `TEST_DATABASE_URL`; they migrate that database and create/delete only their marked fixtures. Never point this variable at production. They exercise sign-up/session revocation, isolation, attribution, report persistence and deletion, concurrent quotas, MCP consent/PKCE/refresh/revocation, trial expiry, signed billing events and retention. Upstream services are mocked so these tests send no live email, incur no AI charges, and create no subscriptions.

Before release, verify live consent and the selected reporting queries with a test GHL location and Google Ads account; verify the email sender and link flow; run Stripe test-mode checkout/portal and webhook forwarding; confirm the configured AI model produces a valid report. Scheduled report delivery and automatic Ads/CRM optimisation are outside this release.

References: [Google Ads reporting](https://developers.google.com/google-ads/api/docs/reporting/overview), [GHL contacts](https://marketplace.gohighlevel.com/docs/ghl/contacts/search-contacts-advanced/), [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), [Stripe webhook verification](https://docs.stripe.com/webhooks/signature), [Resend email API](https://resend.com/docs/api-reference/emails/send-email).
