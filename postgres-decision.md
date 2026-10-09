# ADR-001 — Primary Database: PostgreSQL Mandate vs. MongoDB Reality

> **Status:** PROPOSED — awaiting sign-off
> **Date:** 2026-09-27
> **Blueprint clause:** `Masterblueprint(1).md` §45 (Database), §24 (Knowledge/RAG), §46 (Storage)
> **Supersedes:** `needtodo.md` 27.1, `buildscope.md` (neither addresses this)
> **Blocks:** Batch B13 (Platform) items 13.1–13.2; partially gates B8, B9, B10

---

## 1. The question

§45 is unambiguous:

> Primary database: **PostgreSQL**. Vector search: **pgvector**. […] All schema changes use migrations. Never silently alter production schema.

The application is **MongoDB via Mongoose**. This document decides whether to migrate, to substitute, or to record a signed deviation. It does not start work.

---

## 2. Current state (verified on `b1` @ `b5dfc7867`)

| Measure | Value | Probe |
|---|---|---|
| Engine | MongoDB 8.0.20 | `docker-compose.yml:58` |
| Schema files | 57 in `packages/data-schemas/src/schema` (≈50 real models) | dir listing |
| Data-access methods | 94 files, **91,804 lines** | `packages/data-schemas/src/methods` |
| Aggregation pipeline users | 18 files | `rg '\.aggregate'` |
| Transactions | **2 sites only** | `utils/transactions.ts:9`, `methods/mcpAuthority.ts:1638` |
| ORM | **none** — no prisma/drizzle/knex/typeorm/sequelize/`pg` | `rg` |
| Migration system | 4 standalone index functions, no versioned up/down ledger | `src/migrations/` |
| pgvector | **already present** as a sidecar, `pgvector/pgvector:0.8.0-pg15` | `docker-compose.yml:77`, `rag.yml:5` |
| Entity coverage | **7 real tables, 6 embedded/analogue, 28 absent** of §45's 41 | schema audit |
| Transactions in prod shape | audit hash-chain (`prevHash`/`hash`/`seq`), `tenantSafeBulkWrite` | `schema/auditLog.ts` |

### 2.1 What is already done that a migration would preserve

- **Vectors are already in Postgres.** `vectordb` runs pgvector today and backs `packages/api/src/rag/`. §45's vector clause is *not* the gap; the metadata store is.
- **The document-engine subset is already enforced.** Prior work removed every unsupported pipeline-form update and added a static guard (`methods/documentdb.spec.ts`) plus a 509-method live sweep. The Mongoose layer is deliberately constrained to a portable document subset.
- **Flat tenant isolation exists.** `tenantIsolation.ts` plugin + `AsyncLocalStorage` context, fail-closed policy.

### 2.2 What a migration would cost

91,804 lines of method code, 50 models, 18 aggregation-pipeline consumers, and the `tenantIsolation` query plugin that intercepts every read and write. The plugin is the hard part: it rewrites Mongoose queries, so it must be reimplemented against whatever access layer replaces it. Every one of the 509 swept methods would need re-adjudication.

---

## 3. Options

### Option A — Native PostgreSQL + ORM + pgvector (blueprint-literal)

Add Prisma (or Drizzle), define 41 tables, port 50 models and 509 methods, replace the tenant plugin, adopt a real migration ledger.

- **For:** exactly satisfies §45; SQL joins across `messages`/`artifacts`/`citations` become natural; one engine for metadata + vectors, so vector writes join the metadata transaction; `message_parts` (§11) and analytics (§59) become far easier.
- **Against:** largest single change in the entire backlog. 91.8k lines of methods. Rewrites the storage engine out of `packages/data-schemas`' public API, which `CLAUDE.md` explicitly flags as a boundary it is trying to *stop widening*. Touches nearly every module.
- **Risk:** high. Long pole measured in weeks, not batches.

### Option B — FerretDB (Postgres-backed) + existing Mongoose + native pgvector

Keep the Mongoose access layer. Replace the storage engine with FerretDB v2 (`postgres-documentdb`). Vectors live in the **same Postgres instance**.

- **For:** already validated in-repo. `misc/ferretdb/ferretdb-multitenancy-plan.md` records 29 models + 98 custom indexes working on FerretDB v2.7.0, **flat** init/query latency to 100 orgs, **1.11x** write amplification, 88ms/org migration sweeps, verified backup/restore with BSON round-trip. The tenant plugin and all 509 methods keep working. Data physically resides in PostgreSQL; pgvector becomes a first-class extension rather than a sidecar.
- **Against:** the wire protocol is Mongo, so §45's *intent* is met but its letter is not — there are no SQL tables a DBA can query, and no `pg_dump`-able schema without going through FerretDB. Adds a dependency on FerretDB's release cadence.
- **Risk:** medium. Mostly a deployment + connection change, but see the staleness caveat in §5.

### Option C — Retain MongoDB, pgvector sidecar, record a signed deviation

