import { SystemRoles } from 'librechat-data-provider';
import type { KnowledgeCollection, CollectionScope } from './types';
import type { RagActor } from './authorization';
import { canAccessCollection, canWriteCollection, canUseScope } from './authorization';

const OWNER = 'user-owner';
const OTHER = 'user-other';

const ADMIN: RagActor = { role: SystemRoles.ADMIN };
const USER: RagActor = { role: SystemRoles.USER };

/** A retired / never-written scope value, as an old Mongo row could still carry. */
const retiredScope = (value: string) => value as unknown as CollectionScope;

function collection(overrides: Partial<KnowledgeCollection> = {}): KnowledgeCollection {
  return {
    id: 'col-1',
    userId: OWNER,
    name: 'notes',
    scope: 'private',
    chunkSize: 128,
    chunkOverlap: 12,
    documentCount: 0,
    chunkCount: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('canAccessCollection', () => {
  it('lets the owner read their own private collection', () => {
    expect(canAccessCollection(OWNER, collection({ scope: 'private' }))).toBe(true);
  });

  it('lets the owner read their own global collection', () => {
    expect(canAccessCollection(OWNER, collection({ scope: 'global' }))).toBe(true);
  });

  it('lets a non-owner read a global collection', () => {
    expect(canAccessCollection(OTHER, collection({ scope: 'global' }))).toBe(true);
  });

  it('refuses a non-owner the private collection', () => {
    expect(canAccessCollection(OTHER, collection({ scope: 'private' }))).toBe(false);
  });

  it('treats a retired scope on a non-owned collection as owner-only, so it is refused', () => {
    const legacy = collection({ scope: retiredScope('project') });
    expect(canAccessCollection(OTHER, legacy)).toBe(false);
    expect(canAccessCollection(OWNER, legacy)).toBe(true);
  });
});

describe('canWriteCollection', () => {
  it('lets the owner write their private collection', () => {
    expect(canWriteCollection(OWNER, collection({ scope: 'private' }))).toBe(true);
  });

  it('lets the owner write their global collection', () => {
    expect(canWriteCollection(OWNER, collection({ scope: 'global' }))).toBe(true);
  });

  it('refuses a non-owner even when the collection is global and readable', () => {
    const shared = collection({ scope: 'global' });
    expect(canAccessCollection(OTHER, shared)).toBe(true);
    expect(canWriteCollection(OTHER, shared)).toBe(false);
  });

  it('refuses a non-owner a private collection', () => {
    expect(canWriteCollection(OTHER, collection({ scope: 'private' }))).toBe(false);
  });
});

describe('canUseScope', () => {
  it('permits private for every role, including the absent actor', () => {
    expect(canUseScope('private', ADMIN)).toBe(true);
    expect(canUseScope('private', USER)).toBe(true);
    expect(canUseScope('private', undefined)).toBe(true);
  });

  it('permits global only for an admin', () => {
    expect(canUseScope('global', ADMIN)).toBe(true);
    expect(canUseScope('global', USER)).toBe(false);
    expect(canUseScope('global', undefined)).toBe(false);
  });

  it('refuses global for an unrecognised role', () => {
    expect(canUseScope('global', { role: 'SUPERUSER' })).toBe(false);
    expect(canUseScope('global', {})).toBe(false);
  });

  it('fails closed for a retired scope, for every role', () => {
    expect(canUseScope(retiredScope('project'), ADMIN)).toBe(false);
    expect(canUseScope(retiredScope('project'), USER)).toBe(false);
    expect(canUseScope(retiredScope('project'), undefined)).toBe(false);
  });

  it('fails closed for an arbitrary unknown scope', () => {
    expect(canUseScope(retiredScope(''), ADMIN)).toBe(false);
    expect(canUseScope(retiredScope('tenant'), ADMIN)).toBe(false);
  });
});
