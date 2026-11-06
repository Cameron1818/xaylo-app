import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { getEnv, ghlConfigured } from '../config/env.js';
import { pool } from '../db/pool.js';
import { exchangeCode, resolveLocationToken, saveInstallation, addContactTags, getContactTags } from '../ghl/client.js';
import { journeyInput, selectJourney, type Journey, type TrackingContext } from '../journeys/model.js';
import { decryptGhlContext, readToken, signToken, verifyGhlWebhook } from '../security/crypto.js';
import { buildTrafficDataset } from '../traffic/aggregate.js';
import { requireSession } from '../security/access.js';
import { attributionFields, attributionSchema, eventProperties } from '../traffic/attribution.js';
import { registerReportingRoutes } from '../reporting/routes.js';
import { registerGoogleRoutes } from '../google/routes.js';
import { registerMcpRoutes } from '../mcp/routes.js';
import { registerAccountRoutes } from '../accounts/routes.js';
import { registerBillingRoutes } from '../billing/routes.js';
import { registerGhlRoutes, consumeGhlState } from '../ghl/routes.js';

const contextSchema = z.object({ userId: z.string(), activeLocation: z.string(), role: z.string().optional() });
const eventSchema = z.object({
  siteKey: z.string().min(1), visitorId: z.string().uuid(), sessionId: z.string().uuid().optional(), eventType: z.enum(['page_view', 'conversion']),
  pageUrl: z.string().url().max(2000), referrer: z.string().max(2000).optional(),
  ...attributionFields, attribution: attributionSchema.optional(),
  contactToken: z.string().optional()
});
type ContactToken = { locationId: string; contactId: string; kind: 'contact' };
type JourneyRow = { id: string; location_id: string; name: string; slug: string; status: 'draft' | 'published'; priority: number; rules: Journey['rules']; content: Journey['content']; add_tags: string[] };
const toJourney = (row: JourneyRow): Journey => ({ id: row.id, locationId: row.location_id, name: row.name, slug: row.slug, status: row.status, priority: row.priority, rules: row.rules, content: row.content, addTags: row.add_tags });