Do nothing structural. Add the 28 missing §45 entities as Mongo models. Vectors stay in the pgvector sidecar, joined by key at query time.

- **For:** zero migration cost. Preserves Mongo 8.0 (Atlas, flexible index management, the `partialFilterExpression` and TTL behavior already relied on). pgvector already works this way in production config today.
- **Against:** directly contradicts §45. Two stores, no cross-store transaction — a knowledge chunk and its embedding can drift. The 28 absent entities are the same work under either option.
- **Risk:** low technically; permanently forecloses one engine for metadata + vector.

---

## 4. Recommendation

**Option B (FerretDB), with Option A's table design adopted incrementally where it earns its keep.**

Rationale:

1. **It is the only option with empirical in-repo evidence.** The FerretDB plan already ran the scaling, deadlock, backup/restore, and migration benchmarks. Option A has none; Option C's status quo has none because nothing is changing.
2. **It converges on §45 rather than deferring it.** After B, PostgreSQL is the system of record and pgvector is in the same cluster — which is what §45 and §24 actually need. Option C leaves them split forever.
3. **It preserves the tenant-isolation guarantee.** The `tenantIsolation` plugin is the one piece of cross-cutting correctness that already works and is fail-closed. Option A must reimplement it; a mistake there is a tenant data leak.
4. **The real §45 gap is entity coverage, not engine.** 28 of 41 entities are absent. That work is identical under A, B, and C and is the part that blocks B8–B13. Engine choice does not unblock a single blueprint feature on its own.

**Explicitly out of scope for B:** no rewrite of `packages/data-schemas` public signatures; no ORM; no port of the 509 methods. The access layer is unchanged.

**What must be recorded as a deviation:** §45's literal "PostgreSQL" is satisfied in substance (Postgres is the store) but not in interface (Mongo wire protocol, no SQL DDL access). That sentence should be amended in a future blueprint version to state the engine *and* the access layer, so the two are not conflated again.

---

## 5. Staleness caveat — must be closed before B13

The FerretDB validation in `misc/ferretdb/` dates from when the schema had **29 models**. The schema directory now holds **57 files (≈50 models)**. Newer additions — `queuedTurn`, `triggerDelivery`, `triggerLaneSequence`, `codeEnvironment`, `mcpAuthority` (transactions), `auditLog` (hash chain) — were never in the validated set.

The `mcpAuthority` transaction is the highest-risk item: FerretDB/Postgres has real transaction semantics where DocumentDB degraded, and the plan notes **deadlocks on `createIndexes(User)`** requiring backoff+retry. Before committing to B, re-run the existing spec suites against FerretDB with the current schema:

| Suite | Purpose |
|---|---|
| `methods/multiTenancy.ferretdb.spec.ts` | 5-phase benchmark |
| `methods/sharding.ferretdb.spec.ts` | Router, isolation, middleware |
| `methods/orgOperations.ferretdb.spec.ts` | Backup/restore, migration, deadlock retry |
| `methods/documentdb.spec.ts` | Static subset guard — must still pass unchanged |

**Gate:** all four green against FerretDB v2 with the current 50-model schema. If any fails, fall back to Option C and record the deviation.

---

## 6. Migration plan (Option B)

Each step is independently shippable. Steps 1–2 are prerequisites for B13; steps 3–5 are B13 content.

| Step | Work | Exit criterion |
|---|---|---|
| **1** | Re-validate the four suites against FerretDB v2 + current schema | All green, or fall back to Option C |
| **2** | Compose: FerretDB + Postgres + **pgvector in the same cluster**; retire the `vectordb` sidecar; keep Mongo-compatible `MONGO_URI` shape | Vectors queryable from the same DB as metadata |
| **3** | Add the 28 missing §45 entities as models in `packages/data-schemas` (orgs, memberships, workspaces, `message_parts`, agents/runs, tools/versions/permissions, memories + embeddings, `knowledge_*`, sources, citations, artifacts + versions, workflows + runs, notifications, devices, subscriptions, usage_records, feedback) | 41/41 entities present |
| **4** | Replace ad-hoc `migrations/` functions with a versioned ledger (up/down, ordered, idempotent) | Re-runnable, rollback-capable |
| **5** | Widen tenant scoping: org → workspace → project hierarchy, private default org for personal users | §57 hierarchy; isolation coverage includes balances, sessions, schedules, memories, audit logs |

Step 5 is genuinely new work under every option — a flat `tenantId` is not §57's five-level hierarchy.

---

## 7. Sign-off

| Field | Value |
|---|---|
| Decision | ☐ A  ☐ **B (recommended)**  ☐ C |
| Deviation from §45 recorded? | ☐ yes — amend blueprint to name engine *and* access layer |
| RPO / RTO defined (§95) | ☐ yes — required before production scale |
| Signed | ______________  Date __________ |

**Consequence of deferring:** B13 items 13.1–13.2 cannot be specified. B8, B9, and B10 can still proceed — they are entity work that is portable across all three options.
