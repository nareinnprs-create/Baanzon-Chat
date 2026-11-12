# UI Surpass Plan — Progress Tracker

Plan approved 2026-11-12 (all batches). Ships batch-by-batch through the
zero-downtime lane. Status: ⬜ pending · 🔄 in progress · ✅ done · ⛔ blocked

## Batch 1 — Provider branding + renames + vision model (C1, C2, C3, V1, V2)

| Item | Status | Notes |
|---|---|---|
| V1 vision model on Opraiz (`llama-3.2-11b-vision`) | ✅ | in catalog; live-probe image parts at rollout |
| C1 branded model catalog (`modelSpecs`, 12 specs / 5 groups) | ✅ | groups ARE the renamed providers |
| C3 renamed model picker groups | ✅ | existing grouped picker renders the spec catalog |
| C2 Settings → AI Providers user page | ✅ | all users; branding cards + connected badge + models |

## Batch 2 — Premium feel (B2, B3, B4) ✅

| Item | Status |
|---|---|
| B2 editorial message typography (§63.8) | ✅ assistant-only measure + leading + prose rhythm |
| B3 kinetic motion coherence | ✅ message settle-in animation, motion-safe |
| B4 adaptive density toggle | ✅ compact/comfortable, persisted, Settings → Appearance |

## Batch 3 — Intelligence UX (A1, V3) ✅

| Item | Status |
|---|---|
| A1 reasoning visibility | ✅ "Thought for Ns" duration on reasoning panels (panel + streaming peek already built) |
| V3 vision UX in chat | ✅ core: vision model in catalog + composer vision lane badge (hint chip = follow-up polish) |

## Batch 4 — Intelligence surfaces (A3, A5) ✅

| Item | Status |
|---|---|
| A3 Tasks surface (schedules UI) | ✅ verified: SidePanel Schedules dialog + specs green (98/98 across the batch) |
| A5 Memory surface (user-facing viewer/editor) | ✅ verified: memory artifacts/call/info components green |

## Batch 5 — Routing + research (A6, B5, A7) 🔄

