import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useMe } from '../lib/session';
import { Wordmark } from '../components/Wordmark';

export function AcceptInvite() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => api.invitePreview(token), retry: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    const f = e ? new FormData(e.currentTarget) : null;
    setBusy(true);
    setError(null);
    try {
      await api.acceptInvite({ token, name: f ? String(f.get('name')) : undefined, password: f ? String(f.get('password')) : undefined });
      qc.clear();
      navigate('/library');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not accept the invite.');
    } finally {
      setBusy(false);
    }
  }

  if (invite.isLoading) return <p className="center">Checking your invite…</p>;
  if (invite.error || !invite.data) {
    return (
      <div className="center">
        <div>
          <Wordmark size={40} />
          <h1 style={{ fontSize: 'var(--fs-xl)' }}>This invite can’t be used</h1>
          <p style={{ color: 'var(--graphite)' }}>It may have expired or already been accepted. Ask for a new one.</p>
        </div>
      </div>
    );
  }
  const inv = invite.data;

  return (
    <div className="center">
      <div style={{ maxWidth: 400, width: '100%', justifyItems: 'stretch', textAlign: 'left' }}>
        <Wordmark size={40} />
        <h1 style={{ fontSize: 'var(--fs-xl)' }}>Join {inv.workspaceName}</h1>
        <p style={{ color: 'var(--graphite)' }}>
          You’ve been invited as {inv.role === 'admin' ? 'an' : 'a'} {inv.role}, using {inv.email}.
        </p>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        {me ? (
          me.user.email === inv.email ? (
            <button className="btn primary lg" onClick={() => accept()} disabled={busy}>
              Join workspace
            </button>
          ) : (
            <p className="notice">You’re signed in as {me.user.email}. Sign out, then open this link again as {inv.email}.</p>
          )
        ) : inv.hasAccount ? (
          <Link className="btn primary lg" to="/welcome">
            Sign in to accept
          </Link>
        ) : (
          <form onSubmit={accept} style={{ display: 'grid', gap: 12 }}>
            <label className="field">
              <span>Your name</span>
              <input className="input" name="name" required maxLength={80} autoComplete="name" />
            </label>
            <label className="field">
              <span>Choose a password</span>
              <input className="input" name="password" type="password" minLength={10} required autoComplete="new-password" />
              <small>At least 10 characters.</small>
            </label>
            <button className="btn primary lg" disabled={busy}>
              Create account and join
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
