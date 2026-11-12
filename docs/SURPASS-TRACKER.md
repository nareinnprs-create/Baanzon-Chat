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
| SearXNG pod install (rescue lane) | ✅ JSON API verified 200 on 127.0.0.1:8888, supervised, env pointer set |
| A7 Deep Research mode go-live | 🔄 deploying: yaml flipped to searxng + SEARXNG_INSTANCE_URL picked up on this boot |
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
| V4 image generation (flux via images-generate) | ⬜ |
| 47-locale completeness for promoted strings | ⬜ |

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
