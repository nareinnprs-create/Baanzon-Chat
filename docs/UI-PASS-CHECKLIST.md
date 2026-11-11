# UI Visual & Accessibility Pass — Human Checklist

The code-level sweeps (img alts, aria labels on the newest features, keyboard
handlers on menus/dialogs, motion-safe animation guards) came back clean. What
remains is the human pass on real devices that no automated sweep can replace.
Work through this list top to bottom; file anything that feels off.

## Devices & modes to cover

- Desktop 1440px + laptop 1280px + phone 390px (iOS Safari and Android Chrome)
- Light (Pearl) and dark (Deep Ocean) themes, plus system-follow on each device
- `prefers-reduced-motion: reduce` enabled once (everything must stay still)

## Core chat

- [ ] Send a message; pulse marker (header, left of the model selector) shows
      thinking during generation, success briefly after, then still
- [ ] Stop mid-stream; pulse returns to still; partial answer retained
- [ ] Regenerate / edit / copy / branch actions reachable by keyboard only
- [ ] Concurrent 2nd send shows the friendly "one message at a time" text
- [ ] Web search: ask a current-events question with the search tool active;
      answer cites live results

## Feature surfaces

- [ ] /workflow — save a draft, Run on server, steps tick through, history
      updates; tool/custom steps fail with the clear unsupported message
- [ ] /voice — start a session (real mic), transcript renders, end call clean
- [ ] /canvas — open an artifact, edit, version history, split view
- [ ] /data-lab — upload a CSV, chart + table + filter + derive render
- [ ] /deep-research — start a run; progress reflects SearXNG-backed search
      (needs the self-hosted SearXNG follow-up; currently expected to fail
      gracefully)
- [ ] /skills — tree view loads, create + edit round-trip
- [ ] Settings → General → Admin — Users page search + pagination; Billing
      payments; Providers
- [ ] Settings → Usage — plan tier + balance rows; "All" scope shows server
      totals; "Current" shows the open conversation

## Accessibility spot checks

- [ ] VoiceOver (iOS) / TalkBack (Android) reads the chat header, composer and
      message actions with sensible names
- [ ] Keyboard-only: tab through sidebar → composer → send → message actions;
      focus is never lost after sending
- [ ] Contrast on status/plan badges in both themes
- [ ] Touch targets on the mobile composer row ≥ 44px
- [ ] Toasts are announced (role=status) and dismissible

## Known-good (verified by code sweep this pass)

- Image alts present across auth, preview, search results, message content
- Feature labels all resolve through the translation system (47 locales)
- Aurora pulse falls still under reduced motion (motion-safe guards)
