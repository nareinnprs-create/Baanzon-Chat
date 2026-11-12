#!/usr/bin/env node
/**
 * Fills missing translations for the Surpass promoted keys (batch 7).
 *
 * Modes:
 *   translate  Run on the pod (gateway creds live in /workspace/baanzon/.env).
 *              For every locale missing the promoted keys, asks the Opraiz
 *              gateway for a JSON translation map and writes one result file.
 *   apply      Run locally. Merges a translate result file into the repo's
 *              client/src/locales/<dir>/translation.json, preserving key order
 *              and appending missing keys at the end.
 *
 * Usage:
 *   node scripts/i18n-fill.mjs translate --locales <dir> --keys <file> --out <file>
 *   node scripts/i18n-fill.mjs apply --locales <dir> --fill <file> [--locales-only de,fr]
 *
 * Env (translate): OPRAIZ_BASEURL, OPRAIZ_API_KEY, optional I18N_MODEL
 * (default @cf/zai-org/glm-5.3).
 */
import fs from 'node:fs';
import path from 'node:path';

const MODEL = process.env.I18N_MODEL || '@cf/zai-org/glm-5.3';
const FALLBACK_MODEL =
  process.env.I18N_FALLBACK_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const GATEWAY = (process.env.OPRAIZ_BASEURL || '').replace(/\/+$/, '');
const API_KEY = process.env.OPRAIZ_API_KEY || '';

const LANG_NAMES = {
  ar: 'Arabic',
  bo: 'Tibetan',
  bs: 'Bosnian',
  ca: 'Catalan',
  cs: 'Czech',
  da: 'Danish',
  de: 'German',
  es: 'Spanish',
  et: 'Estonian',
  fa: 'Persian',
  fi: 'Finnish',
  fr: 'French',
  gu: 'Gujarati',
  he: 'Hebrew',
  hu: 'Hungarian',
  hy: 'Armenian',
  id: 'Indonesian',
  is: 'Icelandic',
  it: 'Italian',
  ja: 'Japanese',
  ka: 'Georgian',
  kn: 'Kannada',
  ko: 'Korean',
  lt: 'Lithuanian',
  lv: 'Latvian',
  ml: 'Malayalam',
  nb: 'Norwegian Bokmål',
  ne: 'Nepali',
  nl: 'Dutch',
  nn: 'Norwegian Nynorsk',
  pl: 'Polish',
  'pt-BR': 'Brazilian Portuguese',
  'pt-PT': 'European Portuguese',
  ru: 'Russian',
  si: 'Sinhala',
  sk: 'Slovak',
  sl: 'Slovenian',
  sv: 'Swedish',
  ta: 'Tamil',
  th: 'Thai',
  tr: 'Turkish',
  ug: 'Uyghur',
  uk: 'Ukrainian',
  vi: 'Vietnamese',
  'zh-Hans': 'Simplified Chinese',
  'zh-Hant': 'Traditional Chinese',
};

function parseArgs(argv) {
  const args = {};
  const list = argv.slice();
  args.mode = list.shift();
  while (list.length) {
    const flag = list.shift();
    if (flag.startsWith('--')) args[flag.slice(2)] = list.shift();
  }
  return args;
}

