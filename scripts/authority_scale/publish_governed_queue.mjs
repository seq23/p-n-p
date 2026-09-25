#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import { createRequire } from 'node:module';import { execFileSync } from 'node:child_process';
const require=createRequire(import.meta.url);const ROOT=process.cwd();
const queuePath=path.join(ROOT,'data/publish_queue/publish_queue.json'),manifestPath=path.join(ROOT,'data/published_manifest/published_manifest.json'),universePath=path.join(ROOT,'data/queries/query_universe.json'),slugPath=path.join(ROOT,'data/slug_registry/slug_registry.json'),ledgerPath=path.join(ROOT,'data/release/daily_velocity_ledger.json');
const decision=JSON.parse(fs.readFileSync(path.join(ROOT,'data/authority_scale/velocity_decision.json'),'utf8'));const contract=JSON.parse(fs.readFileSync(path.join(ROOT,'data/authority_scale/citation_yield_contract.json'),'utf8'));const areas=JSON.parse(fs.readFileSync(path.join(ROOT,'data/service_areas/areas.json'),'utf8')).areas;const {renderPage}=require(path.join(ROOT,'templates/page-shell.js'));
const queue=JSON.parse(fs.readFileSync(queuePath,'utf8')),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),universe=JSON.parse(fs.readFileSync(universePath,'utf8')),slugs=JSON.parse(fs.readFileSync(slugPath,'utf8'));const ledger=fs.existsSync(ledgerPath)?JSON.parse(fs.readFileSync(ledgerPath,'utf8')):{schema_version:'1.0',days:{}};
const day=process.env.AUTHORITY_RUN_DATE||new Date().toISOString().slice(0,10),ceiling=Number(decision.recommended_new_url_ceiling_per_day||contract.publication_budget.current_starting_ceiling_per_day||0),used=Number(ledger.days?.[day]?.new_pages||0);
// The daily ceiling above (3/day) is not the cadence. data/cadence/policy.json caps
// new pages at new_pages_per_week, and the cadence gate enforces it after the fact by
// failing the run. Until the backlog fed this queue it never held more than it
// could publish, so the two limits never met. With drafts queued, publishing to the
// daily ceiling would put three pages up on one day and one more on each day after
// (the gate's allowance floors at one week's worth and the baseline advances on every
// cleared run), which is seven a week against a policy of one. So this stage takes
// the tighter of three limits: the daily ceiling, the policy rate over the trailing
// seven days of this ledger, and the headroom the gate itself reports right now.
const policy=JSON.parse(fs.readFileSync(path.join(ROOT,'data/cadence/policy.json'),'utf8'));const weeklyRate=Number(policy.new_pages_per_week);if(!Number.isFinite(weeklyRate)||weeklyRate<0)throw new Error('data/cadence/policy.json has no usable new_pages_per_week; refusing to publish without the cadence rate');
const dayMs=Date.parse(`${day}T00:00:00Z`);const weekUsed=Object.entries(ledger.days||{}).filter(([d])=>{const t=Date.parse(`${d}T00:00:00Z`);return t<=dayMs&&dayMs-t<7*86400000;}).reduce((n,[,v])=>n+Number(v.new_pages||0),0);const weekRemaining=Math.max(0,weeklyRate-weekUsed);
let gateHeadroom=0,gateNote='';try{let out;try{out=execFileSync('node',['scripts/cadence_gate.js','--json'],{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch(err){if(typeof err.status!=='number')throw err;out=err.stdout;}const g=JSON.parse(out);gateHeadroom=g.publication_allowance==null?0:Math.max(0,g.publication_allowance-Number(g.new_publications_since_last_run||0));gateNote=`gate allowance ${g.publication_allowance}, ${g.new_publications_since_last_run} already new since ${g.ledger_baseline_date}`;}catch(err){gateNote=`cadence gate unreadable (${String(err.message).slice(0,120)}); publishing nothing rather than guessing headroom`;}
const remaining=Math.max(0,Math.min(ceiling-used,weekRemaining,gateHeadroom));const maxArg=process.argv.find(x=>x.startsWith('--max=')),requested=maxArg?Number(maxArg.split('=')[1]):remaining,max=Math.max(0,Math.min(remaining,Number.isFinite(requested)?requested:remaining));
const entryMap=new Map(universe.map(x=>[`${x.folder}/${x.slug}`,x]));let published=0;const publishedRoutes=[];
function validateEntry(e){const required=['slug','folder','title','h1','description','serviceKey','intent','intro','quickAnswer','forWho','includes','practical','faqQuestion','faqAnswer','cities','related','localContext','beforeBook','nextStep'];for(const k of required)if(e[k]===undefined||e[k]===null||(Array.isArray(e[k])&&!e[k].length)||(!Array.isArray(e[k])&&String(e[k]).trim()===''))throw new Error(`Candidate ${e.folder}/${e.slug} missing ${k}`);for(const city of e.cities)if(!areas.includes(city))throw new Error(`Candidate ${e.folder}/${e.slug} uses undeclared service area ${city}`);if(String(e.quickAnswer).length<90)throw new Error(`Candidate ${e.folder}/${e.slug} quickAnswer too thin`);if(String(e.practical).length<120)throw new Error(`Candidate ${e.folder}/${e.slug} practical section too thin`);}
for(const item of queue){if(item.status!=='queued'||published>=max)continue;const key=`${item.folder}/${item.slug}`,e=entryMap.get(key);if(!e)throw new Error(`Queued item missing query-universe entry ${key}`);validateEntry(e);const rel=`${item.folder}/${item.slug}.html`;if(fs.existsSync(path.join(ROOT,rel)))throw new Error(`Queued route already exists ${rel}; use governed repair scope instead of republishing`);fs.mkdirSync(path.dirname(path.join(ROOT,rel)),{recursive:true});fs.writeFileSync(path.join(ROOT,rel),renderPage(e));item.status='published';if(!manifest.some(m=>m.slug===item.slug&&m.folder===item.folder))manifest.push({slug:item.slug,folder:item.folder,path:`/${rel}`});if(!slugs.includes(key))slugs.push(key);published++;publishedRoutes.push(`/${item.folder}/${item.slug}`);}
// A rendered page is not yet a finished page. Three passes write into published
// pages after the generator (README, "Read this before running build:all"): the
// related-pages block, the Clarity tag, and the served URL form. This stage never
// ran them, so the first page it published would have shipped orphaned, untracked
// and pointing its canonical at a redirect, and validate:retrofit-integrity would
// have failed the cycle. The sitemap goes first because the related-pages pass
// reads it to know what is published. --only keeps every frozen page as accepted.
//
// A new page also needs inbound links, or validate:link-reachability fails it as an
// orphan. The pages whose related list now names it are frozen, so they are written
// under an exact mutation scope - only those routes - which authority:scale:freeze
// then re-accepts and authority:scale:clear-scope closes, both later in the cycle.
if(published){const run=(args)=>execFileSync('node',args,{cwd:ROOT,stdio:'inherit'});const rels=publishedRoutes.map(r=>`${r.slice(1)}.html`);run(['scripts/generators/update_sitemap.js']);
  const linkIn=JSON.parse(execFileSync('node',['scripts/build_related_navigation.js',`--link-in=${rels.join(',')}`,'--list-link-in'],{cwd:ROOT,encoding:'utf8'}));
  const scopeRoutes=[...publishedRoutes,...linkIn.link_in_writers.map(r=>`/${r.replace(/\.html$/,'')}`)];
  run(['scripts/authority_scale/frozen_outputs.mjs','prepare-scope',...scopeRoutes]);
  run(['scripts/build_related_navigation.js','--write',`--only=${rels.join(',')}`,`--link-in=${rels.join(',')}`]);run(['scripts/install_clarity.js']);run(['scripts/normalize_public_urls.js']);}
if(published){ledger.days=ledger.days||{};ledger.days[day]={new_pages:used+published,ceiling,updated_at:new Date().toISOString()};fs.writeFileSync(queuePath,JSON.stringify(queue,null,2)+'\n');fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(slugPath,JSON.stringify(slugs.sort(),null,2)+'\n');fs.writeFileSync(ledgerPath,JSON.stringify(ledger,null,2)+'\n');}
// Rule 0: no stage may exit 0 having done nothing. Publishing zero pages is often
// legitimate here, but "success" with no explanation is how a create stage reports
// green for weeks while the queue quietly stays empty. The stop is now named, and the
// name distinguishes the three very different reasons for it: the cadence cap is
// holding (working as designed), the queue is drained and nothing refills it (a real
// gap in the loop, currently 29/29 published), or a candidate exists but was skipped.
const queuedRemaining=queue.filter(x=>x.status==='queued').length;
const statusCounts=queue.reduce((acc,x)=>{acc[x.status||'unknown']=(acc[x.status||'unknown']||0)+1;return acc;},{});
let stop_reason=null,stop_detail=null;
if(!published){
  if(!queue.length){stop_reason='QUEUE_EMPTY';stop_detail='data/publish_queue/publish_queue.json holds no items at all.';}
  else if(!queuedRemaining){stop_reason='QUEUE_EXHAUSTED_NOTHING_REFILLS_IT';stop_detail=`All ${queue.length} publish-queue items are already published (${JSON.stringify(statusCounts)}) and no stage adds new ones. This stage cannot publish until the queue is refilled from evidence-backed demand in data/authority_scale/query_atlas.json. Reported as a named stop, not as a successful publication run.`;}
  else if(remaining<=0){stop_reason='CADENCE_CEILING_REACHED';stop_detail=`${queuedRemaining} item(s) stay queued. Limits: ${used} of ${ceiling} daily used on ${day}; ${weekUsed} of ${weeklyRate} weekly used over the trailing 7 days; ${gateNote}. The cap is holding, which is the intended behaviour.`;}
  else{stop_reason='MAX_ZERO_REQUESTED';stop_detail=`${queuedRemaining} item(s) are queued with ${remaining} slot(s) of headroom, but the requested maximum was ${max}.`;}
}
console.log(JSON.stringify({day,ceiling,already_used:used,weekly_rate:weeklyRate,week_used:weekUsed,cadence_gate:gateNote,remaining_before_run:remaining,published,published_routes:publishedRoutes,queue_status_counts:statusCounts,queued_remaining:queuedRemaining,stop_reason,stop_detail},null,2));
if(stop_reason)console.log(`[authority-publish] NAMED STOP ${stop_reason}: ${stop_detail}`);
