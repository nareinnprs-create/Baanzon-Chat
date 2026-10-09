import type { TKnowledgeCollection } from 'librechat-data-provider';
import { canWriteKnowledgeCollection } from '../state';

const collection: TKnowledgeCollection = {
  id: 'collection-1',
  userId: 'user-1',
  name: 'Handbook',
  description: 'Onboarding material',
  scope: 'private',
  chunkSize: 800,
  chunkOverlap: 80,
  documentCount: 3,
  chunkCount: 12,
  createdAt: '2026-01-02T10:00:00.000Z',
  updatedAt: '2026-01-03T10:00:00.000Z',
};

describe('canWriteKnowledgeCollection', () => {
  it('follows the server rule exactly, which is ownership and nothing else', () => {
    /** `canWriteCollection` in `packages/api/src/rag/authorization.ts` is
     *  `collection.userId === userId`. It does not consult the scope, and neither
     *  may this: a `global` collection is *readable* by everyone, so a rule that
     *  granted writes by scope would offer a non-owner three controls that each
     *  answer 403. */
    expect(canWriteKnowledgeCollection(collection, 'user-1')).toBe(true);
    expect(canWriteKnowledgeCollection({ ...collection, scope: 'global' }, 'user-1')).toBe(true);
    expect(canWriteKnowledgeCollection({ ...collection, scope: 'global' }, 'user-2')).toBe(false);
    expect(canWriteKnowledgeCollection(collection, 'user-2')).toBe(false);
  });

  it('refuses every write while the signed-in user is unknown', () => {
    /** The auth context resolves after the first render, so a collection and its
     *  card can be on screen before there is a user id to compare. Treating that
     *  window as "the owner" put a live row menu on every card for a frame and
     *  produced a 403 for whoever it was; treating it as "cannot write" costs
     *  nothing and the controls appear as soon as the answer is known. */
    expect(canWriteKnowledgeCollection(collection, undefined)).toBe(false);
    expect(canWriteKnowledgeCollection(collection, null)).toBe(false);
    expect(canWriteKnowledgeCollection(collection, '')).toBe(false);
  });

  it('does not match a collection with no owner against an empty user id', () => {
    /** The other half of the same guard: a row that somehow lost its `userId` must
     *  not become writable because both sides are empty. */
    expect(canWriteKnowledgeCollection({ ...collection, userId: '' }, '')).toBe(false);
  });
});
