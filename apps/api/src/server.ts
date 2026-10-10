import { loadConfig } from './config.js';
import { createPool } from './db/client.js';
import { migrate } from './db/migrate.js';
import { Sessions } from './auth/sessions.js';
import { buildApp, createStorage } from './app.js';
import { MediaQueue } from './media/pipeline.js';
import { ensureSeed } from './demo/demo.js';
import { runMaintenance } from './maintenance.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
await migrate(pool, (m) => console.log(m));

const storage = createStorage(config);
const sessions = new Sessions(pool, config.SESSION_TTL_DAYS);
const queue = await MediaQueue.start(config.DATABASE_URL);
const app = await buildApp({ config, pool, sessions, storage, queue });

if (config.RUN_WORKER_IN_PROCESS) await queue.work({ pool, storage, log: app.log });
if (config.DEMO_MODE) {
  // Render the sample library in the background so the first "Try the demo" is fast.
  ensureSeed(storage).catch((err) => app.log.error({ err }, 'demo seed failed'));
}

const housekeeping = setInterval(() => {
  runMaintenance({ pool, sessions, storage })
    .then((r) => (r.sessions || r.demos || r.abandoned) && app.log.info(r, 'housekeeping'))
    .catch((err) => app.log.error({ err }, 'housekeeping failed'));
}, 10 * 60_000);

await app.listen({ port: config.PORT, host: config.HOST });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    clearInterval(housekeeping);
    await app.close();
    await queue.stop();
    await pool.end();
    process.exit(0);
  });
}
