import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config/index.js';
import * as schema from './schema.js';

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool, { schema });

export { schema };

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
