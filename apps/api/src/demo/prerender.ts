/**
 * Renders the demo sample library into local storage ahead of time:
 *   node dist/demo/prerender.js <storage dir>
 *
 * The Docker build runs this, so the library ships inside the image. On a host
 * whose disk is wiped on every restart (Render's free plan), the server would
 * otherwise re-render sixteen large images each time it wakes, and that burst
 * of image work is what pushed the instance past its memory limit.
 */
import { LocalStorage } from '../storage/local.js';
import { ensureSeed } from './demo.js';

const dir = process.argv[2] ?? '.data/storage';
const seed = await ensureSeed(new LocalStorage(dir, 'http://localhost', 'prerender'));
console.log(`demo library: ${seed.length} assets rendered into ${dir}`);
