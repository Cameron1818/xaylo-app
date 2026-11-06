import pg from 'pg';
import { getEnv } from '../config/env.js';
export const pool = new pg.Pool({ connectionString: getEnv().DATABASE_URL });
