#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { MATRIX } = require('../api/server/services/billing/modelRouter');

const configPath = path.resolve(process.argv[2] || 'baanzon.yaml');
const config = YAML.parse(fs.readFileSync(configPath, 'utf8'));
const endpoint = config?.endpoints?.custom?.find((entry) => entry?.name === 'Opraiz');

if (!endpoint) {
  throw new Error('Opraiz custom endpoint is missing from baanzon.yaml');
}

const allowedModels = new Set(endpoint.models?.default || []);
const routedModels = [
  ...new Set(Object.values(MATRIX).flatMap((tier) => Object.values(tier).map(({ model }) => model))),
];
const missingModels = routedModels.filter((model) => !allowedModels.has(model));
const maxRoutedContext = Math.max(
  ...Object.values(MATRIX).flatMap((tier) => Object.values(tier).map(({ maxContextTokens }) => maxContextTokens)),
);

if (missingModels.length > 0) {
  throw new Error(`Opraiz endpoint is missing routed models: ${missingModels.join(', ')}`);
}

if (Number(endpoint.maxContextTokens) < maxRoutedContext) {
  throw new Error(
    `Opraiz maxContextTokens=${endpoint.maxContextTokens} is below routed maximum ${maxRoutedContext}`,
  );
}

console.log(
  `[provider-check] Opraiz routing valid: ${routedModels.length} models, maxContextTokens=${endpoint.maxContextTokens}`,
);
