# UPGRADEPROD1 — Production Upgrade Plan & Tracker

Owner: user-approved upgrade wave for baanzonchat.opraiz.com (branch `b1`, auto-deploy via
GH Actions → Runpod pod, health-gated swap). Batches ship in order; each batch:
implement → verify (`tsc --noEmit` in touched workspaces, relevant tests) → commit → push →
CI green → live smoke → mark rows. **Nothing that breaks the live site lands.**

Design direction: **premium / elite / gen-z.** Dark-first, graphite base, one velvet accent,
restraint everywhere. No raw hex in components — tokens only (Batch C).

## Conventions (all batches)
- Subagents implement in the working tree; they do NOT commit/push. Lead verifies, commits, pushes.
- Verify ladder: tsc → sort-imports on touched paths → build → CI green → live site check.
- New client state = Jotai; untouched Recoil atoms stay Recoil, values passed in.
- Secrets only in pod `.env` / GH secrets, never the repo.

Status: `[ ]` pending · `[$]` active · `[x]` done · `[x!]` done w/ deviation (noted inline)

---

## Batch A — API key connection fix  [$]
User symptom: connecting an API key errors (Mistral 401 in logs: server-side fetch with server
key ignores user-provided key). Goals: user keys honored everywhere; readable errors.

## Batch A — API key connection fix  [x!]
User symptom: connecting an API key errors (Mistral 401 in logs: server-side fetch with server
key ignores user-provided key). Goals: user keys honored everywhere; readable errors.

- [x] A1: Audit agents/custom-endpoint key path.
- [x] A2: `user_provided` keys honored for model fetch + completion + title gen; env-key fallback; no false "missing key" throw when only a user key exists.
- [x] A3: ProviderAuthError (provider + 401/403 status) surfaces in sendCompletion/titleConvo instead of "Unhandled error type" (43 error.spec tests).
- [x] A4: static `models.default` fallback when upstream fetch fails/empty (config/models.spec: 66 passed via two suites).
- [ ] A5: Live smoke with a real operator key — deferred to Batch B's Test-provider surface (same need, one place).
Verification: tsc --noEmit packages/api exit 0 (data-provider dist rebuilt for stale-dist false positive).

## Batch B — Custom providers, full  [x!]
- [x] B1: `customEndpoints` config lever (enabled default true, maxUpstreams 8) + guards enforcing on both endpoint-config and models paths.
- [x] B2: Admin Providers management (Settings ▸ General ▸ Admin ▸ Providers): Add/Edit/Delete/Test with live SSRF-validited probe OK/401 inline; YAML fragment output for persistence; admin-gated.
- [x] B3: Endpoint picker + BYO-key dialog verified complete (no gaps).
- [x] B4: modelListCache (2-min TTL, LRU 64, in-flight coalescing) + note that fetchModels already carries a 2-min TTL cache; chat hot path untouched.
- [ ] B5: Live admin smoke on pod after CI deploy.
- Fixes during integration: lever filtering applied to config/models.ts too (race #1); featureFlags block made optional-with-default (27 pre-existing config.spec failures fixed → 405/405).
Deviations: persistence = config-file source of truth (draft → YAML copy); DB-backed provider CRUD deferred.

## Batch C — Design tokens "premium elite"  [x]
- [x] C1–C4: graphite `#0B0B0F` base, surfaces `#15151B`, text `#F5F5F7`/`#A1A1AA`; velvet iris `#8E7CFF` (dark) / `#6D5CE6` (light) accents; `--brand-sig-gradient` champagne→iris token added. Subtle/border/status/series/syntax families re-based onto graphite; gizmo themes left except removed references. Guardrails: semanticTokens.spec 54/54, highContrast.spec 36/36. Contrast: light ink/white and accents verified by subagent report; dark text pairs ≥4.5:1.

## Batch D — Core surfaces  [x]
- [x] D1: Composer focus signal (iris border+halo via composerSurfaceClasses), streaming filament (`composer-sig-streaming`, incl. reduce guard), picker polish verified.
- [x] D2: small-caps author chips (MessageRow/AuthorHeader), hover actions verified present.
- [x] D3: search puck on graphite, iris active-row marker, ≥44px touch on clear button.
- [x] D4: search-empty state row (new `com_ui_no_search_results_hint` key), destructive confirms verified upstream.
- [x] D5: 320px rows h-12, focus-visible verified, new motion reduce-guarded.
Verification: tsc client + packages/client exit 0; jest: 6 client suites 49/49 + composer.spec 3/3.

## Batch E — UI intelligence  [ ]
- [ ] E1: ⌘K command palette (nav/endpoints/model switch/prompts).
- [ ] E2: Prompt library + slash-commands inline.
- [ ] E3: Adaptive hints: cost/latency chip by model picker; per-session last endpoint recall.
- [ ] E4: First-run tooltip ladder (≤4, dismissable, persisted).

## Batch F — Polish + final report  [ ]
- [ ] F1: cross-batch QA sweep (spacing/motion), a11y audit (accessibility lens), perf check.
- [ ] F2: full regression + live checks + final fill + full report to user.

---
## Session log
- Wave opened after auto-deploy proven green (run 40713970284).
