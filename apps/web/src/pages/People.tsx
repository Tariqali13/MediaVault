import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { canAssignRole, ROLES, type Role } from '@mediavault/shared';
import { api, ApiError, formatDate } from '../lib/api';
import { useCan, useMe, useRole } from '../lib/session';

const ROLE_HELP: Record<Role, string> = {
  viewer: 'Can browse and download',
  editor: 'Can also upload, edit, organise and share',
  admin: 'Can also manage people and see activity',
  owner: 'Full control of the workspace',
};

export function People() {
  const qc = useQueryClient();
  const myRole = useRole();
  const { data: me } = useMe();
  const canInvite = useCan('member.invite');
  const { data: members } = useQuery({ queryKey: ['members'], queryFn: api.members });
  const { data: invites } = useQuery({ queryKey: ['invites'], queryFn: api.invites, enabled: canInvite });
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await Promise.all([qc.invalidateQueries({ queryKey: ['members'] }), qc.invalidateQueries({ queryKey: ['invites'] })]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That didn’t work.');
    }
  }

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await act(async () => {
      const res = await api.invite(String(f.get('email')), String(f.get('role')) as Role);
      setLink(res.url);
      form.reset();
    });
  }

  const assignable = (current: Role) => ROLES.filter((r) => myRole && (r === current || canAssignRole(myRole, current, r)));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p>Who can see and change this workspace. Roles are enforced by the server on every request.</p>
        </div>
      </div>

      {error && (
        <p className="notice" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}

      {canInvite && (
        <form className="panel invite-form" onSubmit={invite} style={{ marginBottom: 20 }}>
          <label className="field">
            <span>Invite by email</span>
            <input className="input" name="email" type="email" required placeholder="name@studio.com" />
          </label>
          <label className="field">
            <span>Role</span>
            <select className="select" name="role" defaultValue="editor">
              {(['viewer', 'editor', 'admin'] as const)
                .filter((r) => myRole && canAssignRole(myRole, 'viewer', r))
                .map((r) => (
                  <option key={r} value={r}>
                    {r[0]!.toUpperCase() + r.slice(1)}
                  </option>
                ))}
            </select>
          </label>
          <button className="btn primary">Create invite link</button>
          {link && (
            <div className="copy" style={{ gridColumn: '1 / -1' }}>
              <input className="input" readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
              <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(link)}>
                Copy
              </button>
            </div>
          )}
          {link && (
            <small style={{ gridColumn: '1 / -1', color: 'var(--graphite)' }}>
              Send this link to them. It works once and expires in 7 days. (This demo doesn’t send email.)
            </small>
          )}
        </form>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Joined</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members?.map((m) => {
            const options = assignable(m.role);
            const isMe = m.userId === me?.user.id;
            return (
              <tr key={m.userId}>
                <td>
                  <strong>
                    {m.name}
                    {isMe ? ' (you)' : ''}
                  </strong>
                  <div style={{ color: 'var(--graphite)' }}>{m.email}</div>
                </td>
                <td>
                  {options.length > 1 && !isMe ? (
                    <select
                      className="select"
                      style={{ width: 'auto' }}
                      value={m.role}
                      aria-label={`Role for ${m.name}`}
                      onChange={(e) => act(() => api.changeRole(m.userId, e.target.value as Role))}
                    >
                      {options.map((r) => (
                        <option key={r} value={r}>
                          {r[0]!.toUpperCase() + r.slice(1)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span title={ROLE_HELP[m.role]}>{m.role[0]!.toUpperCase() + m.role.slice(1)}</span>
                  )}
                </td>
                <td>{formatDate(m.joinedAt)}</td>
                <td style={{ textAlign: 'right' }}>
                  {canInvite && !isMe && options.length > 1 && (
                    <button className="btn danger" onClick={() => window.confirm(`Remove ${m.name} from the workspace?`) && act(() => api.removeMember(m.userId))}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {canInvite && invites && invites.length > 0 && (
        <>
          <h2 style={{ fontSize: 'var(--fs-l)', margin: '28px 0 10px' }}>Waiting to join</h2>
          <table className="table">
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>{i.role}</td>
                  <td>Expires {formatDate(i.expiresAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn ghost" onClick={() => act(() => api.cancelInvite(i.id))}>
                      Cancel invite
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <dl className="meta" style={{ marginTop: 28, maxWidth: 520 }}>
        {ROLES.map((r) => (
          <Row key={r} label={r[0]!.toUpperCase() + r.slice(1)} value={ROLE_HELP[r]} />
        ))}
      </dl>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
