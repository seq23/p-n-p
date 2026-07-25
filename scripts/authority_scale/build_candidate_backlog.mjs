#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path';
const ROOT=process.cwd();
const window=JSON.parse(fs.readFileSync(path.join(ROOT,'data/authority_scale/operational_window.json'),'utf8'));
const admissions=JSON.parse(fs.readFileSync(path.join(ROOT,'data/content/page_admission_registry.json'),'utf8')).admissions||[];
const areas=JSON.parse(fs.readFileSync(path.join(ROOT,'data/service_areas/areas.json'),'utf8')).areas.map(x=>x.replace(',',''));
const stop=new Set(['what','is','how','does','for','in','the','a','an','to','of','and','with','while','before','when','local','provider','exploring','problem','comparing','solution','approaches','evaluating','requesting','quote','improving','existing','setup','plan']);
const tok=s=>new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]+/g,' ').split(/\s+/).filter(x=>x.length>2&&!stop.has(x)));
const sim=(a,b)=>{const A=tok(a),B=tok(b);let i=0;for(const x of A)if(B.has(x))i++;const u=new Set([...A,...B]).size;return u?i/u:0;};
const existingText=admissions.map(a=>{const html=fs.readFileSync(path.join(ROOT,a.rendered_file),'utf8');const title=(html.match(/<title>([^<]+)/i)||[])[1]||'';const h1=(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||'';const desc=(html.match(/<meta[^>]+name=[\"']description[\"'][^>]+content=[\"']([^\"']+)/i)||html.match(/<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+name=[\"']description[\"']/i)||[])[1]||'';return {route:`${a.route}.html`,text:`${a.rendered_file} ${title} ${h1.replace(/<[^>]+>/g,' ')} ${desc}`};});
const stageWeight={vendor_evaluation:18,booking_preparation:16,solution_aware:12,problem_aware:8,optimization:6};
const formatWeight={decision_matrix:15,comparison:14,cost_guide:14,checklist:12,direct_answer:11,framework:10,operational_guide:10,faq:8,use_case_guide:8};
const scored=[];
for(const o of window.opportunities||[]){
  if(!areas.includes(o.geography)) continue;
  let best={score:0,route:null}; const topicTokens=[...tok(o.topic)]; for(const e of existingText){const E=tok(e.text);const coverage=topicTokens.length?topicTokens.filter(t=>E.has(t)).length/topicTokens.length:0;const s=Math.max(coverage,sim(`${o.topic} ${o.geography}`,e.text));if(s>best.score)best={score:s,route:e.route};}
  const score=(stageWeight[o.buyer_stage]||0)+(formatWeight[o.recommended_format]||0)+(o.geography==='Memphis TN'?8:3)+(best.score>=0.48?12:0);
  const disposition=best.score>=0.67?'IMPROVE_EXISTING':(best.score<=0.34?'NEW_PAGE_CANDIDATE':'CLUSTER_OR_SECTION_CANDIDATE');
  scored.push({...o,priority_score:Number(score.toFixed(2)),best_existing_route:best.route,best_existing_similarity:Number(best.score.toFixed(4)),recommended_disposition:disposition,publication_status:'NOT_ADMITTED'});
}
scored.sort((a,b)=>b.priority_score-a.priority_score||a.query.localeCompare(b.query));
const dedup=[]; const clusters=new Set();
for(const r of scored){const key=`${r.semantic_cluster}|${r.recommended_format}|${r.geography}|${r.buyer_stage}`;if(clusters.has(key))continue;clusters.add(key);dedup.push(r);if(dedup.length>=250)break;}
const out={schema_version:'1.0',generated_for_date:window.generated_for_date,source_window_size:window.window_size,candidate_count:dedup.length,policy:{new_url:'Only materially distinct intent with supported substance may become a new URL.',improve_existing:'Prefer repair/expansion when an existing route is a strong intent match.',geography:'No geography outside data/service_areas/areas.json may be admitted.'},candidates:dedup};
fs.writeFileSync(path.join(ROOT,'data/authority_scale/candidate_backlog.json'),JSON.stringify(out,null,2)+'\n');
console.log(`PNP CANDIDATE BACKLOG: ${dedup.length}; new=${dedup.filter(x=>x.recommended_disposition==='NEW_PAGE_CANDIDATE').length}; improve=${dedup.filter(x=>x.recommended_disposition==='IMPROVE_EXISTING').length}`);
