#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};

const forbiddenInValidation = [
  /\bbuild:/,
  /\bpublish:/,
  /\bdeploy\b/,
  /\bsubmit\b/,
  /\bindexnow\b/i,
  /\bgsc\b/i,
  /\brepair\b/i,
  /\bself[-:]?heal\b/i,
  /scripts\/generators\//,
  /distribution_scripts\//,
  /npm\s+(install|ci|update)\b/,
  /\bnpx\b/,
  /wrangler\b/i
];

const errors = [];

for (const [name, command] of Object.entries(scripts)) {
  if (!name.startsWith('validate:')) continue;
  for (const pattern of forbiddenInValidation) {
    if (pattern.test(command)) {
      errors.push(`${name} includes mutating/setup command: ${command}`);
      break;
    }
  }
}

const validationDir = path.join(root, 'scripts', 'validation');
for (const file of fs.readdirSync(validationDir)) {
  if (!file.endsWith('.js')) continue;
  const rel = `scripts/validation/${file}`;
  const body = fs.readFileSync(path.join(validationDir, file), 'utf8');
  if (/fs\.(writeFileSync|appendFileSync|rmSync|unlinkSync|renameSync|cpSync|mkdirSync)/.test(body)) {
    errors.push(`${rel} mutates files; validators must inspect only`);
  }
}

if (errors.length) {
  console.error('VALIDATION FAIL: validation profile purity failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Validation profile purity OK: validate:* scripts and validators are non-mutating.');