| Item | Status |
|---|---|
| A6 Auto smart-routing with visible reasons | ✅ core: toggle + fast/deep heuristic live (branded catalog names feed it); visible-reason label = follow-up |
| B5 command-everything palette | ✅ core: CommandPalette mounted in Root; action-coverage expansion = follow-up |
| SearXNG pod install (rescue lane) | ✅ live: JSON API returns results (36-37/search); fixed gunicorn --preload (kills SearXNG's async engine loop thread at fork → every engine "timeout") + `outgoing.request_timeout: 10.0` in settings.yml; mirrored in scripts/pod-searxng.sh |
| A7 Deep Research mode go-live | ✅ live: pod E2E verified plan→run (SSE: search → 8 sources → synthesis with citations); LLM via Opraiz gateway; duckduckgo engine CAPTCHAs from datacenter IP are the only engine loss |
| V3 hint chip (vision switch suggestion) | ⬜ follow-up polish |

## Operator grants

| Grant | Status |
|---|---|
| aravind k (aravind18k@gmail.com) → Pro + unlimited pool + 30 days | ✅ live 2026-11-12 (window ends 2026-12-11); `stage=grant` lane built for future comps |

## Batch 6 — Agentic + generative + gradient (A2, A4, B1) 🔄

| Item | Status |
|---|---|
| B1 Aurora gradient milestone 2 | ✅ tokens + utilities in style.css; pulse active states carry the Signature Aurora |
| A2 agentic transparency (tool timeline, subagent chips) | ✅ verified: ToolCallGroup + ActivityPhaseGroup timeline, SubagentCall chips, AgentUpdate, AgentHandoff — all wired in ContentParts/Part (67 test files) |
| A4 generative UI in-message (chart/table contracts) | 🔄 `chart`/`table` code fences render DataLab primitives inline (DataLabFence); tests 6/6, full suite + tsc verifying |

## Batch 7 — Optional (V4, i18n)

| Item | Status |
|---|---|
| V4 image generation (flux via images-generate) | ✅ Tools menu → "Image Gen" dialog → tier-gated endpoint; Download / attach via standard file pipeline; 3 dialog specs (`44cd516`) |
| 47-locale completeness for promoted strings | ✅ 46/47 locales carry all 153 promoted keys; Tibetan (`bo`) shows the en fallback for the 8 brand/image-gen strings — glm-5.3 gateway-408s on Tibetan and llama-3.3 returns empty (fill script has a fallback-model retry; `bo` alone fails both). Deliberate: clean English beats bad Tibetan in brand copy |

## Live-site fixes (operator feedback, 2026-11-12)

| Item | Status |
|---|---|
| Raw `@cf/...` model ids visible in picker/search | ✅ `getBrandedEndpoints` keeps spec-covered endpoints out of groups + search (`74bdc2f`) |
| "Welcome to Baanzon Chat!" greeting — "so weird" | ✅ customWelcome removed from `baanzon.yaml`; built-in time-based greeting shows |
| Starters section ("What are you working on?") — "i dont like" | ✅ HomeOnboarding + StarterGallery deleted from the landing (`17a0b91`) |
| Login page — "more competitive, premium" | ✅ split-screen aurora brand panel + floating form card (`764d81d`) |
| Login logo — "not baanzon logo" | ✅ brand kit LOCKED: S3-A emblem + wordmark lockup, favicon + PNG sizes rebuilt (`9025cdf`); kit canonized in `brand/` (`brand/LOCKED-README.md`), `--bc-*` tokens in style.css |

## UI upgrade 2026 (operator-approved A–F, enhance-only: no structure/theme/brand change)

| Group | Status |
|---|---|
| A Foundation — motion tokens + elevation scale + selection/caret | ✅ `--dur-fast/med`, `--ease-standard`, `--shadow-card/popover/dialog` (+ dark) in style.css; popover, both dialog primitives and auth card on tier tokens; dialogs 2xl radius + overlay blur; brand-tinted `::selection` + caret (`a00f445`) |
| B Login page — card entrance, aurora drift, control polish | ✅ `.auth-card-enter` rise-in, aurora drift behind brand panel (reduced-motion static), celadon accent bar, input focus glow, submit/social hover-lift, animated alerts (`a00f445`) |
| C Chat workspace — header blur + message entrance | ✅ header `bg-surface-primary/85 backdrop-blur-md`; `.message-enter` rise on row mount (`a00f445`). Composer focus halo + sidebar active accent bars already existed — skipped as done |
| D Overlays — dialog/menu motion + depth | ✅ covered by A (tier shadows, 2xl radius, blur, radix data-state animations already present) |
| E Feedback — skeletons + toasts | ✅ toasts on popover tier + `rounded-lg`; skeletons already pervasive (Skeleton.tsx in use across sidebar/notifications/pickers) — skipped as done |
| F Hygiene — a11y + verification | ✅ every new animation has a `prefers-reduced-motion` guard; tsc clean (packages/client + client); 30 auth/locale + 1174 message + 12 primitive tests green; live check after deploy |

## Launch plan — feature + freshness + CI (operator-approved, 2026-11-12) 🔄

| Item | Status |
|---|---|
| Part 4 — CI green (stale i18n keys + shadow block + subagent mock) | ✅ 9 unused keys deleted; dark shadows merged into the main `.dark` block (positional spec reads correct values again); `runEndByIndex` added to the ChatView subagent store mock; both suites green (54 + 2) |
| Part 3 — Fresh web answers | ✅ SearXNG `allowedAddresses` pin uncommented (`127.0.0.1:8888`); all 12 modelSpecs: spec-level `webSearch: true` + `promptPrefix` carrying `{{current_datetime}}`; default spec `baanzon-intelligence` switched llama-3.3-70b → `@cf/zai-org/glm-5.3` |
| Part 2 — Typed "generate an image…" actually generates | ✅ `isImageRequest` interception in `useSubmitMessage`: POST `/api/images/generate` → blob → File → `/files/images` upload → submit with `overrideFiles`; skips attachments/queued overrides; cap/burst failures toast the server message and fall back to the plain send; specs 14/14 new |
| Part 1 — Live verification pass | ⬜ after this deploy: auth, chat per group, freshness probe, image dialog + typed request, vision attach, title gen, offline queue |

## Done before this plan (for context)

- ✅ Zero-downtime blue-green deploys (gate + two slots, rollback = 1 command)
- ✅ Keyless web search (Keenable) pinned for all users
- ✅ A1 i18n promotion (Voice + Workflow; registries verified)
- ✅ A3 workflow engine transport (local executor + persistence + REST + client)
- ✅ A4 Aurora pulse host wiring (thinking/completed/still)
- ✅ A6 notification deep paging, A8 admin Users page, B6 usage plan/balance
- ✅ A7 code-level a11y sweeps + `docs/UI-PASS-CHECKLIST.md` (human pass pending)
- ⛔ B8 code interpreter (needs external worker + isolation decision)
- ⛔ Google OAuth (needs GOOGLE_CLIENT_ID/SECRET)
