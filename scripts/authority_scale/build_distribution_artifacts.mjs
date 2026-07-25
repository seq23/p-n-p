#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';
const ROOT=process.cwd(), sitemap=fs.readFileSync(path.join(ROOT,'sitemap.xml'),'utf8');
const urls=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]).filter(Boolean);
if(!urls.length)throw new Error('No URLs in sitemap.xml');
const admissions=JSON.parse(fs.readFileSync(path.join(ROOT,'data/content/page_admission_registry.json'),'utf8')).admissions||[];
const admittedUrls=admissions.filter(x=>x.status==='admitted').map(x=>`https://porchandparty901.com${x.route}.html`);
const priority=[...new Set([...admittedUrls.slice(0,60),'https://porchandparty901.com/','https://porchandparty901.com/pricing.html','https://porchandparty901.com/contact.html'])].filter(u=>urls.includes(u));
fs.mkdirSync(path.join(ROOT,'.build'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'.build/indexnow-priority.txt'),priority.join('\n')+'\n');
fs.writeFileSync(path.join(ROOT,'.build/indexnow-batch.txt'),urls.join('\n')+'\n');
const generatedAt=process.env.AUTHORITY_RUN_AT||(process.env.AUTHORITY_RUN_DATE?`${process.env.AUTHORITY_RUN_DATE}T00:00:00.000Z`:'2026-07-24T00:00:00.000Z');
const manifest={schema_version:'1.0',generated_at:generatedAt,host:'porchandparty901.com',sitemap:'https://porchandparty901.com/sitemap.xml',priority_url_count:priority.length,batch_url_count:urls.length,source:'validated sitemap + admitted authority registry',truth_boundary:'Preparing distribution artifacts does not prove provider submission, indexing, visibility, or citation.'};
fs.writeFileSync(path.join(ROOT,'.build/distribution-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`PNP DISTRIBUTION ARTIFACTS: priority=${priority.length} batch=${urls.length}`);
