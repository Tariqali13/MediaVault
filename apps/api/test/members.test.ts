import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, harness, signUp, testJpeg, upload, type Harness } from './helpers.js';

let h: Harness;
let owner: Awaited<ReturnType<typeof signUp>>;

beforeAll(async () => {
  h = await harness();
});
afterAll(() => h.close());
beforeEach(async () => {
  await h.reset();
  owner = await signUp(h.app, 'Olga', 'Team Studio');
});

/** Invite someone with a role and have them create an account through the link. */
async function addMember(role: 'viewer' | 'editor' | 'admin', name: string) {
  const email = `${name.toLowerCase()}@example.com`;
  const invite = await owner.client.post('/invites', { email, role });
  expect(invite.status).toBe(201);
  const token = invite.body.url.split('/invite/')[1];
  const c = new Client(h.app);
  const preview = await c.get(`/public/invites/${token}`);
  expect(preview.body).toMatchObject({ workspaceName: 'Team Studio', role, hasAccount: false });
  const accepted = await c.post('/public/invites/accept', { token, name, password: 'a long enough password' });
  expect(accepted.status).toBe(200);
  const me = await c.get('/auth/me');
  return { client: c, userId: me.body.user.id as string, token };
}

describe('roles are enforced by the API', () => {
  it('viewers can browse and download but not upload, edit or share', async () => {
    const { assetId } = await upload(h.app, owner.client, await testJpeg());
    const viewer = await addMember('viewer', 'Vera');
    expect((await viewer.client.get('/assets')).body.items).toHaveLength(1);
    expect((await viewer.client.get(`/assets/${assetId}/download`)).status).toBe(200);
    expect((await viewer.client.post('/assets/uploads', { fileName: 'x.jpg', contentType: 'image/jpeg', size: 10 })).status).toBe(403);
    expect((await viewer.client.patch(`/assets/${assetId}`, { title: 'x' })).status).toBe(403);
    expect((await viewer.client.post('/shares', { assetId })).status).toBe(403);
    expect((await viewer.client.get('/audit')).status).toBe(403);
  });

  it('editors can upload but cannot purge or manage people', async () => {
    const editor = await addMember('editor', 'Eddie');
    const { assetId } = await upload(h.app, editor.client, await testJpeg());
    await editor.client.post('/assets/trash', { ids: [assetId] });
    expect((await editor.client.del(`/assets/${assetId}`)).status).toBe(403);
    expect((await editor.client.post('/invites', { email: 'x@example.com', role: 'viewer' })).status).toBe(403);
  });

  it('admins manage roles below their own, but cannot create admins or touch owners', async () => {
    const admin = await addMember('admin', 'Ada');
    const viewer = await addMember('viewer', 'Vic');
    expect((await admin.client.patch(`/members/${viewer.userId}`, { role: 'editor' })).status).toBe(200);
    expect((await admin.client.patch(`/members/${viewer.userId}`, { role: 'admin' })).status).toBe(403);
    expect((await admin.client.patch(`/members/${owner.userId}`, { role: 'viewer' })).status).toBe(403);
    expect((await admin.client.post('/invites', { email: 'boss@example.com', role: 'admin' })).status).toBe(403);
  });

  it('a removed member loses access immediately, without signing out', async () => {
    const editor = await addMember('editor', 'Erin');
    expect((await editor.client.get('/assets')).status).toBe(200);
    await owner.client.del(`/members/${editor.userId}`);
    expect((await editor.client.get('/assets')).status).toBe(403);
  });

  it('a workspace always keeps at least one owner', async () => {
    expect((await owner.client.patch(`/members/${owner.userId}`, { role: 'admin' })).body.error.code).toBe('last_owner');
    expect((await owner.client.del(`/members/${owner.userId}`)).body.error.code).toBe('last_owner');
  });
});

describe('invites', () => {
  it('can only be used once', async () => {
    const { token } = await addMember('viewer', 'Una');
    const again = await new Client(h.app).post('/public/invites/accept', { token, name: 'Una', password: 'a long enough password' });
    expect(again.status).toBe(404);
  });

  it('existing accounts must sign in first, as the invited email', async () => {
    const other = await signUp(h.app, 'Pat', 'Pat Studio');
    const invite = await owner.client.post('/invites', { email: other.email, role: 'editor' });
    const token = invite.body.url.split('/invite/')[1];
    expect((await new Client(h.app).post('/public/invites/accept', { token })).body.error.code).toBe('sign_in_first');
    const wrongPerson = await signUp(h.app, 'Quinn', 'Q Studio');
    expect((await wrongPerson.client.post('/public/invites/accept', { token })).body.error.code).toBe('wrong_account');
    expect((await other.client.post('/public/invites/accept', { token })).status).toBe(200);
    const me = await other.client.get('/auth/me');
    expect(me.body.workspaces.map((w: { name: string }) => w.name).sort()).toEqual(['Pat Studio', 'Team Studio']);
    expect(me.body.activeWorkspaceId).toBe(owner.workspaceId);
  });

  it('switching workspace only works for workspaces you belong to', async () => {
    const stranger = await signUp(h.app, 'Sam', 'Elsewhere');
    expect((await stranger.client.post('/workspaces/switch', { workspaceId: owner.workspaceId })).status).toBe(404);
  });
});
