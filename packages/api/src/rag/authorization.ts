/**
 * RAG / Knowledge domain — collection authorization.
 * Ownership is the default rule; `global` collections are readable
 * by any authenticated user but only writable by their owner.
 */
import type { KnowlEdgeCollection, CollectionScope } from './types';

export function canAccessCollection(userId: string, collection: KnowlEdgeCollection): boolean {
  if (collection.userId === userId) {
    return true;
  }
  return collection.scope === 'global';
}

export function canWriteCollection(userId: string, collection: KnowlEdgeCollection): boolean {
  return collection.userId === userId;
}

export function canUseScope(userId: string, scope: CollectionScope): boolean {
  switch (scope) {
    case 'private':
    case 'project':
    case 'global':
      return true;
    default:
      return false;
  }
}
