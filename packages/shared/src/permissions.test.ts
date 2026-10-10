import { describe, expect, it } from 'vitest';
import { ACTIONS, ROLES, can, canAssignRole, type Action, type Role } from './permissions.js';

/**
 * The whole matrix, written out. If someone changes a permission, this table
 * has to change too, which makes access changes deliberate and reviewable.
 */
const EXPECTED: Record<Action, Role[]> = {
  'asset.read': ['viewer', 'editor', 'admin', 'owner'],
  'asset.download': ['viewer', 'editor', 'admin', 'owner'],
  'asset.upload': ['editor', 'admin', 'owner'],
  'asset.edit': ['editor', 'admin', 'owner'],
  'asset.trash': ['editor', 'admin', 'owner'],
  'asset.restore': ['editor', 'admin', 'owner'],
  'asset.purge': ['admin', 'owner'],
  'collection.read': ['viewer', 'editor', 'admin', 'owner'],
  'collection.manage': ['editor', 'admin', 'owner'],
  'share.create': ['editor', 'admin', 'owner'],
  'share.revoke': ['editor', 'admin', 'owner'],
  'member.read': ['viewer', 'editor', 'admin', 'owner'],
  'member.invite': ['admin', 'owner'],
  'member.changeRole': ['admin', 'owner'],
  'member.remove': ['admin', 'owner'],
  'audit.read': ['admin', 'owner'],
  'workspace.rename': ['owner'],
};

describe('permission matrix', () => {
  for (const action of ACTIONS) {
    for (const role of ROLES) {
      const allowed = EXPECTED[action].includes(role);
      it(`${role} ${allowed ? 'can' : 'cannot'} ${action}`, () => expect(can(role, action)).toBe(allowed));
    }
  }
});

describe('role assignment', () => {
  it('admins manage roles below their own', () => {
    expect(canAssignRole('admin', 'viewer', 'editor')).toBe(true);
    expect(canAssignRole('admin', 'editor', 'viewer')).toBe(true);
  });
  it('admins cannot create other admins, or touch admins and owners', () => {
    expect(canAssignRole('admin', 'editor', 'admin')).toBe(false);
    expect(canAssignRole('admin', 'admin', 'viewer')).toBe(false);
    expect(canAssignRole('admin', 'owner', 'viewer')).toBe(false);
  });
  it('owners can assign anything; editors and viewers nothing', () => {
    expect(canAssignRole('owner', 'admin', 'owner')).toBe(true);
    expect(canAssignRole('editor', 'viewer', 'viewer')).toBe(false);
    expect(canAssignRole('viewer', 'viewer', 'viewer')).toBe(false);
  });
});
