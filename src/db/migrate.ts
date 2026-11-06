import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

try {
  for (const name of ['001_init.sql', '002_sessions.sql', '003_reporting.sql', '004_accounts.sql', '005_entitlements.sql']) {
    const sql = await readFile(fileURLToPath(new URL(`../../migrations/${name}`, import.meta.url)), 'utf8');
    await pool.query(sql);
  }
  console.log('Database migrated');
}
finally { await pool.end(); }
