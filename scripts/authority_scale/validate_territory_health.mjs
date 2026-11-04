#!/usr/bin/env node
import fs from 'node:fs';
const d=JSON.parse(fs.readFileSync('data/authority_scale/territory_health.json','utf8'));
const kept=JSON.parse(fs.readFileSync('data/search_intelligence/page_quality_kept.json','utf8'));
const errors=[];
const required=['seasonal_porch_decorating','party_decor','hotel_room_decor','grazing_table_styling'];
for(const key of required){
  const expected=kept.territories[key], actual=d.territories?.[key];
  if(!expected?.length || !actual) { errors.push(`missing_or_empty:${key}`); continue; }
  if(actual.public_surface_count!==expected.length || expected.some(route=>!actual.sample_routes.includes(route))) errors.push(`territory_ledger_mismatch:${key}`);
  for(const route of expected){
    const served=route.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    if(!kept.kept.includes(served)||!fs.existsSync(route.slice(1))) errors.push(`territory_route_unpublished:${route}`);
  }
}
console.log(JSON.stringify({ok:!errors.length,territories:d.territories,errors},null,2));
if(errors.length)process.exit(1);