function localeDirs(localesRoot) {
  return fs
    .readdirSync(localesRoot)
    .filter((d) => fs.statSync(path.join(localesRoot, d)).isDirectory() && d !== 'en')
    .sort();
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function translateBatch(source, targetName, targetCode, pairs, model = MODEL) {
  const keyText = pairs.map((k) => k.key);
  const srcMap = Object.fromEntries(pairs.map((k) => [k.key, k.value]));
  const prompt = [
    `Translate a software UI string map into ${targetName} (${targetCode}).`,
    'Input is a JSON object: keys are stable identifiers, values are English UI strings.',
    'Rules:',
    '- Keep every {{placeholder}} and %s/%d token exactly as-is.',
    '- Use concise, natural UI wording (buttons, labels, short sentences).',
    '- Keep consistent tone; do not translate the stable identifiers.',
    '- If a string is an abbreviation or model name, keep it as-is.',
    'Output ONLY a JSON object with the same keys and the translated values.',
    '',
    JSON.stringify(srcMap),
  ].join('\n');
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: 'You are a precise localization engine. Reply with JSON only.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`gateway ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  const jsonText = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
  const parsed = JSON.parse(jsonText);
  const missing = keyText.filter((k) => typeof parsed[k] !== 'string' || !parsed[k].trim());
  if (missing.length) {
    throw new Error(`model returned no value for ${missing.length}/${keyText.length} keys`);
  }
  return parsed;
}

async function modeTranslate(args) {
  const localesRoot = args.locales;
  const keys = JSON.parse(fs.readFileSync(args.keys, 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(localesRoot, 'en', 'translation.json'), 'utf8'));
  const pairs = keys.filter((k) => typeof en[k] === 'string');
  if (pairs.length !== keys.length) {
    console.log(`[i18n] WARNING: ${keys.length - pairs.length} promoted keys absent from en`);
  }
  const result = {};
  let okLocales = 0;
  let failLocales = 0;
  for (const dir of localeDirs(localesRoot)) {
    const locPath = path.join(localesRoot, dir, 'translation.json');
    if (!fs.existsSync(locPath)) {
      console.log(`[i18n] ${dir}: no translation.json, skipped`);
      continue;
    }
    const loc = JSON.parse(fs.readFileSync(locPath, 'utf8'));
    const missing = pairs.filter((k) => !(k in loc) || !String(loc[k]).trim());
    if (missing.length === 0) {
      console.log(`[i18n] ${dir}: already complete`);
      continue;
    }
    let done = false;
    for (let attempt = 1; attempt <= 2 && !done; attempt += 1) {
      try {
        const pieces = [];
        for (const part of chunk(missing, 60)) {
          pieces.push(
            await translateBatch(
              en,
              LANG_NAMES[dir] || dir,
              dir,
              part.map((key) => ({ key, value: en[key] })),
            ),
          );
        }
        result[dir] = Object.assign({}, ...pieces);
        done = true;
      } catch (err) {
        console.log(
          `[i18n] ${dir}: attempt ${attempt} failed: ${String(err.message || err).slice(0, 160)}`,
        );
      }
    }
    if (!done) {
      /** One last shot on the fallback model - persistent 408s on the primary
       * (e.g. Tibetan on glm-5.3) usually clear on the smaller model. */
      try {
        const pieces = [];
        for (const part of chunk(missing, 60)) {
          pieces.push(
            await translateBatch(
              en,
              LANG_NAMES[dir] || dir,
              dir,
              part.map((key) => ({ key, value: en[key] })),
              FALLBACK_MODEL,
            ),
          );
        }
        result[dir] = Object.assign({}, ...pieces);
        done = true;
        console.log(`[i18n] ${dir}: filled on fallback model`);
      } catch (err) {
        console.log(`[i18n] ${dir}: fallback failed: ${String(err.message || err).slice(0, 160)}`);
      }
    }
    if (done) {
      okLocales += 1;
      console.log(`[i18n] ${dir}: filled ${missing.length}`);
    } else {
      failLocales += 1;
    }
  }
  fs.writeFileSync(args.out, JSON.stringify(result));
  console.log(
    `[i18n] done: locales=${okLocales} failed=${failLocales} keys=${pairs.length} -> ${args.out}`,
  );
}

function modeApply(args) {
  const fill = JSON.parse(fs.readFileSync(args.fill, 'utf8'));
  const only = args['locales-only'] ? new Set(args['locales-only'].split(',')) : null;
  let totalKeys = 0;
  for (const [dir, map] of Object.entries(fill)) {
    if (only && !only.has(dir)) continue;
    const locPath = path.join(args.locales, dir, 'translation.json');
    if (!fs.existsSync(locPath)) {
      console.log(`[apply] ${dir}: no file, skipped`);
      continue;
    }
    const raw = fs.readFileSync(locPath, 'utf8');
    const loc = JSON.parse(raw);
    let added = 0;
    for (const [key, value] of Object.entries(map)) {
      if (typeof value === 'string' && value.trim() && !(key in loc)) {
        loc[key] = value;
        added += 1;
      }
    }
    fs.writeFileSync(locPath, JSON.stringify(loc, null, 2) + '\n');
    totalKeys += added;
    console.log(`[apply] ${dir}: +${added}`);
  }
  console.log(`[apply] total added: ${totalKeys}`);
}

const args = parseArgs(process.argv.slice(2));
if (args.mode === 'translate') {
  if (!GATEWAY || !API_KEY) {
    console.error('[i18n] OPRAIZ_BASEURL / OPRAIZ_API_KEY required');
    process.exit(1);
  }
  await modeTranslate(args);
} else if (args.mode === 'apply') {
  modeApply(args);
} else {
  console.error('usage: i18n-fill.mjs <translate|apply> --locales <dir> ...');
  process.exit(1);
}
