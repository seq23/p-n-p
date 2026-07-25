#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const ROOT=process.cwd();
const dirs=['authority','answers','areas','comparisons','corporate','events','faq','guides','hubs','local','seasonal','services'];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const previousPath=path.join(ROOT,'data/content/page_admission_registry.json');
const previous=fs.existsSync(previousPath)?JSON.parse(fs.readFileSync(previousPath,'utf8')):{admissions:[]};
const old=new Map((previous.admissions||[]).map(x=>[x.route,x])); const admissions=[];
for(const d of dirs){const abs=path.join(ROOT,d);if(!fs.existsSync(abs))continue;for(const name of fs.readdirSync(abs).filter(n=>n.endsWith('.html')).sort()){
  const rel=`${d}/${name}`, route=`/${rel.replace(/\.html$/,'')}`, raw=fs.readFileSync(path.join(ROOT,rel)); const prior=old.get(route);
  admissions.push({route,rendered_file:rel,status:'admitted',family:d,source:prior?.source||'legacy_public_authority_baseline',admitted_at:prior?.admitted_at||'2026-07-24',content_sha256:sha(raw)});
}}
fs.mkdirSync(path.dirname(previousPath),{recursive:true});fs.writeFileSync(previousPath,JSON.stringify({schema_version:'1.0',generated_at:'2026-07-24T00:00:00.000Z',count:admissions.length,admissions},null,2)+'\n');
console.log(`PNP ADMISSION REGISTRY: ${admissions.length} admitted authority routes`);
