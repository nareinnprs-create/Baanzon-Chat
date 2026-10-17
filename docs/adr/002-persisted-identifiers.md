# ADR-002: Freeze Persisted Identifiers

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

Baanzon Chat is a fork of LibreChat. Several string identifiers are **persisted**:
they are written directly into MongoDB documents and/or crossed the wire into
stored message records. Examples include file MIME types used as map keys,
knowledge-collection scopes (`private` / `global`), file storage enums, tool
resource enums, and `Symbol.for(...)` keys in the global Node symbol registry.

Because these values are stored (not merely referenced in code), renaming a
constant and its literal value silently breaks existing rows: reads miss,
comparisons fail, and previously stored records become unreachable. There is no
versioned migration ledger to catch the breakage.

## Decision

Persisted identifiers are **frozen**. Once a string identifier is written to
storage or crossed the wire into a persisted record, its literal value MUST NOT
be renamed in place. A rename requires an explicit, versioned **data migration**
that rewrites every existing row plus a **backfill**/back-compat read path that
honors the old value during the transition. New identifiers are **additive**:
introduce a new value alongside the old one rather than mutating an existing one.

## Consequences

- Rename PRs that touch a persisted identifier MUST carry a data migration and
  back-compat read path; a rename without one is grounds for rejection.
- Additive changes (new enum members, new MIME types) remain cheap and are the
  preferred path.
- Concrete frozen identifiers (verified by grep):
  - **Artifact preview MIME types** used as map keys and stored on message
    records — `application/vnd.librechat.docx-preview`,
    `application/vnd.librechat.spreadsheet-preview`,
    `application/vnd.librechat.presentation-preview`:
    `client/src/utils/artifacts.ts:20-22,57-59,155-157,298-300`.
  - **Knowledge collection scope** `TKnowledgeCollectionScope = 'private' | 'global'`
    (`packages/data-provider/src/types/knowledge.ts:17`) and its server mirror
    `CollectionScope = 'private' | 'global'`
    (`packages/api/src/rag/types.ts:29`); persisted as `scope` on
    `KnowledgeCollection` (`packages/api/src/rag/types.ts:45`).
  - **File storage enum** `FileSources` (e.g. `local`, `s3`, `azure_blob`,
    `vectordb`, `mistral_ocr`) — `packages/data-provider/src/types/files.ts:5-17`;
    validated for DB records via `fileSourceSchema`
    (`packages/data-provider/src/config.ts:114`).
  - **Tool resource enum** `EToolResources` (e.g. `file_search`, `context`,
    `execute_code`) persisted as `tool_resource` on file metadata —
    `packages/data-provider/src/types/assistants.ts:40-47`.
  - **Global symbol registry keys** used for runtime grant lookups —
    `Symbol.for('librechat.credentials.runtime')`
    (`packages/api/src/credentials.ts:43`) and
    `Symbol.for('librechat.toolRoleGrants')`
    (`packages/api/src/tools/rolePermissions.ts:248`); renaming orphans grants
    held by any live process.
