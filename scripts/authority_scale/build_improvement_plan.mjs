#!/usr/bin/env node
import fs from 'node:fs';
const backlog=JSON.parse(fs.readFileSync('data/authority_scale/candidate_backlog.json','utf8'));
const byRoute=new Map();
function suggestion(c){const q=c.query.toLowerCase(),out=new Set(['Keep the direct answer extractable near the top and align a heading to the exact user intent.']);if(/cost|pricing|worth it/.test(q))out.add('State only verified starting-price facts already supported by the site, then explain the concrete scope factors that change a quote.');if(/vs |compare|choose a provider|options/.test(q))out.add('Use an explicit comparison or decision structure with boundaries, tradeoffs, and who each option fits.');if(/checklist|prepare|before|questions to ask/.test(q))out.add('Add a numbered checklist or booking-preparation sequence that can be extracted without surrounding prose.');if(/how to|how does|plan|take/.test(q))out.add('Use ordered steps with clear inputs, decisions, and next actions instead of narrative-only explanation.');if(/who is|for /.test(q))out.add('Add meaningful persona/use-case guidance only where the situation changes the answer; do not clone city/persona pages.');if(/ideas|examples/.test(q))out.add('Include concrete examples organized by occasion, space, budget/scope, or desired effect without inventing completed client work.');return [...out];}
for(const c of backlog.candidates||[]){if(!c.best_existing_route)continue;const key=c.best_existing_route;if(!byRoute.has(key))byRoute.set(key,{route:key,priority_score:c.priority_score,opportunities:[],recommended_improvements:new Set()});const r=byRoute.get(key);r.priority_score=Math.max(r.priority_score,c.priority_score);r.opportunities.push({query:c.query,format:c.recommended_format,disposition:c.recommended_disposition,similarity:c.best_existing_similarity});for(const x of suggestion(c))r.recommended_improvements.add(x);}
const plans=[...byRoute.values()].map(r=>({...r,opportunity_count:r.opportunities.length,opportunities:r.opportunities.slice(0,12),recommended_improvements:[...r.recommended_improvements]})).sort((a,b)=>b.priority_score-a.priority_score||b.opportunity_count-a.opportunity_count).slice(0,60);
// ---------------------------------------------------------------------------
// The measured content-block gaps have to land HERE, in the only artifact that
// says what to do to a page.
//
// The content-pattern contract measured every page against
// .clarity/content-pattern-spec.json on every run and printed the result to a CI
// log. This builder, meanwhile, derived its recommendations from its own
// hardcoded suggestion() regexes above and never read either the spec or the
// measurement. Two components each keeping their own list, with no link between
// them - so `source_block` missing on 109 of 109 pages was known, printed, and
// assigned to nobody, run after run.
//
// Joining them is what turns a coverage percentage into a named piece of work
// against a named route.
const SPEC_PATH = '.clarity/content-pattern-spec.json';
const CONTRACT_PATH = 'reports/validation/content-pattern-contract.json';
for (const f of [SPEC_PATH, CONTRACT_PATH]) {
  if (!fs.existsSync(f)) {
    console.error(`PNP IMPROVEMENT PLAN FAILED: ${f} is missing, so the measured content-block gaps cannot reach this plan. `
      + 'Building a plan that silently omits them is how they went unworked in the first place; run `npm run validate:content-pattern` first.');
    process.exit(1);
  }
}
const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const specById = new Map((spec.blocks || []).map((b) => [b.id, b]));
const appliesHere = (id) => !specById.has(id) || specById.get(id).applies_to_repo !== false;

// Rank by what the review agent actually asked for, so the busiest gap is the
// first thing a route's plan names.
const requestedFor = (id) => (specById.get(id) ? specById.get(id).requested || 0 : 0);
const gapsFull = contract.gaps_full || {};
const parity = contract.spec_producer_parity || {};
const starvedIds = new Set((parity.starved_blocks || []).map((b) => b.id));

// Route -> the blocks that route is measured as missing. A block retired with a
// named_stop is not work, so it is not queued against any route.
const blockWhy = new Map((contract.summary || []).map((s) => [s.id, s.why]));
const missingByRoute = new Map();
let joinedRoutes = 0;
for (const [blockId, routes] of Object.entries(gapsFull)) {
  if (!appliesHere(blockId)) continue;
  for (const rel of routes) {
    const route = rel.startsWith('/') ? rel : `/${rel}`;
    if (!missingByRoute.has(route)) missingByRoute.set(route, []);
    missingByRoute.get(route).push(blockId);
  }
}
for (const plan of plans) {
  const missing = (missingByRoute.get(plan.route) || [])
    .sort((a, b) => requestedFor(b) - requestedFor(a));
  if (!missingByRoute.has(plan.route)) continue;
  joinedRoutes += 1;
  plan.missing_content_blocks = missing;
  for (const id of missing) {
    const why = blockWhy.get(id) || `missing content block ${id}`;
    const starved = starvedIds.has(id)
      ? ' The emitter for this block already exists and is called on every page; what is missing is the data, not the code.'
      : '';
    plan.recommended_improvements.push(`Add the ${id} block: ${why}.${starved}`);
  }
}

// Library-wide verdicts, carried in the plan so an orphan, a starved lane and a
// named stop are visible to whoever reads the plan rather than only to whoever
// reads a CI log.
const contentBlockGaps = {
  measured_by: CONTRACT_PATH,
  measured_at: contract.generated_at,
  pages_checked: contract.pages_checked,
  truth_boundary: 'These gaps are measured against the pages present when the contract last ran. This builder runs '
    + 'before the publish step in the daily cycle, so a page published later in the same run is measured on the next '
    + 'cycle rather than this one. Over-listing is safe; a route named here is never a route that does not exist.',
  blocks: (spec.blocks || []).map((b) => {
    const measured = (contract.summary || []).find((x) => x.id === b.id) || {};
    return {
      id: b.id,
      requested: b.requested,
      applies_to_repo: b.applies_to_repo !== false,
      named_stop: b.named_stop || null,
      coverage_pct: measured.coverage_pct === undefined ? null : measured.coverage_pct,
      pages_missing: measured.pages_missing === undefined ? null : measured.pages_missing,
      lane: b.applies_to_repo === false ? 'named_stop'
        : starvedIds.has(b.id) ? 'starved_needs_data'
          : (measured.pages_missing || 0) > 0 ? 'gap_needs_content' : 'covered',
    };
  }),
  routes_joined: joinedRoutes,
};

const out={schema_version:'1.1',generated_for_date:backlog.generated_for_date,source:'data/authority_scale/candidate_backlog.json',twin_agent_used:false,twin_learning_transfer:['answer-first summaries','exact-intent headings','extractable real frameworks/checklists','explicit comparisons and decision structures','meaningful persona/use-case sections','improve existing before duplicate new URL'],truth_boundary:'This is a deterministic improvement plan, not evidence that any external engine cited or ranked a page.',route_plan_count:plans.length,content_block_gaps:contentBlockGaps,plans};fs.writeFileSync('data/authority_scale/page_improvement_plan.json',JSON.stringify(out,null,2)+'\n');console.log(`PNP IMPROVEMENT PLAN: ${plans.length} existing routes prioritized; ${joinedRoutes} carry measured content-block gaps`);
