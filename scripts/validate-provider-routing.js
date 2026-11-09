#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { MATRIX } = require('../api/server/services/billing/modelRouter');

const configPath = path.resolve(process.argv[2] || 'baanzon.yaml');
const source = fs.readFileSync(configPath, 'utf8');
const endpointStart = source.indexOf("- name: 'Opraiz'");
const nextEndpoint = source.indexOf('\n     - name:', endpointStart + 1);
const endpoint = endpointStart >= 0
  ? source.slice(endpointStart, nextEndpoint >= 0 ? nextEndpoint : source.length)
  : '';

if (!endpoint) {
  throw new Error('Opraiz custom endpoint is missing from baanzon.yaml');
}

const routedModels = [
  ...new Set(Object.values(MATRIX).flatMap((tier) => Object.values(tier).map(({ model }) => model))),
];
const missingModels = routedModels.filter((model) => !endpoint.includes(`'${model}'`));
const maxRoutedContext = Math.max(
  ...Object.values(MATRIX).flatMap((tier) => Object.values(tier).map(({ maxContextTokens }) => maxContextTokens)),
);
const maxContextTokens = Number(endpoint.match(/^\s*maxContextTokens:\s*(\d+)/m)?.[1]);

if (missingModels.length > 0) {
  throw new Error(`Opraiz endpoint is missing routed models: ${missingModels.join(', ')}`);
}

if (!Number.isFinite(maxContextTokens) || maxContextTokens < maxRoutedContext) {
  throw new Error(
    `Opraiz maxContextTokens=${maxContextTokens || 'missing'} is below routed maximum ${maxRoutedContext}`,
  );
}

console.log(
  `[provider-check] Opraiz routing valid: ${routedModels.length} models, maxContextTokens=${maxContextTokens}`,
);
