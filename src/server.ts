import { buildApp } from './http/app.js';
import { getEnv } from './config/env.js';
import { pool } from './db/pool.js';
import { expireTransientData } from './db/retention.js';

const app = await buildApp();
const env = getEnv();
await expireTransientData();
const retention = setInterval(() => { void expireTransientData().catch(() => app.log.error('Retention cleanup failed')); }, 60 * 60 * 1000);
retention.unref();
app.addHook('onClose', async () => { clearInterval(retention); });
await app.listen({ port: env.PORT, host: env.DEV_PREVIEW ? '127.0.0.1' : '0.0.0.0' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await app.close(); await pool.end(); process.exit(0); });
