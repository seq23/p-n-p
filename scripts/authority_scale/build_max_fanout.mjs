#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const CONFIG = path.join(ROOT, 'data/authority_scale/fanout_dimensions.json');
const OUT = path.join(ROOT, 'data/authority_scale/fanout_100k');
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const targetArg = process.argv.find(v => v.startsWith('--target='));
const target = Number(targetArg ? targetArg.split('=')[1] : cfg.reference_materialization_target || 100000);
if (!Number.isInteger(target) || target < 1) throw new Error(`Invalid target ${target}`);

const dims = ['topics','intent_patterns','modifiers','audiences','geographies','formats','buyer_stages'];
for (const d of dims) if (!Array.isArray(cfg[d]) || !cfg[d].length) throw new Error(`Missing dimension ${d}`);
const theoretical = dims.reduce((n, d) => n * BigInt(cfg[d].length), 1n);
if (theoretical < BigInt(target)) throw new Error(`Insufficient capacity ${theoretical} < ${target}`);

const sha = v => crypto.createHash('sha256').update(v).digest('hex');
const slug = s => String(s).toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,120);
const clean = s => String(s).replace(/\s+/g,' ').replace(/\s+([,?.])/g,'$1').trim();
const stagePhrase = {
  problem_aware: 'while exploring the problem',
  solution_aware: 'while comparing solution approaches',
  vendor_evaluation: 'while evaluating a local provider',
  booking_preparation: 'before requesting a quote',
  optimization: 'when improving an existing setup plan'
};
function comboAt(n) {
  let x = BigInt(n); const out = {};
  for (const key of dims) { const arr = cfg[key]; out[key] = arr[Number(x % BigInt(arr.length))]; x /= BigInt(arr.length); }
  return out;
}
function queryFor(c) {
  let base = c.intent_patterns.replaceAll('{topic}', c.topics);
  return clean(`${base} ${c.modifiers} for ${c.audiences} in ${c.geographies} ${stagePhrase[c.buyer_stages] || ''}`);
}
fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT,{recursive:true});
const SHARD_SIZE = 5000; let rows=[], shards=[], seen=new Set(), cursor=0, produced=0;
function flush(){
  if(!rows.length)return;
  const part=shards.length+1, filename=`part-${String(part).padStart(5,'0')}.jsonl.gz`;
  const raw=Buffer.from(rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const gz=zlib.gzipSync(raw,{level:9,mtime:0}); fs.writeFileSync(path.join(OUT,filename),gz);
  shards.push({part,path:`data/authority_scale/fanout_100k/${filename}`,record_count:rows.length,compressed_bytes:gz.length,uncompressed_bytes:raw.length,sha256:sha(gz),first_id:rows[0].opportunity_id,last_id:rows.at(-1).opportunity_id});
  rows=[];
}
const STEP=104729n;
while(produced<target){
  if(BigInt(cursor)>=theoretical)throw new Error(`Exhausted capacity at ${produced}`);
  const sampled=(BigInt(cursor++)*STEP)%theoretical;
  const c=comboAt(sampled); const query=queryFor(c); if(seen.has(query))continue; seen.add(query);
  rows.push({
    opportunity_id:`pnp_fanout_${String(produced+1).padStart(6,'0')}_${sha(query).slice(0,10)}`,
    query,
    topic:c.topics,
    modifier:c.modifiers,
    audience:c.audiences,
    geography:c.geographies,
    recommended_format:c.formats,
    buyer_stage:c.buyer_stages,
    semantic_cluster:slug(c.topics),
    disposition:'OPPORTUNITY_ONLY',
    page_admission_status:'NOT_EVALUATED',
    source:'deterministic_max_fanout_v1'
  });
  produced++; if(rows.length>=SHARD_SIZE)flush();
}
flush();
const aggregate=sha(Buffer.from(shards.map(s=>`${s.part}:${s.record_count}:${s.sha256}:${s.first_id}:${s.last_id}`).join('\n')));
fs.writeFileSync(path.join(OUT,'index.json'),JSON.stringify({schema_version:'1.0',repo:cfg.repo,standard:cfg.standard,generated_at:'2026-07-24T00:00:00.000Z',capacity_policy:'NO_ARBITRARY_UPPER_CEILING_ON_LEGITIMATE_OPPORTUNITY_DISCOVERY',theoretical_combinations:theoretical.toString(),materialized_reference_runway:target,page_quota:false,truth_boundary:cfg.truth_boundary,compression:'gzip_jsonl',shard_count:shards.length,aggregate_sha256:aggregate,shards},null,2)+'\n');
console.log(`PNP MAX FANOUT BUILT: ${target} exact-unique opportunities across ${shards.length} shards; theoretical capacity ${theoretical}`);
