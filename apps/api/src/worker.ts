/**
 * Standalone media worker. Scale this independently of the API when uploads
 * are heavy (set RUN_WORKER_IN_PROCESS=false on the API).
 */
import pino from 'pino';
import { loadConfig } from './config.js';
import { createPool } from './db/client.js';
import { createStorage } from './app.js';
import { MediaQueue } from './media/pipeline.js';

const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL });
const pool = createPool(config.DATABASE_URL);
const storage = createStorage(config);
const queue = await MediaQueue.start(config.DATABASE_URL);
await queue.work({ pool, storage, log }, 4);
log.info('media worker started');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await queue.stop();
    await pool.end();
    process.exit(0);
  });
}
