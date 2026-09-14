/**
 * RAG / Knowledge domain — request validation.
 * Lightweight manual validators (no dependency) returning error strings.
 */
import type { KnowlEdgeCollection, CollectionScope } from './types';

const NAME_MAX = 64;
const DESC_MAX = 512;
const CONTENT_MAX = 400_000;
const QUERY_MAX = 2_000;

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateCreateCollection(body: Record<string, unknown>): ValidationResult {
  const name = clean(body.name);
  if (name.length === 0) {
    return { ok: false, error: 'name is required' };
  }
  if (name.length > NAME_MAX) {
    return { ok: false, error: `name must be <= ${NAME_MAX} characters` };
  }
  if (body.description !== undefined) {
    const d = clean(body.description);
    if (d.length > DESC_MAX) {
      return { ok: false, error: `description must be <= ${DESC_MAX} characters` };
    }
  }
  if (body.scope !== undefined && !['private', 'project', 'global'].includes(body.scope as string)) {
    return { ok: false, error: 'scope must be one of: private, project, global' };
  }
  return { ok: true };
}

export function validateAddDocument(body: Record<string, unknown>): ValidationResult {
  const collectionId = clean(body.collectionId);
  if (!collectionId) {
    return { ok: false, error: 'collectionId is required' };
  }
  const content = clean(body.content);
  if (!content) {
    return { ok: false, error: 'content is required' };
  }
  if (content.length > CONTENT_MAX) {
    return { ok: false, error: `content must be <= ${CONTENT_MAX} characters` };
  }
  return { ok: true };
}

export function validateRetrieve(body: Record<string, unknown>): ValidationResult {
  const collectionId = clean(body.collectionId);
  if (!collectionId) {
    return { ok: false, error: 'collectionId is required' };
  }
  const query = clean(body.query);
  if (!query) {
    return { ok: false, error: 'query is required' };
  }
  if (query.length > QUERY_MAX) {
    return { ok: false, error: `query must be <= ${QUERY_MAX} characters` };
  }
  return { ok: true };
}

export function validateCollectionPatch(body: Record<string, unknown>): ValidationResult {
  const name = body.name !== undefined ? clean(body.name) : null;
  if (name !== null && (name.length === 0 || name.length > NAME_MAX)) {
    return { ok: false, error: `name must be 1..${NAME_MAX} characters` };
  }
  return { ok: true };
}
