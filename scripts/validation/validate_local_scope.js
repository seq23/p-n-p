#!/usr/bin/env node
const fs=require('fs'); const path=require('path'); const root=path.resolve(__dirname,'../..');
const matrix=JSON.parse(fs.readFileSync(path.join(root,'data/local_matrix/service_city_occasion_matrix.json'),'utf8'));
const allowed=['Memphis, TN','Germantown, TN','Collierville, TN','Bartlett, TN','Lakeland, TN','Arlington, TN','Southaven, MS','Olive Branch, MS'];
let bad=[]; for(const r of matrix.rows){ if(!allowed.includes(r.city)) bad.push(`outside area: ${r.city}`);}
if(!/Memphis metro only/i.test(matrix.scope)) bad.push('matrix scope must stay Memphis metro only');
if(bad.length){ console.error('LOCAL SCOPE FAILED'); bad.forEach(x=>console.error('-',x)); process.exit(1);}
console.log(`Local scope OK: ${matrix.rows.length} mapped service/city/occasion rows`);