export async function buildApp() {
  const env = getEnv();
  const preview = env.DEV_PREVIEW && process.env.NODE_ENV === 'development' && new URL(env.PUBLIC_BASE_URL).hostname === 'localhost';
  const app = Fastify({ trustProxy: (_address, hop) => hop < 1, logger: { serializers: { req: request => ({ method: request.method, path: request.url?.split('?')[0] }) } }, bodyLimit: 64 * 1024 });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  app.get('/assets/:file', async (request, reply) => {
    const { file } = z.object({ file: z.string() }).parse(request.params);
    if (file === 'tracker.js') return reply.type('application/javascript').send(await readFile(fileURLToPath(new URL('../public/tracker.js', import.meta.url))));
    if (file === 'xaylo-logo.png') return reply.type('image/png').send(await readFile(fileURLToPath(new URL('../public/xaylo-logo.png', import.meta.url))));
    if (!/^[a-zA-Z0-9_-]+\.(js|css|svg|woff2)$/.test(file)) return reply.code(404).send();
    const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.svg') ? 'image/svg+xml' : 'font/woff2';
    try { return reply.type(type).send(await readFile(fileURLToPath(new URL(`../../web/dist/assets/${file}`, import.meta.url)))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reply.code(404).send(); throw error; }
  });

  // Preserve exact request bytes for signature verification.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    if (request.url.startsWith('/webhooks/')) done(null, body);
    else { try { done(null, body.length ? JSON.parse(body.toString('utf8')) : {}); } catch { done(Object.assign(new Error('Invalid JSON'), { statusCode: 400 })); } }
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ errorType: error instanceof Error ? error.name : 'Unknown' }, 'Request failed');
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid input', details: error.flatten() });
    const status = typeof error === 'object' && error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 500;
    const message = error instanceof Error && status < 500 ? error.message : error && typeof error === 'object' && 'publicMessage' in error ? error.publicMessage : 'Internal error';
    return reply.code(status).send({ error: message });
  });
  app.get('/health', async () => ({ ok: true }));
  for (const path of ['/', '/guide']) app.get(path, async (_request, reply) => {
    const template = await readFile(fileURLToPath(new URL('../public/guide.html', import.meta.url)), 'utf8');
    const trialLabel = env.FREE_TRIAL_DAYS ? `${env.FREE_TRIAL_DAYS}-day free trial` : 'One free AI report';
    const trialDetail = env.FREE_TRIAL_DAYS
      ? `After ${env.FREE_TRIAL_DAYS} days, a subscription is needed for new source analysis.`
      : 'The free report allowance does not expire.';
    return reply.type('text/html').header('Cache-Control', 'public, max-age=300').send(template
      .replaceAll('__TRIAL_LABEL__', trialLabel)
      .replaceAll('__FREE_LOOKBACK__', String(env.FREE_REPORT_LOOKBACK_DAYS))
      .replaceAll('__TRIAL_DETAIL__', trialDetail));
  });
  app.get('/app', async (_request, reply) => reply.type('text/html').send(await readFile(fileURLToPath(new URL('../../web/dist/index.html', import.meta.url)))));
  app.get('/oauth/callback', async (request, reply) => {
    if (!ghlConfigured(env)) return reply.code(503).send({ error: 'HighLevel integration is not configured' });
    const { code, state } = z.object({ code: z.string().min(1), state: z.string().max(200).optional() }).parse(request.query);
    const workspaceId = state ? await consumeGhlState(state) : undefined;
    const token = await resolveLocationToken(await exchangeCode(code));
    await saveInstallation(token, workspaceId);
    return reply.type('text/html').send('<!doctype html><title>Xaylo connected</title><h1>Xaylo is connected</h1><p>Open Xaylo from your HighLevel sub-account menu to build your first journey.</p>');
  });

  app.post('/webhooks/ghl', { config: { rawBody: true } }, async (request, reply) => {
    if (!ghlConfigured(env)) return reply.code(503).send({ error: 'HighLevel integration is not configured' });
    const raw = request.body as Buffer;
    if (!verifyGhlWebhook(raw, request.headers['x-ghl-signature'] as string | undefined)) return reply.code(401).send({ error: 'Invalid signature' });
    const event = z.object({ type: z.string(), appId: z.string(), webhookId: z.string(), locationId: z.string().optional() }).passthrough().parse(JSON.parse(raw.toString('utf8')));
    if (event.appId !== env.GHL_APP_ID) return reply.code(403).send({ error: 'Wrong app' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('INSERT INTO webhook_receipts(webhook_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING webhook_id', [event.webhookId]);
      if (!result.rowCount) { await client.query('COMMIT'); return { ok: true, duplicate: true }; }
      if (event.type === 'UNINSTALL' && event.locationId) {
        const locations = await client.query("UPDATE installations SET access_token='',refresh_token='',ghl_location_id=NULL,updated_at=now() WHERE ghl_location_id=$1 RETURNING location_id", [event.locationId]);
        // Website-only accounts remain usable; old GHL sessions and assistant grants lose access.
        for (const location of locations.rows) {
          await client.query('DELETE FROM ghl_oauth_states WHERE location_id=$1', [location.location_id]);
          await client.query('DELETE FROM mcp_grants WHERE location_id=$1', [location.location_id]);
        }
      }
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
  app.post('/api/session', async (request, reply) => {
    if (!ghlConfigured(env)) return reply.code(503).send({ error: 'HighLevel integration is not configured' });
    const { encryptedData } = z.object({ encryptedData: z.string().min(1) }).parse(request.body);
    let context: z.infer<typeof contextSchema>;
    try { context = contextSchema.parse(decryptGhlContext(encryptedData, env.GHL_SHARED_SECRET)); }
    catch { return reply.code(401).send({ error: 'Invalid GHL context' }); }
    if (!['admin', 'agency_admin', 'agency_owner'].includes(context.role ?? '')) return reply.code(403).send({ error: 'Admin access required' });
    const installed = await pool.query("SELECT location_id FROM installations WHERE ghl_location_id=$1 AND status='active'", [context.activeLocation]);
    if (!installed.rowCount) return reply.code(403).send({ error: 'Location is not installed' });
    return { token: signToken({ kind: 'session', locationId: installed.rows[0].location_id, ghlLocationId: context.activeLocation, userId: context.userId }, env.SESSION_SECRET, 3600) };
  });
  if (preview) app.get('/api/dev/session', async () => ({ token: signToken({ kind: 'session', locationId: 'local-preview', userId: 'local-admin', preview: true }, env.SESSION_SECRET, 3600) }));

  app.get('/api/settings', async request => {
    const session = await requireSession(request);
    const result = await pool.query("SELECT site_key, allowed_origins FROM installations WHERE location_id=$1 AND status='active'", [session.locationId]);
    if (!result.rows[0]) throw Object.assign(new Error('Location is not installed'), { statusCode: 403 });
    return { siteKey: result.rows[0].site_key, allowedOrigins: result.rows[0].allowed_origins, locationId: session.locationId };
  });
  app.put('/api/settings', async request => {
    const session = await requireSession(request);
    const { allowedOrigins } = z.object({ allowedOrigins: z.array(z.string().url().refine(value => new URL(value).origin === value)).max(10) }).parse(request.body);
    await pool.query('UPDATE installations SET allowed_origins=$2, updated_at=now() WHERE location_id=$1', [session.locationId, allowedOrigins]);
    return { allowedOrigins };
  });
  app.get('/api/journeys', async request => {
    const session = await requireSession(request);
    const result = await pool.query<JourneyRow>('SELECT * FROM journeys WHERE location_id=$1 ORDER BY priority DESC, name', [session.locationId]);
    return { journeys: result.rows.map(toJourney) };
  });
  app.post('/api/journeys', async (request, reply) => {
    const session = await requireSession(request);
    const input = journeyInput.parse(request.body);
    const id = randomUUID();
    const result = await pool.query<JourneyRow>(
      `INSERT INTO journeys(id,location_id,name,slug,status,priority,rules,content,add_tags)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, session.locationId, input.name, input.slug, input.status, input.priority, input.rules, input.content, input.addTags]);
    return reply.code(201).send(toJourney(result.rows[0]!));
  });
  app.put('/api/journeys/:id', async (request, reply) => {
    const session = await requireSession(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = journeyInput.parse(request.body);
    const result = await pool.query<JourneyRow>(
      `UPDATE journeys SET name=$3,slug=$4,status=$5,priority=$6,rules=$7,content=$8,add_tags=$9,updated_at=now()
       WHERE id=$1 AND location_id=$2 RETURNING *`,
      [id, session.locationId, input.name, input.slug, input.status, input.priority, input.rules, input.content, input.addTags]);
    if (!result.rows[0]) return reply.code(404).send({ error: 'Journey not found' });
    return toJourney(result.rows[0]);
  });
  app.delete('/api/journeys/:id', async (request, reply) => {
    const session = await requireSession(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await pool.query('DELETE FROM journeys WHERE id=$1 AND location_id=$2', [id, session.locationId]);
    return reply.code(204).send();
  });
  app.post('/api/contact-links', async request => {
    const session = await requireSession(request);
    const { contactId } = z.object({ contactId: z.string().min(1).max(100) }).parse(request.body);
    await getContactTags(session.locationId, contactId);
    return { contactToken: signToken({ kind: 'contact', locationId: session.locationId, contactId }, env.SESSION_SECRET, 60 * 60 * 24 * 30) };
  });
  app.get('/api/events', async request => {
    const session = await requireSession(request);
    const result = await pool.query('SELECT id, journey_id, event_type, page_url, created_at FROM events WHERE location_id=$1 ORDER BY created_at DESC LIMIT 50', [session.locationId]);
    return { events: result.rows };
  });
  app.get('/api/traffic', async request => {
    const session = await requireSession(request);
    const { days } = z.object({ days: z.coerce.number().int().refine(value => [7, 30, 90].includes(value)).default(30) }).parse(request.query);
    const result = await pool.query(
      `SELECT id, visitor_id, session_id, event_type, page_url, created_at FROM events
       WHERE location_id=$1 AND created_at >= now() - ($2::int * interval '1 day')
       ORDER BY created_at, id`, [session.locationId, days]);
    return buildTrafficDataset(result.rows, days);
  });

  app.post('/collect', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = eventSchema.parse(request.body);
    const installed = await pool.query<{ location_id: string; allowed_origins: string[] }>(
      "SELECT location_id, allowed_origins FROM installations WHERE site_key=$1 AND status='active'", [input.siteKey]);
    const installation = installed.rows[0];
    if (!installation) return reply.code(404).send({ error: 'Unknown site' });
    const origin = request.headers.origin;
    if (!origin || !installation.allowed_origins.includes(origin)) return reply.code(403).send({ error: 'Origin is not allowed' });
    reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
    const url = new URL(input.pageUrl);
    if (url.origin !== origin) return reply.code(400).send({ error: 'Page origin mismatch' });
    const contact = input.contactToken ? readToken<ContactToken>(input.contactToken, env.SESSION_SECRET) : null;
    let contactId = contact?.kind === 'contact' && contact.locationId === installation.location_id ? contact.contactId : null;
    const result = await pool.query<JourneyRow>("SELECT * FROM journeys WHERE location_id=$1 AND status='published'", [installation.location_id]);
    let tags: string[] = [];
    let tagSync = 'not_requested';
    if (contactId) {
      try { tags = await getContactTags(installation.location_id, contactId); }
      catch { contactId = null; tagSync = 'unavailable'; }
    }
    const context: TrackingContext = { utmSource: input.utmSource, utmCampaign: input.utmCampaign, utmMedium: input.utmMedium, utmTerm: input.utmTerm, utmContent: input.utmContent, path: url.pathname, referrer: input.referrer, tags };
    const journey = selectJourney(result.rows.map(toJourney), context);
    const safePageUrl = `${url.origin}${url.pathname}`;
    const inserted = await pool.query('INSERT INTO events(id,location_id,journey_id,contact_id,visitor_id,session_id,event_type,page_url,properties) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id',
      [randomUUID(), installation.location_id, journey?.id ?? null, contactId, input.visitorId, input.sessionId ?? null, input.eventType, safePageUrl, { ...eventProperties(input), tagSync }]);
    if (inserted.rowCount && journey && contactId && input.eventType === 'conversion') {
      try { await addContactTags(installation.location_id, contactId, journey.addTags); tagSync = 'synced'; }
      catch { tagSync = 'failed'; }
      await pool.query("UPDATE events SET properties=properties || jsonb_build_object('tagSync',$3::text) WHERE location_id=$1 AND id=$2", [installation.location_id, inserted.rows[0].id, tagSync]);
    }
    return { journey: journey ? { id: journey.id, slug: journey.slug, content: journey.content } : null, tagSync };
  });
  app.options('/collect', async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin) return reply.code(403).send();
    const result = await pool.query("SELECT 1 FROM installations WHERE $1=ANY(allowed_origins) AND status='active' LIMIT 1", [origin]);
    if (!result.rowCount) return reply.code(403).send();
    return reply.header('Access-Control-Allow-Origin', origin).header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Content-Type').header('Vary', 'Origin').code(204).send();
  });
  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/') || request.url.startsWith('/oauth/')) reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
  });
  await registerAccountRoutes(app);
  await registerBillingRoutes(app);
  await registerGhlRoutes(app);
  await registerGoogleRoutes(app);
  await registerReportingRoutes(app);
  await registerMcpRoutes(app);
  return app;
}
