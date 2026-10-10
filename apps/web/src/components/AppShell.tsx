import { NavLink, Navigate, Outlet, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatBytes } from '../lib/api';
import { useCan, useMe, useSignedIn } from '../lib/session';
import { UploadProvider } from './Uploads';
import { Wordmark } from './Wordmark';

export function AppShell() {
  const { data: me, isLoading } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const signedIn = useSignedIn();
  const { data: usage } = useQuery({ queryKey: ['usage'], queryFn: api.usage, enabled: !!me?.activeWorkspaceId });
  const canSeeAudit = useCan('audit.read');

  if (isLoading) return <p className="center">Opening your library…</p>;
  if (!me) return <Navigate to="/welcome" replace />;

  const pct = usage ? Math.min(100, (usage.storageBytes / usage.quotaBytes) * 100) : 0;

  async function switchTo(workspaceId: string) {
    signedIn(await api.switchWorkspace(workspaceId));
    navigate('/library');
  }

  async function signOut() {
    await api.signOut().catch(() => undefined);
    qc.clear();
    navigate('/welcome');
  }

  return (
    <UploadProvider>
      <div className="shell">
        <aside className="rail">
          <NavLink to="/library" className="wordmark" aria-label="MediaVault library">
            <Wordmark />
            MediaVault
          </NavLink>

          {me.workspaces.length > 1 ? (
            <label className="field">
              <span className="sr-only">Workspace</span>
              <select className="select" value={me.activeWorkspaceId ?? ''} onChange={(e) => switchTo(e.target.value)}>
                {me.workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div style={{ padding: '0 10px', fontWeight: 700 }}>{usage?.name ?? me.workspaces[0]?.name}</div>
          )}

          <nav aria-label="Workspace">
            <NavLink to="/library">
              Library <small>{usage ? sum(usage.counts) : ''}</small>
            </NavLink>
            <NavLink to="/collections">Collections</NavLink>
            <NavLink to="/shared">Shared links</NavLink>
            <NavLink to="/trash">
              Trash <small>{usage?.trashed || ''}</small>
            </NavLink>
            <NavLink to="/people">People</NavLink>
            {canSeeAudit && <NavLink to="/activity">Activity</NavLink>}
          </nav>

          <div className="rail-foot">
            {usage && (
              <div style={{ display: 'grid', gap: 6 }}>
                <div className="meter" role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
                  <i style={{ width: `${pct}%` }} />
                </div>
                <span style={{ color: 'var(--graphite)' }}>
                  {formatBytes(usage.storageBytes)} of {formatBytes(usage.quotaBytes)} used
                </span>
              </div>
            )}
            <div className="who">
              <span title={me.user.email}>{me.user.name}</span>
              <button className="btn ghost" onClick={signOut}>
                Sign out
              </button>
            </div>
          </div>
        </aside>

        <main className="main">
          {usage?.isDemo && (
            <div className="demo-banner" role="note">
              <span>This is your own private demo workspace. Upload, delete and invite freely; it’s deleted after 24 hours.</span>
              <a href="https://github.com/Tariqali13/MediaVault">How it’s built</a>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </UploadProvider>
  );
}

const sum = (counts: Record<string, number | undefined>) => Object.values(counts).reduce<number>((a, b) => a + (b ?? 0), 0);
