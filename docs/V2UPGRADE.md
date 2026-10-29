# V2UPGRADE — Banzon Chat: Full Product + Interface Rebuild Plan

Status: `PENDING APPROVAL` · Branch: `b1` · Auto-deploy: GH Actions → Runpod pod (health-gated)
Execution model: batches, each = implement → tsc/tests → commit → push → CI green → live smoke →
mark row. Subagents where quota allows; lead integrates + commits. Site stays live throughout.

Goal: a **premium, easy-to-use, ground-breaking** chat product that beats ChatGPT and Claude on
web: a new interface (Monolith) + an intelligence layer (Cortex) + the product foundations they
assume (accounts, uploads, sharing, mobile, PWA).

---

## Design system — "Monolith" (solid, no glass)

- Graphite tone-steps: `#0B0B0F` canvas → `#15151B` surface → `#1B1B22` elevated; hairline borders `#232329`; depth = tone + elevation, never blur/translucency.
- Accent: velvet iris `#8E7CFF` (dark) / `#6D5CE6` (light) — from UPGRADEPROD1 Batch C tokens (reused).
- Signature: **iris thread** — solid 2px line running composer→response while streaming, gradient sweep, parks on completion.
- Typography: display face for exactly 3 moments (wordmark, empty-state greeting, section rails); body Inter. Decision pending: Sora vs Gabarito vs Inter-only.
- Motion: springs (translate apple-motion guidance), every animation reduce-motion guarded.
- A11y floor: keyboard-complete, focus-visible everywhere, 44px touch targets, contrast ≥4.5:1 text, dark-first + derived light.

## Intelligence layer — "Cortex" (differentiators vs ChatGPT/Claude)

| # | Feature | Notes |
|---|---|---|
| X1 Model Arena | one prompt → 2–3 models side-by-side, vote, continue with winner | client-only routing, existing endpoints |
| X2 Branch tree | visible conversation tree; click node to rewind/branch | branches exist in schema; UI only |
| X3 Context meter | live tokens/context % on composer; pre-truncation warning | needs usage metadata (already streamed) |
| X4 Prompt Lab | rewrite prompt w/ inline diff before send | client + small completion call |
| X5 Smart Route | auto model per prompt, fast/deep toggle, cost transparency | client heuristic first; lever later |
| X6 Card registry | tool results render as typed cards (table/code/chart) | registry + streaming adapters |
| X7 Session recap | TL;DR + action items pinned to thread | one completion call, cached |
| X8 Cross-chat recall | semantic answers across all conversations w/ chat citations | Meilisearch (already on pod) indexes conversations |
| X9 Canvas+diff | artifacts split panel, editable, per-version diff | file/artifact store exists partially |
| X10 Palette-OS | ⌘K covers every action/model/prompt/chat | CommandPalette exists — extend |

## Interface — surface spec (replaces current LibreChat shell)

- **Rail**: 64px icon rail, hover/click expands 260px; opaque; folders + new chat + search + settings + user.
- **Canvas**: centered 720px conversation column on `#0B0B0F`; no bubbles; whitespace + hairline rules; small-caps role chip; 2px iris edge on user turns.
- **Composer**: solid slab `#15151B` docked to canvas width; contextual controls on focus; inline model pill; attachments tray.
- **Header**: none. Breadcrumb strip on scroll-up only (solid, border-bottom).
- **Settings**: full-screen solid sheet + sticky section rail.
- **Empty state**: cinematic greeting (display face + sig gradient on wordmark), 3 contextual starters, templates entry.
- **Focus mode**: typing hides rail/breadcrumb; Esc returns.
- **Density**: comfortable/compact per user.
- Rollback: `interface.mode: 'classic' | 'atelier'` lever (default classic), user toggle — instant fallback.

---

## Waves & batches

### Wave 1 — Foundations unblock (must ship first, 7–10 days)
- [ ] W1.1 Auth ON: registration, login, email verification, password reset (needs SMTP creds) — config + smoke
- [ ] W1.2 First admin user + admin surface verified live (Providers management usable)
- [ ] W1.3 Provider keys live: deployment keys in pod env, BYO per-user flow E2E verified (A5/B5 close-out)
- [ ] W1.4 Uploads fixed: run RAG API on pod (supervisord program) OR gracefully disable uploads until ready — decide in-batch
- [ ] W1.5 SMTP: pick provider (Gmail app-password / Resend / SES), wire env, verify email + reset emails
- [ ] W1.6 Mobile web pass: responsive dock pattern, touch nav, 320px verified
- [ ] W1.7 Share links: public read-only conversation URLs (+ revoke)
- [ ] W1.8 PWA: manifest, icons, service worker offline shell, installable
- [ ] W1.9 Onboarding: first-60-seconds flow (account → provider/pick model → first chat)
- [ ] W1.10 Perf: CF edge cache static assets, bundle preload audit, cold-start TTFB tune

