#!/usr/bin/env node
/**
 * IndexNow verifies ownership by fetching https://<host>/<key>.txt and comparing
 * its body to the key. Hard-fails unless exactly one root key file exists, its
 * body equals its name, and the deploy lane still auto-detects that file and
 * submits both the priority list and the full sitemap batch.
 */
import fs from 'node:fs';

const errors = [];
const keys = fs.readdirSync('.').filter((f) => /^[0-9a-fA-F-]{32,64}\.txt$/.test(f));
if (keys.length !== 1) errors.push(`${keys.length} root IndexNow key files (${keys.join(', ')}); exactly 1 required`);
const key = keys[0]?.replace(/\.txt$/, '');
if (key && fs.readFileSync(keys[0], 'utf8').trim() !== key) errors.push(`${keys[0]} body does not equal its key`);
const deploy = fs.readFileSync('distribution_scripts/deploy_distribution.sh', 'utf8');
if (!deploy.includes("grep -E './[0-9a-fA-F-]{32,64}\\.txt$'")) errors.push('deploy_distribution.sh no longer auto-detects the root key file');
for (const f of ['$PRIORITY_FILE', '$BATCH_FILE']) if (!deploy.includes(`indexnow_submit.sh --host "$HOST" --key "$KEY" --file "${f}"`)) errors.push(`deploy_distribution.sh no longer submits ${f}`);
if (errors.length) { console.error(`indexnow-key: FAIL (${errors.length})`); errors.forEach((e) => console.error(`  - ${e}`)); process.exit(1); }
console.log(`indexnow-key: OK - /${key}.txt serves its key; deploy lane submits priority + sitemap batch`);
