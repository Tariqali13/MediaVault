import { loadConfig } from '../config.js';
import { createPool } from './client.js';
import { migrate } from './migrate.js';

const pool = createPool(loadConfig().DATABASE_URL);
await migrate(pool);
await pool.end();