### Wave 2 — Monolith shell (G1–G3, 6 days)
- [ ] G1 interface lever + shell scaffold: rail, canvas column, breadcrumb-on-scroll, focus mode (2d)
- [ ] G2 composer slab + iris thread + context meter X3 (2d)
- [ ] G3 conversation canvas + branch tree X2 (2d)

### Wave 3 — Cortex core (G4–G5, 6 days)
- [ ] G4 Arena X1 + Smart Route X5 + Prompt Lab X4 (3d)
- [ ] G5 Card registry X6 + Session recap X7 + Canvas/diff X9 (3d)

### Wave 4 — Cortex reach + premium layer (6–8 days)
- [ ] G6 Palette-OS X10 + Cross-chat recall X8 (Meilisearch conv indexing) (2–3d)
- [ ] G7 Voice in/out (Web Speech), image/PDF viewer in canvas (2d)
- [ ] G8 Memory surface (view/edit what's remembered) + Projects++ (project prompts/pinned files) (2d)
- [ ] G9 Usage/cost dashboard per user + templates gallery on empty state (1–2d)

### Wave 5 — Ground-breaking (scoping later, listed for completeness)
- [ ] G10 Agent workflow runs w/ live step cards (schema exists)
- [ ] G11 Local-model mode: Ollama/vLLM on a pod endpoint = private on-brand model hosting
- [ ] G12 MCP tools marketplace (user-installable connectors)
- [ ] G13 Realtime collaborative sessions (needs WS infra decision)

---

## Verification & safety (every batch)
- tsc in touched workspaces; jest for changed logic; CI deploy green; live HTTP + console-error check.
- Feature flags per big feature (`arena`, `branchTree`, `contextMeter`, …) so anything can be disabled instantly.
- A11y checklist per surface; mobile 320px check; reduced-motion guard on every new animation.
- No new npm packages without approval; i18n keys en-first; no raw hex (semantic tokens only).

## Decisions needed from user
1. Layout concept: (A) Rail+Canvas (recommended) / (B) zero-chrome minimal / (C) bento dashboard.
2. Default interface after Wave 2: keep classic default + toggle, or flip default to atelier?
3. Display face: Sora / Gabarito / Inter-only.
4. SMTP provider for W1.5: Gmail app-password / Resend / SES.
5. Uploads: stand up RAG API on pod (W1.4a) or ship without uploads first (W1.4b)?
6. Include X8 cross-chat recall (Meilisearch-powered)? Y/N
7. Wave 5 items: any must-haves pulled forward?

## Session log
- 2026-10-29: plan written, pending approval. Supersedes UPGRADEPROD2 draft concepts (glass removed per user).
- Prior wave UPGRADEPROD1 (A–F) complete & live.

---

# V2UPGRADE TRACKER (this section is the live ledger — update every batch)

Legend: `[ ]` todo · `[$]` active · `[x]` done · `[x!]` done w/ deviation · `[b]` blocked on user/decision

## Wave 1 — Foundations
- [ ] W1.1 Auth ON (register/login/verify/reset) — `[b]` SMTP creds
- [ ] W1.2 First admin + admin surface live — `[b]` user registers
- [ ] W1.3 Deployment provider keys live + BYO E2E — `[b]` user supplies keys
- [ ] W1.4 Uploads: RAG API on pod OR uploads disabled gracefully — `[b]` decision 5
- [ ] W1.5 SMTP wired — `[b]` decision 4
- [ ] W1.6 Mobile web pass (dock pattern, 320px)
- [ ] W1.7 Share links (public read-only + revoke)
- [ ] W1.8 PWA (manifest, SW offline shell, installable)
- [ ] W1.9 Onboarding first-60s flow
- [x] W1.10 Perf: CF edge cache + preload audit — CF proxied (full SSL); bundle preload audit done in PROD1-F; cold TTFB tune pending scale data

## Wave 2 — Monolith shell
- [ ] G1 lever + rail/canvas/focus scaffold
- [ ] G2 composer slab + iris thread + context meter (X3)
- [ ] G3 conversation canvas + branch tree (X2)

## Wave 3 — Cortex core
- [ ] G4 Arena (X1) + Smart Route (X5) + Prompt Lab (X4)
- [ ] G5 Cards (X6) + Recap (X7) + Canvas/diff (X9)

## Wave 4 — Cortex reach + premium
- [ ] G6 Palette-OS (X10) + Cross-chat recall (X8) — `[b]` decision 6
- [ ] G7 Voice + file viewers
- [ ] G8 Memory surface + Projects++
- [ ] G9 Usage/cost dashboard + templates gallery

## Wave 5 — Ground-breaking (scope later)
- [ ] G10 Agent workflow step cards
- [ ] G11 Local-model mode (Ollama/vLLM on pod)
- [ ] G12 MCP tools marketplace
- [ ] G13 Realtime collab

## Ops fixes (done in this session, pre-approval)
- [x] Deploy-DB-outage bug: data dirs moved out of release swap path → `/workspace/data/{mongodb,meili_data}`; supervisor conf + provision + apply script updated; sha no-op guard added (docs-only deploys now skip)
- [x] mongod crash-loop root-caused twice; permanently eliminated

---

# PRODUCTION / LAUNCH READINESS

Percentages = weighted gate model. Production-ready = can real users be on it safely.
Launch-ready = marketed, public, self-serve at scale.

## Current state (2026-10-29)

| Gate | Weight | Score | Why |
|---|---|---|---|
| Infra & deploy | 15% | 90% | CI/CD health-gated, rollback, no-downtime deploys, hardened data path; single pod, no HA |
| App functionality | 25% | 55% | chat+endpoints+admin+key flows solid; auth OFF, uploads OFF, sharing OFF |
| Security | 15% | 45% | secrets hygiene good, SSRF guards, admin gated; no rate limiting, no audit log, auth unexercised |
| Scalability | 15% | 25% | single 2vCPU pod; see scale plan below |
| Ops & observability | 10% | 40% | logs exist; no metrics/alerting/uptime monitor/error tracking |
| Data safety | 10% | 50% | data outside release path now; no backups schedule, no restore drill |
| Compliance/privacy | 5% | 10% | no privacy policy, ToS, data-retention policy |
| Product polish | 5% | 35% | PROD1 shipped; Monolith not started |
| **PRODUCTION-READY** | | **≈52%** | |
| **LAUNCH-READY** (adds: onboarding, PWA, share, i18n audit, support path, status page) | | **≈38%** | |

## Road to 100% (target gates)
- Prod 100% = W1 complete + scale plan phase S1–S2 done + backups+restore drill + metrics/alerting + rate limits + privacy/ToS pages.
- Launch 100% = + Waves 2–4 shipped + onboarding + PWA + share + support email + status page + load test at 2× target.

---

# SCALE PLAN — 5,000 USERS (and beyond)

## Load model (assumptions → math)
- 5,000 registered; concurrency ≈ 5–8% peak ⇒ 250–400 concurrent; ~40–80 streaming completions at peak.
- 1 streaming completion ≈ (server-side relay) ~30KB memory + keep-alive socket; API CPU mostly JSON relay (model inference is upstream).
- Persistent stores: Mongo working set small (conv text grows ~2–5GB/mo at this scale); Meili index ~1–2GB.

## Phase S0 — current (hold ~50 concurrent, fine for pilot)
- 1 pod 2vCPU/4GB, single mongo, network volume. BOTTLENECKS: API CPU, single mongo, no rate limit.

## Phase S1 — 500–1,500 DAU (≈ 2–3 weeks of work, low cost)
1. **Pod resize**: 8 vCPU / 16GB (Runpod live resize or new pod; $0.24/hr class ≈ $170/mo)
2. **Rate limiting**: express-rate-limit per user/IP (auth+completion+upload routes) + CF WAF rules (bot protection, 10r/s per IP burst)
3. **Mongo**: journal on, WiredTiger cache 4GB, daily `mongodump` to /workspace/backups + weekly off-pod copy (r2/s3 via runpodctl) + restore drill
4. **Meili**: dedicated 2vCPU within pod OK; index refresh async
5. **CF**: cache static assets (assets/* immutable), enable Brotli, tiered cache
6. **Metrics**: prom-client on /metrics + UptimeRobot on /readyz + Grafana Cloud free / simple CF analytics + error tracking (Sentry free tier)
7. **Node**: UV_THREADPOOL=8, keep-alive timeouts tuned; PM2-style cluster NOT needed (supervisord single node proc fine to ~1k concurrent on 8vCPU)

## Phase S2 — 5,000 users (the target) 
1. **Split planes**: app pod (8vCPU) + db pod (4vCPU/16GB NVMe) — separate Runpod pods, same region, private network; Mongo on db pod w/ 8GB WT cache
2. **API**: 2× app pods behind CF load balancing (health-checked), sticky not required (JWT + Mongo sessions)
3. **Mongo**: single replica set (3 nodes if HA wanted; 1 node + backups acceptable at this tier) + change-stream consumers isolated
4. **Meili**: own pod (2vCPU/8GB), snapshot daily
5. **Uploads/RAG**: object storage (Cloudflare R2 — zero egress) instead of pod disk; presigned URLs
6. **Queue offload**: schedules/agentQueuedTurns move to a worker process (same repo, supervisord program on db pod) so API stays latency-clean
7. **Autoscale story**: Runpod serverless endpoint for the API is possible later (stateless relays); keep pods until cost curve says otherwise (~$400–600/mo total at S2 vs ChatGPT-class unit economics fine at any seat pricing)
8. **Backups**: mongodump hourly → R2, 30-day retention; Meili snapshots; .env/baanzon.yaml in secrets vault (not repo)

## Phase S3 — beyond 5k (only if it happens)
- Mongo 3-node replica set + read preference routing; API HPA via serverless; per-tenant shard by userId hash; multi-region CF + origin in EU/US split if compliance requires.

## Cost summary (Runpod+CF+R2, rough)
| Phase | Infra/mo | Supports |
|---|---|---|
| S0 now | ~$45 | pilot ≤50 concurrent |
| S1 | ~$200–250 | 1–1.5k DAU |
| S2 | ~$400–600 | 5,000 users / 300+ concurrent |

## Scale acceptance tests (gate to claim "5k-ready")
- [ ] k6/Artillery: 300 concurrent streaming sessions, p95 relay latency <300ms overhead, 0 5xx over 30 min
- [ ] Mongo: 10k inserts/min sustained, replica lag 0, backups restore <15 min
- [ ] Rate limit: burst abuse contained (429s) without affecting normal users
- [ ] CF: static hit-rate >90%, origin CPU flat under static load

---

## Tracker (live status — update after every batch)

Legend: `[ ]` todo · `[$]` active · `[x]` done · `[b]` blocked (needs user/decision) · each item carries its verify proof in the last column when done.

| Item | Status | Verify proof (when done) |
|---|---|---|
| W1.1 Auth ON | [b] needs SMTP + approval | register→verify→login E2E on live |
| W1.2 Admin user + surface | [b] needs first registration | /api/admin/providers 200 w/ admin JWT |
| W1.3 Provider keys live E2E | [b] needs operator key | real chat completion on live |
| W1.4 Uploads (RAG) | [ ] decision: run RAG on pod vs disable | upload→embed→cite E2E |
| W1.5 SMTP | [b] needs provider choice | verification + reset email received |
| W1.6 Mobile web | [ ] | 320/375/768px screenshots, no 2-D scroll |
| W1.7 Share links | [ ] | public URL w/o auth + revoke works |
| W1.8 PWA | [ ] | Lighthouse installable ✓, offline shell loads |
| W1.9 Onboarding flow | [ ] | fresh-account→first-chat < 60s |
| W1.10 Perf/CDN | [ ] | static via CF cache, Lighthouse perf ≥90 |
| G1 Shell scaffold | [ ] | lever flips classic↔atelier live |
| G2 Composer+iris+meter X3 | [ ] | streaming shows thread; meter matches usage |
| G3 Canvas+branch tree X2 | [ ] | branch → tree node appears, rewind works |
| G4 Arena X1 / Route X5 / Lab X4 | [ ] | 2-model side-by-side renders; diff applies |
| G5 Cards X6 / Recap X7 / Canvas X9 | [ ] | tool result renders as card; recap pinned |
| G6 Palette-OS X10 / Recall X8 | [ ] | ⌘K covers listed actions; recall cites chats |
| G7 Voice + file viewer | [ ] | mic roundtrip; PDF renders in canvas |
| G8 Memory + Projects++ | [ ] | memory editable; project prompt applies |
| G9 Cost dashboard + gallery | [ ] | dashboard matches token ledger |
| G10–G13 | [ ] scoping | per-feature specs before build |

## Readiness scorecard (recompute after each wave; % = earned/total weight)

### Production-ready (is it safe to run for real users?)
| Dimension | Weight | Now | Target |
|---|---|---|---|
| Deploy pipeline + rollback | 15 | 15 (auto-deploy green, health-gated) | 15 |
| Secrets & config management | 10 | 9 | 10 |
| Auth & session security | 15 | 3 (config-only, no public reg) | 15 |
| Data safety: backups + restore drill | 15 | 0 | 15 |
| Monitoring & alerts | 10 | 2 (supervisord + logs only) | 10 |
| Rate limiting / abuse guards | 10 | 2 | 10 |
| Uploads & file pipeline | 10 | 0 | 10 |
| Error/retry states coverage | 5 | 3 | 5 |
| HTTPS/domain/CDN | 5 | 5 | 5 |
| Incident runbook | 5 | 0 | 5 |
| **PRODUCTION-READY** | **100** | **≈ 39%** | **100%** |

### Launch-ready (can we hand it to 5,000 strangers?)
| Dimension | Weight | Now | Target |
|---|---|---|---|
| Accounts + onboarding <60s | 15 | 0 | 15 |
| Core chat E2E with real keys | 15 | 8 (works, keys unverified live) | 15 |
| Mobile experience | 10 | 1 | 10 |
| PWA/installable | 5 | 0 | 5 |
| Share/recollab | 5 | 0 | 5 |
| Search (chat + cross-chat) | 10 | 4 | 10 |
| New interface (Monolith) | 15 | 0 | 15 |
| Cortex differentiators X1–X10 | 15 | 2 (palette exists) | 15 |
| Perf at load (CF cache, TTFB) | 5 | 2 | 5 |
| Legal: ToS/Privacy/Imprint | 5 | 0 | 5 |
| **LAUNCH-READY** | **100** | **≈ 17%** | **100%** |

Formula: honest checkbox math, no vibes — any dimension partially done scores its fraction; recompute in each wave's final report.

## Scale plan — 5,000 users

### Sizing tiers (act at triggers, not dates)
| Tier | Users | Infra | ~Monthly | Trigger to move up |
|---|---|---|---|---|
| T0 now | ≤100 | 1 pod 2c/4GB (all-in-one) + 40GB volume | ~$46 | p95 TTFB >2s or 300 DAU |
| T1 | 100–1,000 | App pod 4c/8GB; Mongo+Meili moved to own pod 2c/4GB+50GB; CF cache on | ~$120 | CPU >70% sustained or 1k DAU |
| T2 | 1,000–5,000 | 2× app pods behind CF LB; DB pod 4c/8GB + 100GB; RAG pod (uploads on); backups off-site | ~$350 | 5k DAU or uploads >50GB |

### What changes at 5,000 (all planned into batches)
- **Stateless app**: nothing user-local on disk except volume dirs; sessions already JWT → any pod can serve. W1 batches keep it that way.
- **Mongo**: single replica set; index audit + slow-query log in W1; nightly dump to volume + off-site copy at T1 (backups dimension).
- **Meilisearch**: dedicated pod at T1; conversations index sized ~5k×avg 40KB ≈ manageable; X8 recall reads it.
- **Uploads**: volume → per-tier quotas (default 200MB/user), lifecycle cleanup cron; RAG pod separate at T2.
- **Rate limiting**: per-user + per-IP (CF rules + app middleware) — dimensions row exists; ship by W1.
- **Cloudflare**: cache static (`/assets/*` immutable), WAF managed rules, bot fight at launch.
- **Observability**: uptime probe (CF health-check → email), supervisor restart alerts, disk/mem triggers — replaces "check logs by hand".
- **Cost honesty**: T2 ≈ $350/mo ≈ $0.07/user/mo at 5k — undercuts any SaaS tier you'd charge.

### Launch gates (all must be green before opening registrations publicly)
`[ ]` Auth E2E · `[ ]` backups restore drill · `[ ]` alerts firing · `[ ]` rate limits on · `[ ]` ToS/Privacy live · `[ ]` mobile pass · `[ ]` cost dashboard shows per-user spend
