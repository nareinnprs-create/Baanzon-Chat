# BAANZON CHAT — canonical brand (LOCKED)

Operator decision, 2026-11-12: this kit is the **always-canonical brand source**
for Baanzon Chat. The kit's "concept study / provisional palette" status notes
are superseded by that decision for product use; the trademark-caution note in
`05_Trademark_and_QA/` still stands (legal clearance remains open).

## Locked decisions

- **Emblem**: S3-A "Controlled Opening" (chose over S3-B per the kit's own
  comparison: simpler geometry, reads at 16–48 px).
- **Palette**: Graphite `#303438` (anchor), Celadon `#B7D6C3` (signature
  accent), Soft White `#F0F0E9` (light surfaces), Steel `#70777B` (secondary).
  Live as CSS tokens `--bc-graphite|--bc-celadon|--bc-soft-white|--bc-steel`
  in `client/src/style.css`; utilities `.text-brand-celadon`,
  `.text-brand-graphite` consume them.

## Production assets (built from S3-A geometry — regenerate, never hand-edit)

| File | Use |
|---|---|
| `client/public/assets/logo.svg` | horizontal lockup (light surfaces) |
| `client/public/assets/logo-dark.svg` | horizontal lockup (dark surfaces) |
| `client/public/assets/brand-mark.svg` | emblem only |
| `client/public/favicon.svg` | emblem, transparent |
| `client/public/assets/favicon-*.png`, `apple-touch-icon-180x180.png`, `icon-192x192.png`, `maskable-icon.png` | raster sizes |

Regeneration script: see commit history ("build-brand-assets") — emblem paths
come verbatim from `02_Logo_Concept_Studies/S3-A_Controlled_Opening_Study.svg`
with the presentation board stripped. The kit's checklist item "rebuild as
clean production vector geometry" is done for the emblem; the wordmark is
type-based (Inter/Arial) until custom wordmark paths are commissioned.

## Rule

Any UI surface that shows the logo, wordmark or brand accent colors consumes
these files/tokens. Do not introduce substitute marks, other greens, or
re-colored logo variants. Changes to this folder require the operator.
