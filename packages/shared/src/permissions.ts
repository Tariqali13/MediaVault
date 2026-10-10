/**
 * Role-based access control, shared by the API (enforcement) and the web app
 * (hiding what you can't do). One table, so the two can never disagree.
 */
export const ROLES = ['viewer', 'editor', 'admin', 'owner'] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  'asset.read',
  'asset.download',
  'asset.upload',
  'asset.edit',
  'asset.trash',
  'asset.restore',
  'asset.purge',
  'collection.read',
  'collection.manage',
  'share.create',
  'share.revoke',
  'member.read',
  'member.invite',
  'member.changeRole',
  'member.remove',
  'audit.read',
  'workspace.rename',
] as const;
export type Action = (typeof ACTIONS)[number];

const VIEWER: Action[] = ['asset.read', 'asset.download', 'collection.read', 'member.read'];
const EDITOR: Action[] = [
  ...VIEWER,
  'asset.upload',
  'asset.edit',
  'asset.trash',
  'asset.restore',
  'collection.manage',
  'share.create',
  'share.revoke',
];
const ADMIN: Action[] = [...EDITOR, 'asset.purge', 'member.invite', 'member.changeRole', 'member.remove', 'audit.read'];
const OWNER: Action[] = [...ADMIN, 'workspace.rename'];

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  viewer: new Set(VIEWER),
  editor: new Set(EDITOR),
  admin: new Set(ADMIN),
  owner: new Set(OWNER),
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[role].has(action);
}

export const roleRank = (role: Role) => ROLES.indexOf(role);

/**
 * Who may assign which role to whom. Admins manage everyone below them;
 * nobody can promote someone to a role above their own, and owners are only
 * changed by an owner.
 */
export function canAssignRole(actor: Role, targetCurrent: Role, targetNext: Role): boolean {
  if (!can(actor, 'member.changeRole')) return false;
  if (actor === 'owner') return true;
  return roleRank(targetCurrent) < roleRank(actor) && roleRank(targetNext) < roleRank(actor);
}
