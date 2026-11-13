#!/usr/bin/env node
/**
 * Validates the served model catalog in baanzon.yaml: it must parse, mirror
 * PUBLIC_MODELS exactly, and carry no concrete vendor id on a user-facing
 * surface. Read-only on purpose — the 2025-11-12 deploy outage came from an
 * autofix that rewrote the Opraiz model list with wrong indentation, broke
 * the yaml parse, and booted the server with an empty config. A validation
 * failure must abort the release, never repair the file.
 */
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const {
  MATRIX,
  PUBLIC_MODELS,
  toPublicModelId,
} = require('../api/server/services/billing/modelRouter');

const configPath = path.resolve(process.argv[2] || 'baanzon.yaml');
const source = fs.readFileSync(configPath, 'utf8');

let doc;
try {
  doc = yaml.load(source);
} catch (error) {
  console.error(`[provider-check] baanzon.yaml does not parse: ${error.message}`);
  process.exit(1);
}

const failures = [];

const opraiz = doc?.endpoints?.custom?.find?.((endpoint) => endpoint.name === 'Opraiz');
if (!opraiz) {
  failures.push("endpoints.custom has no 'Opraiz' entry");
}

const specs = doc?.modelSpecs?.list ?? [];
const specNames = new Set(specs.map((spec) => spec.name));

// Every concrete model the tier router can pick must resolve to a served spec.
for (const brand of Object.keys(MATRIX)) {
  for (const [tier, { model }] of Object.entries(MATRIX[brand])) {
    const pub = toPublicModelId(model);
    if (!pub) {
      failures.push(`MATRIX ${brand}.${tier} model '${model}' has no public mapping`);
    } else if (!specNames.has(pub)) {
      failures.push(`MATRIX ${brand}.${tier} maps to '${pub}' but no modelSpec serves it`);
    }
  }
}

// The spec catalog is exactly the public keys, and preset.model mirrors the name.
for (const spec of specs) {
  if (!PUBLIC_MODELS[spec.name]) {
    failures.push(`modelSpec '${spec.name}' is not a PUBLIC_MODELS key`);
  }
  const presetModel = spec.preset?.model;
  if (presetModel !== spec.name) {
    failures.push(
      `modelSpec '${spec.name}' preset.model is '${presetModel}' - it must mirror the spec name`,
    );
  }
}
for (const key of Object.keys(PUBLIC_MODELS)) {
  if (!specNames.has(key)) {
    failures.push(`PUBLIC_MODELS key '${key}' has no modelSpec`);
  }
}

// The endpoint accepts exactly the public keys.
const defaults = opraiz?.models?.default ?? [];
for (const model of defaults) {
  if (!specNames.has(model)) {
    failures.push(`Opraiz models.default entry '${model}' is not a modelSpec name`);
  }
}
for (const key of specNames) {
  if (!defaults.includes(key)) {
    failures.push(`modelSpec '${key}' is missing from Opraiz models.default`);
  }
}

// Ceiling above the largest context window the router can hand out.
const maxRoutedContext = Math.max(
  ...Object.values(MATRIX).flatMap((tier) =>
    Object.values(tier).map(({ maxContextTokens }) => maxContextTokens),
  ),
);
const endpointContext = Number(opraiz?.maxContextTokens);
if (!Number.isFinite(endpointContext) || endpointContext < maxRoutedContext) {
  failures.push(
    `Opraiz maxContextTokens=${opraiz?.maxContextTokens} is below routed maximum ${maxRoutedContext}`,
  );
}

// No concrete vendor id on a user-facing surface of the served config.
const served = JSON.stringify({ modelSpecs: specs, models: defaults });
if (/@cf\//i.test(served)) {
  failures.push(
    "a concrete '@cf/' model id is user-visible in modelSpecs or Opraiz models.default",
  );
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[provider-check] ${failure}`);
  }
  process.exit(1);
}
console.log(
  `[provider-check] valid: ${specs.length} public specs, ${defaults.length} endpoint models, maxContextTokens=${endpointContext}, no vendor ids served`,
);
