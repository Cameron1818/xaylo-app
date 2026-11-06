import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { httpError, assertActive } from '../security/access.js';
import { registerMcpOAuth, mcpIdentity } from './oauth.js';
import { daysSchema, reportInput, reportPeriod } from '../reporting/period.js';
import { getContext, clientContext, connectedSources, overview, createReport, getReport, listReports } from '../reporting/service.js';
import { crmSummary } from '../ghl/reporting.js';
import { trafficSummary } from '../reporting/traffic.js';
import { adsLevels, googleReport } from '../google/reporting.js';
import { requireAnalysisAccess, entitlement } from '../billing/entitlements.js';

export async function registerMcpRoutes(app: FastifyInstance) {
  await registerMcpOAuth(app);
  app.post('/mcp', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && origin !== new URL(getEnv().PUBLIC_BASE_URL).origin) throw httpError(403, 'Origin is not allowed');
    let identity: Awaited<ReturnType<typeof mcpIdentity>>;
    try { identity = await mcpIdentity(request.headers); }
    catch (error) {
      reply.header('WWW-Authenticate', `Bearer resource_metadata="${getEnv().PUBLIC_BASE_URL}/.well-known/oauth-protected-resource/mcp"`);
      throw error;
    }
    const server = new McpServer({ name: 'xaylo-reporting', version: '1.0.0' });
    const tool = (name: string, description: string, schema: z.ZodRawShape, run: (input: any) => Promise<unknown>, generates = false) => {
      if (generates && !identity.scopes.includes('reports:generate')) return;
      server.registerTool(name, { description, inputSchema: schema,
        annotations: { readOnlyHint: !generates, destructiveHint: false, idempotentHint: !generates, openWorldHint: false } }, async input => {
        try {
          // Revalidate during tool execution, including within JSON-RPC batches.
          const current = await mcpIdentity(request.headers);
          if (current.grantId !== identity.grantId || (generates && !current.scopes.includes('reports:generate'))) throw httpError(403, 'Insufficient scope');
          await assertActive(identity.locationId);
          const data = await run(input);
          return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
        } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error && 'statusCode' in error ? error.message : 'Reporting tool failed; try again' }] }; }
      });
    };
    const locationId = identity.locationId;
    tool('get_reporting_allowance', 'Read this workspace’s trial, subscription, reporting window and remaining AI report allowance.', {}, async () => entitlement(locationId));
    tool('get_connected_accounts', 'List only this workspace’s explicitly selected Google Ads account references and whether GHL is connected. Use these IDs for Ads queries.', {}, async () => connectedSources(locationId));
    tool('get_business_context', 'Read this client’s optional GHL business profile and Xaylo marketing goals. Website-only workspaces still return their goals.', {}, async () => clientContext(locationId));
    tool('get_crm_summary', 'Summarise this client’s contacts and opportunity cohorts; returns aggregates rather than individual CRM records.', { days: daysSchema }, async ({ days }) => { await requireAnalysisAccess(locationId, days); return crmSummary(locationId, reportPeriod(days), (await getContext(locationId)).segmentFieldIds) });
    tool('get_traffic_analysis', 'Read this client’s first-party traffic, channels, landing-page conversion rates and attribution coverage.', { days: daysSchema }, async ({ days }) => { await requireAnalysisAccess(locationId, days); return trafficSummary(locationId, reportPeriod(days)) });
    tool('get_google_ads_performance', 'Read performance for an Ads account explicitly selected by this client. Monetary values use that account’s currency. Search-term totals may be partial.',
      { ...reportInput.shape, customerId: z.string().regex(/^\d{10}$/), level: z.enum(adsLevels).default('campaign') }, async ({ customerId, days, level }) => {
        await requireAnalysisAccess(locationId, days);
        const report = await googleReport(locationId, customerId, reportPeriod(days), level);
        return { ...report, rows: report.rows.slice(0, 200), returnedRows: Math.min(200, report.rows.length), availableRows: report.rows.length };
      });
    tool('get_marketing_overview', 'Combine this client’s traffic, CRM and optional Google Ads summaries with source timestamps and limitations.', reportInput.shape, async input => overview(locationId, reportInput.parse(input)));
    tool('generate_marketing_report', 'Generate and save a report using Xaylo’s managed analysis prompts and this client’s source summaries. Recommendations are advisory.', reportInput.shape,
      async input => createReport(locationId, identity.userId, reportInput.parse(input)), true);
    tool('list_reports', 'List this client’s saved report metadata.', {}, async () => ({ reports: await listReports(locationId) }));
    tool('get_report', 'Read one saved report belonging to this client, including summary evidence and prompt/model provenance.', { reportId: z.string().uuid() }, async ({ reportId }) => getReport(locationId, reportId));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    reply.hijack();
    reply.raw.setHeader('Cache-Control', 'no-store');
    reply.raw.on('close', () => { void transport.close(); void server.close(); });
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
  for (const method of ['GET', 'DELETE'] as const) app.route({ method, url: '/mcp', handler: async (_request, reply) => reply.code(405).header('Allow', 'POST').send({ error: 'This MCP server uses stateless Streamable HTTP POST requests' }) });
}
