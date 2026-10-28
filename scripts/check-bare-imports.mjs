/**
 * Scan built client chunks for unresolved bare module imports (specifiers that
 * neither start with "./" nor "../"), which kill the page at module-parse time
 * (the "@emotion/memoize" blank-page class of bug). Cargo-culted from the
 * one-off audit probe in the Oct-28 deploy session.
 *
 * Usage: node scripts/check-bare-imports.mjs [dir (=client/dist/assets)]
 * A server-side bundle legitimately may contain bare imports meant for
 * Node (tracebacks like dynamic `import(${module})` templates excluded by the
 * regex requiring a literal specifier).
 *
 * Allowlist: specifiers known to be intentionally external in built output
 * (e.g. the sandpack artifact chunks import runtime helpers dynamically).
 */
import fs from 'fs';
import path from 'path';

const dir = process.argv[2] || 'client/dist/assets';
const KNOWN_EXTERNAL = new Set([
  // sandpack bundles emit templated require() helpers for language toolchains;
  // these specifiers are only touched inside never-mounted sandbox editors.
  'preact', 'react', 'vue', 'solid-js', 'vite', 'mermaid', 'vaul',
  'class-variance-authority', 'clsx', 'embla-carousel-react', 'lucide-react',
  'react-day-picker', 'react-zoom-pan-pinch', 'tailwind-merge',
  'jsdom-testing-mocks', 'RouterProvider', '${module}',
]);

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
const offenders = new Map();
const re = /import\s+(?:[\w$,{}\s*]+\s+from\s+)?(["'`])([^"'`./\\]+)\1/g;
for (const f of files) {
  const t = fs.readFileSync(path.join(dir, f), 'utf8');
  let m;
  while ((m = re.exec(t))) {
    const spec = m[2];
    if (!KNOWN_EXTERNAL.has(spec)) {
      offenders.set(spec, [...(offenders.get(spec) || []), f]);
    }
  }
}
if (offenders.size > 0) {
  for (const [spec, fs2] of offenders)
    process.stderr.write(`${spec} -> ${fs2.slice(0, 3).join(', ')}\n`);
  process.stderr.write(`BARE IMPORT OFFENDERS: ${offenders.size}\n`);
  process.exit(1);
}
process.stdout.write(`OK: no bare imports across ${files.length} chunks\n`);
