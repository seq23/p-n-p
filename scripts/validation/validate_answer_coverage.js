#!/usr/bin/env node
const fs=require('fs'); const path=require('path'); const root=path.resolve(__dirname,'../..');
const idx=JSON.parse(fs.readFileSync(path.join(root,'data/answers/answers-index.json'),'utf8')); let bad=[];
for(const a of idx){ if(!a.id||!a.direct_answer) bad.push(`bad answer ${a.id}`); const file=a.answer_page||a.canonical_page; if(file && !fs.existsSync(path.join(root,file))) bad.push(`missing ${file}`); if(a.direct_answer.length<70) bad.push(`${a.id} direct answer too short`);}
for (const f of ['llms-answers.txt','llms-entities.txt','llms-services.txt','llms-full.txt']) if(!fs.existsSync(path.join(root,f))) bad.push(`missing ${f}`);
if(bad.length){ console.error('ANSWER COVERAGE FAILED'); bad.forEach(x=>console.error('-',x)); process.exit(1);}
console.log(`Answer coverage OK: ${idx.length} records`);
