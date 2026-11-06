import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireSession, httpError } from '../security/access.js';
import { contextSchema, getContext, overview, createReport, listReports, getReport } from './service.js';
import { reportInput } from './period.js';

export async function registerReportingRoutes(app: FastifyInstance) {
  app.get('/api/reporting/context', async request => getContext((await requireSession(request)).locationId));
  app.put('/api/reporting/context', async request => {
    const { locationId } = await requireSession(request);
    const context = contextSchema.parse(request.body);
    await pool.query('UPDATE installations SET reporting_context=$2,updated_at=now() WHERE location_id=$1', [locationId, context]);
    return context;
  });
  app.get('/api/analysis', async request => overview((await requireSession(request)).locationId, reportInput.parse(request.query)));
  app.get('/api/reports', async request => ({ reports: await listReports((await requireSession(request)).locationId) }));
  app.post('/api/reports', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async request => {
    const session = await requireSession(request);
    return createReport(session.locationId, session.userId, reportInput.parse(request.body));
  });
  app.get('/api/reports/:id', async request => {
    const { locationId } = await requireSession(request);
    return getReport(locationId, z.object({ id: z.string().uuid() }).parse(request.params).id);
  });
  app.delete('/api/reports/:id', async request => {
    const { locationId } = await requireSession(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await pool.query('DELETE FROM reports WHERE location_id=$1 AND id=$2 RETURNING id', [locationId, id]);
    if (!result.rowCount) throw httpError(404, 'Report not found');
    return { ok: true };
  });
}
