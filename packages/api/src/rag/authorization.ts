/**
 * RAG / Knowledge domain — collection authorization.
 * Ownership is the default rule; `global` collections are readable
 * by any authenticated user but only writable by their owner.
 */
import { SystemRoles } from 'librechat-data-provider';
import type { KnowledgeCollection, CollectionScope } from './types';

/**
 * The caller's authorization context. The service has no session and cannot
 * read one, so the layer that owns the request supplies it: the Knowledge
 * router is mounted behind `requireJwtAuth`, whose `req.user` is the passport
 * user document, and that document carries `role` as a `SystemRoles` value.
 *
 * Every field is optional so an absent context reads as the *least* privileged
 * case. A caller that forgets to pass one is then refused `global` rather than
 * granted it, which is the only direction a default can be wrong in safely.
 */
export interface RagActor {
  role?: string;
}

export function canAccessCollection(userId: string, collection: KnowledgeCollection): boolean {
  if (collection.userId === userId) {
    return true;
  }
  return collection.scope === 'global';
}

export function canWriteCollection(userId: string, collection: KnowledgeCollection): boolean {
  return collection.userId === userId;
}

/**
 * Whether `actor` may put a collection into `scope`.
 *
 * `private` is open to every authenticated user. It is the default, and a
 * collection only its owner can see or write is nobody else's business, so
 * gating it would block the ordinary case to protect nothing.
 *
 * `global` is admin-only. It hands the collection to every member of the
 * tenant, so choosing it is a decision about *other* people's access rather
 * than about the caller's own data — and it is not one a user can take back,
 * because from the moment it is set the content is readable by everyone.
 *
 * Everything else is refused: `project`, which visibility does not honour and
 * which therefore reads back exactly like `private` — a control that silently
 * does nothing — and any unknown scope from a caller that skipped
 * `validation.ts`. Failing closed is the point: this is the seam a direct
 * `service.createCollection` call goes through, so an unlisted scope must not
 * become permissive merely because nobody wrote a `case` for it.
 *
 * The `userId` this used to take was never read. The rule is about the
 * caller's role, so the parameter is gone rather than left behind as a second
 * argument that looks like it takes part in the decision.
 */
export function canUseScope(scope: CollectionScope, actor?: RagActor): boolean {
  switch (scope) {
    case 'private':
      return true;
    case 'global':
      return actor?.role === SystemRoles.ADMIN;
    default:
      return false;
  }
}
