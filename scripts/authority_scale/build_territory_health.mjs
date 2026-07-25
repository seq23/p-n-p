#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';const ROOT=process.cwd();
const dirs=['authority','answers','areas','comparisons','corporate','events','faq','guides','hubs','local','seasonal','services'];
const pages=[];for(const d of dirs){if(!fs.existsSync(d))continue;for(const n of fs.readdirSync(d).filter(x=>x.endsWith('.html'))){const rel=`${d}/${n}`,html=fs.readFileSync(rel,'utf8');const title=(html.match(/<title>([^<]+)/i)||[])[1]||'';const h1=(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||'';const desc=(html.match(/<meta[^>]+name=[\"']description[\"'][^>]+content=[\"']([^\"']+)/i)||html.match(/<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+name=[\"']description[\"']/i)||[])[1]||'';const text=`${rel} ${title} ${h1.replace(/<[^>]+>/g,' ')} ${desc}`.toLowerCase();pages.push({rel,txt:text});}}
const territories={
  seasonal_porch_decorating:[/porch decorating/,/front porch/,/porch styling/,/wreath/,/pumpkin/,/christmas porch/,/fall porch/],
  party_decor:[/party decor/,/birthday/,/celebration setup/,/event decorator/,/balloon/,/shower decor/],
  hotel_room_decor:[/hotel room/,/hotel-room/,/romantic room/,/anniversary room/,/proposal room/],
  grazing_table_styling:[/grazing table/,/grazing and event/,/styled table/,/food table/]
};
const out={schema_version:'1.0',generated_at:'2026-07-24T00:00:00.000Z',territories:{}};
for(const [name,patterns] of Object.entries(territories)){const matches=pages.filter(p=>patterns.some(re=>re.test(p.txt))).map(p=>`/${p.rel}`);out.territories[name]={public_surface_count:matches.length,sample_routes:matches.slice(0,20),status:matches.length>=5?'STRONG_BASELINE':matches.length>=2?'THIN':'GAP'};}
fs.writeFileSync('data/authority_scale/territory_health.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));
