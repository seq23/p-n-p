#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import crypto from 'node:crypto';
const ROOT=process.cwd(), BASE=path.join(ROOT,'data/authority_scale/fanout_100k');
const idx=JSON.parse(fs.readFileSync(path.join(BASE,'index.json'),'utf8'));
const sizeArg=process.argv.find(v=>v.startsWith('--size=')); const size=Number(sizeArg?sizeArg.split('=')[1]:2500);
const runDate=process.env.AUTHORITY_RUN_DATE || new Date().toISOString().slice(0,10);
const seed=parseInt(crypto.createHash('sha256').update(runDate).digest('hex').slice(0,12),16);
const all=[];
for(const sh of idx.shards){const txt=zlib.gunzipSync(fs.readFileSync(path.join(ROOT,sh.path))).toString('utf8').trim(); if(txt)for(const line of txt.split(/\n/))all.push(JSON.parse(line));}
const start=seed%all.length, stride=7919, out=[]; for(let i=0;i<Math.min(size,all.length);i++)out.push(all[(start+(i*stride))%all.length]);
const dest=path.join(ROOT,'data/authority_scale/operational_window.json');
fs.writeFileSync(dest,JSON.stringify({schema_version:'1.0',generated_for_date:runDate,source:'data/authority_scale/fanout_100k/index.json',window_size:out.length,start_offset:start,stride,total_runway:all.length,opportunities:out},null,2)+'\n');
console.log(`PNP OPERATIONAL WINDOW: ${out.length}/${all.length} start=${start}`);
