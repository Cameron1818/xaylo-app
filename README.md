# Xaylo Journeys & Reporting

Standalone Node.js, TypeScript and Vue app for personalised customer journeys, client-scoped source analysis, AI reports and subscriptions. A location installs Xaylo through HighLevel OAuth. Its admins use an embedded dashboard with live traffic visualisation and a journey builder. A small website script captures UTM intent and page visits, selects a published journey, and updates marked page elements. A confirmed conversion for a signed contact adds that journey's tags to the contact in HighLevel; workflows can then react to those tags.

**Current status:** the code supports standalone email accounts and a private Marketplace pilot, but no HighLevel developer app, public HTTPS deployment or Marketplace listing is created by this repository. It is not a HighLevel Private Integration API token. Public discovery requires HighLevel review.

The site at [xaylo.com](https://xaylo.com/) describes the product as connected page, AI agent and email experiences. The first release stores `agentContext` and `emailAngle` in each journey for downstream use. It does not author GHL AI agents or email workflows automatically.

Xaylo reads GHL and Google Ads on demand and retains its own tracking data and report summaries. The dashboard includes Reports, Connections and Billing, and the same reporting tools are available through an authenticated MCP endpoint. The default free tier is a seven-day trial with one report; paid pricing and limits are configured server-side. See [account, reporting and subscription setup](docs/reporting.md) for configuration, storage rules, API interfaces and validation.

## Structure

| Directory | Responsibility |
| --- | --- |
| `src/http` | Marketplace callback, SSO, management API, tracking endpoint, webhooks |
| `src/ghl`, `src/google` | Client-scoped OAuth and live source reporting |
| `src/accounts`, `src/billing` | Verified email sign-in, trial quotas and Stripe subscriptions |
| `src/reporting`, `src/mcp` | Managed AI prompts, saved summaries and authenticated reporting tools |
| `src/journeys` | Journey schema and deterministic matching |
| `src/security` | Token encryption, signed contact links, webhook verification |
| `src/db`, `migrations` | PostgreSQL connection and schema |
| `src/public` | Website tracker |
| `src/traffic` | Location-scoped visit aggregation for the journey map |
| `web` | Vue dashboard and visitor journey visualisation |
| `test` | Matching and security checks |

## Local setup

The public marketing and setup guide is served at `/` and `/guide`, with the dashboard at `/app`. The guide covers the feature set, website-only and GHL setups, installation, attribution, AI reports, and the configured free trial. It is available without signing in and does not query the database.

1. Use Node.js 20+ and PostgreSQL 16+. Run `npm install` and `docker compose up -d db` (or provide your own PostgreSQL URL).
2. Copy `.env.example` to `.env`. Fill in the Marketplace client ID, client secret, shared secret, app ID and public HTTPS base URL. Generate independent `ENCRYPTION_KEY` (32 random bytes in hex) and `SESSION_SECRET` (32+ random characters). Node can generate them with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Run `npm run db:migrate`, then `npm run dev`. For a production build, run `npm run build && npm start`.

### Explore without HighLevel credentials

With the database running, set `PUBLIC_BASE_URL=http://localhost:3000`, `NODE_ENV=development` and `DEV_PREVIEW=true` in `.env`. The GHL credential fields may use local placeholder values for this preview. Run:

```sh
npm run db:migrate
npm run db:seed-preview
npm run dev
```

Open `http://localhost:3000/app`. The dashboard has Overview, Reports, Journeys, Tracking, Connections, Billing and Settings. The preview seed creates 1,000 sample visitor sessions across 27 days, including repeat visits and conversions. Re-running the seed refreshes those same events without duplicating them. The preview listens on `127.0.0.1` and its session endpoint is enabled only in development with a localhost base URL. It does not make live GHL calls unless you use contact features; tag sync requires a real installation. The dartboard UI was adapted from the supplied `dartboard-traffic` project; preview traffic is stored as local events.

## Marketplace configuration

For a single GCP VM pilot, use the [copy-and-paste GCP commands](deploy/GCP.md) and [VM deployment guide](deploy/README.md). It includes the production Compose stack, Caddy HTTPS, migrations and off-VM PostgreSQL backups. The root `compose.yaml` remains the local database-only setup.

Deploy this service and PostgreSQL behind your own public HTTPS domain, set production environment secrets, and run `npm run db:migrate` and `npm run build` before `npm start`. A multi-stage `Dockerfile` is included for an existing container host; run `node dist/db/migrate.js` with production environment variables before starting that image. Create a **Private, sub-account/location targeted** app in the [HighLevel developer portal](https://marketplace.gohighlevel.com/). Choose **Both Agency and Sub-account** for installers and leave bulk installation off for the pilot. Configure:

- OAuth redirect URL: `https://YOUR_HOST/oauth/callback`
- Scopes: `contacts.readonly`, `contacts.write`, `oauth.write`, `locations.readonly`, `locations/customFields.readonly`, `opportunities.readonly`
- Custom Page URL: `https://YOUR_HOST/app`
- Webhook URL: `https://YOUR_HOST/webhooks/ghl`; subscribe to `UNINSTALL`. The `INSTALL` event is also accepted.
- Generate a Shared Secret for the signed Custom Page user context and copy it to `GHL_SHARED_SECRET`.

For a pilot, use **Manage → Versions → Test Link** in the developer portal and supply the test location ID. The selected user opens that link, installs the app, and opens Xaylo's Custom Page in HighLevel. A sub-account admin provides a Location token directly; an agency admin's Company token is exchanged for a Location token when exactly one location is approved. Agency-wide and bulk installs are not supported.

The callback saves encrypted, rotating OAuth tokens. The embedded page requests encrypted user context from HighLevel and grants a one-hour management session only to location administrators. Public website requests are restricted to origins entered in Settings and are rate limited. Only HighLevel-signed webhooks are processed.

## Build a journey

1. Open Xaylo's Custom Page in the installed location.
2. Add exact website origins in **Website setup** and paste the generated script into the website header.
3. Create a journey. Match UTM source, medium, campaign, term, content, page path, referrer or an existing GHL contact tag. All filled rules must match. The highest-priority published journey wins.
4. Mark page elements with `data-xaylo-headline`, `data-xaylo-description`, `data-xaylo-cta`, and `data-xaylo-cta-link` attributes. The script changes their text and CTA URL. It also emits `xaylo:journey` with journey content for an agent integration.
5. Call `window.Xaylo.conversion()` only after a confirmed conversion. If the page has a valid signed contact token, Xaylo adds the selected journey's configured tags to that GHL contact. Configure GHL workflows to start from those tags.

To bind an existing GHL contact to a visitor, send `POST /api/contact-links` with `{ "contactId": "..." }` and the admin session bearer token. The response contains a 30-day signed `contactToken`; set it as `data-contact-token` on the tracker script or call `window.Xaylo.setContactToken(token)`. Contact existence and location ownership are checked through GHL. Use this from a trusted server or a protected automation endpoint, never expose the admin session token in public page code.

The Overview journey map groups page views into sessions with a 30-minute inactivity boundary, keeps return visits, and counts a conversion once per session. Gold/orange lines show main routes toward conversion, purple lines show alternative and return routes, and muted dashed lines show branches without an observed route to conversion. Arrows follow travel direction and thicker lines carry more sessions. Page positions stay fixed when filtering. It uses `GET /api/traffic?days=30` (also 7 or 90) for the signed-in location. Page labels omit query strings; UTM values remain separate tracking properties. Existing events without a session ID are grouped by visitor and inactivity. Hover or focus a page or line for its counts. Hover a session journey to trace its route, or click to keep it selected; clicking another switches selection and clicking the selected journey again clears it. The local demo includes 220 sessions with loops and five roads carrying traffic in both directions.

## Validation and release limits

`npm run check` builds the TypeScript service and Vue dashboard and runs the tests. Live OAuth, HighLevel API calls, webhook delivery and installation require Marketplace credentials and a public HTTPS deployment. The app does not include automatic contact recognition, workflow creation, GHL AI agent configuration, bulk installs, scheduled reports or a persistent background queue. Billing, email sign-in, Google Ads and AI generation require their provider configuration; missing optional settings leave those features unavailable. Host the app with PostgreSQL, HTTPS, secrets management and database backups before Marketplace submission.

HighLevel references: [OAuth](https://marketplace.gohighlevel.com/docs/Authorization/OAuth2.0/), [Custom Pages](https://marketplace.gohighlevel.com/docs/marketplace-modules/CustomPages/), [signed user context](https://marketplace.gohighlevel.com/docs/other/user-context-marketplace-apps/), [webhook signatures](https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/), [contact tags](https://marketplace.gohighlevel.com/docs/ghl/contacts/add-tags/).
