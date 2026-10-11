/**
 * The demo API runs on a free host that sleeps when idle and takes 30-60 s to wake.
 * Through the web host's /api proxy, a sleeping API answers with an HTML holding
 * page or a gateway error rather than JSON, so the first request after a quiet
 * spell would fail. This polls /api/health until the real API answers.
 */
export const WAKE_TIMEOUT_MS = 120_000;
const ATTEMPT_TIMEOUT_MS = 10_000;
const RETRY_EVERY_MS = 2_000;

export async function apiIsUp(signal?: AbortSignal): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch('/api/health', { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false; // network error or timeout: still waking
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

/** Resolves true once the API is up, false if it isn't up within `timeoutMs`. */
export async function waitForApi({ timeoutMs = WAKE_TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!signal?.aborted) {
    if (await apiIsUp(signal)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(RETRY_EVERY_MS, signal);
  }
  return false;
}

// One check per page load, shared by every route.
let ready = false;
export const apiKnownUp = () => ready;
export const markApiUp = () => { ready = true; };
