import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api, ApiError } from '../lib/api';
import { useMe, useSignedIn } from '../lib/session';
import { Wordmark } from '../components/Wordmark';

const SHEET = ['#2f8f9d', '#e86a5c', '#a7c957', '#457b9d', '#f6b26b', '#7d3c98', '#ffb703', '#264027'];

export function Welcome() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const signedIn = useSignedIn();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (me) return <Navigate to="/library" replace />;

  async function run(kind: string, fn: () => Promise<Awaited<ReturnType<typeof api.me>>>) {
    setBusy(kind);
    setError(null);
    try {
      signedIn(await fn());
      navigate('/library');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email'));
    const password = String(f.get('password'));
    if (mode === 'sign-in') void run('form', () => api.signIn(email, password));
    else void run('form', () => api.signUp({ email, password, name: String(f.get('name')), workspaceName: String(f.get('workspace')) }));
  }

  return (
    <div className="welcome">
      <section className="welcome-art">
        <div className="wordmark" style={{ color: '#fff', padding: 0 }}>
          <Wordmark light />
          MediaVault
        </div>
        <h1>One library for your studio’s pictures.</h1>
        <p>
          Upload once, find anything by title or tag, collect the selects, and send clients an expiring link. Each team’s files are
          walled off from every other team’s, down to the database.
        </p>
        <div className="sheet" aria-hidden="true">
          {SHEET.map((c, i) => (
            <span key={c} style={{ background: c }} className={i === 2 || i === 5 ? 'circled' : undefined} />
          ))}
        </div>
      </section>

      <section className="welcome-form">
        <div style={{ display: 'grid', gap: 8, maxWidth: 400 }}>
          <h2 style={{ fontSize: 'var(--fs-xl)' }}>Look around first</h2>
          <p style={{ color: 'var(--graphite)' }}>Get your own private workspace with a sample library and a few teammates. No sign-up.</p>
          <button className="btn primary lg" onClick={() => run('demo', api.demo)} disabled={!!busy}>
            {busy === 'demo' ? 'Setting up your workspace…' : 'Try the demo'}
          </button>
        </div>

        <div className="divider">or</div>

        <form onSubmit={submit} aria-labelledby="form-title">
          <h2 id="form-title" style={{ fontSize: 'var(--fs-l)' }}>
            {mode === 'sign-in' ? 'Sign in' : 'Create a workspace'}
          </h2>
          {mode === 'sign-up' && (
            <>
              <label className="field">
                <span>Your name</span>
                <input className="input" name="name" required maxLength={80} autoComplete="name" />
              </label>
              <label className="field">
                <span>Workspace name</span>
                <input className="input" name="workspace" required maxLength={80} placeholder="e.g. Northwind Studio" />
              </label>
            </>
          )}
          <label className="field">
            <span>Email</span>
            <input className="input" name="email" type="email" required autoComplete="email" />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              name="password"
              type="password"
              required
              minLength={mode === 'sign-up' ? 10 : 1}
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            />
            {mode === 'sign-up' && <small>At least 10 characters.</small>}
          </label>
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          <button className="btn lg" type="submit" disabled={!!busy}>
            {busy === 'form' ? 'One moment…' : mode === 'sign-in' ? 'Sign in' : 'Create workspace'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
              setError(null);
            }}
          >
            {mode === 'sign-in' ? 'New here? Create a workspace' : 'Already have an account? Sign in'}
          </button>
        </form>
      </section>
    </div>
  );
}
