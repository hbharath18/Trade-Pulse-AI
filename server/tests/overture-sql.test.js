import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DuckDBInstance} from '@duckdb/node-api';

/* Runs the REAL overtureCandidates() SQL in DuckDB against a local parquet file that has the Overture places schema shape
   (names.primary, taxonomy.primary/hierarchy/alternates, addresses[], websites[], phones[], emails[], operating_status, bbox).
   No network. Category NAMES in the fixture are illustrative; the field structure is the documented Overture structure. */
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tp-overture-'));
const file=path.join(dir,'places.parquet');
const q=s=>s==null?'NULL':`'${String(s).replace(/'/g,"''")}'`;
const row=(id,name,primary,hier,alts,loc,reg,site,extra={})=>`(${q(id)},{'primary':${q(name)}},{'primary':${q(primary)},'hierarchy':[${hier.map(q)}],'alternates':${alts?`[${alts.map(q)}]`:'NULL'}},[{'freeform':'1 Main St','locality':${q(loc)},'region':${q(reg)}}],${site?`[${q(site)}]`:'NULL'},['+13035550100'],${extra.email?`[${q(extra.email)}]`:'NULL'},${q(extra.status||'open')},{'xmin':${extra.x??-104.99},'xmax':${extra.x??-104.99},'ymin':${extra.y??39.74},'ymax':${extra.y??39.74}})`;
const rows=[
 row('a1','Mile High Singing Bowls','gift_shop',['shopping','gift_shop'],null,'Denver','CO','https://bowls.example'),
 row('a2','Crystal Cave','crystal_shop',['shopping','crystal_shop'],null,'Denver','CO','https://cave.example'),
 row('a3','Plain Name Emporium','retail_store',['shopping','retail_store'],['spiritual_shop'],'Denver','CO','https://emporium.example'),          // matched ONLY via taxonomy.alternates
 row('a4','Hallmark Cards','gift_shop',['shopping','gift_shop'],null,'Denver','CO','https://cards.example'),
 row('a5','Chandra Yoga','yoga_studio',['active_life','yoga_studio'],null,'Denver','CO','https://yoga.example'),
 row('a6','Old Bowls Closed','gift_shop',['shopping','gift_shop'],null,'Denver','CO','https://closed.example',{status:'permanently_closed'}),
 row('a7','Bowls In Boulder','gift_shop',['shopping','gift_shop'],null,'Boulder','CO','https://boulder.example'),                           // wrong city
 row('a8','Himalayan Unlocalised','gift_shop',['shopping','gift_shop'],null,null,null,'https://unloc.example'),                              // empty locality/region
 row('a9','Tibetan No Website','gift_shop',['shopping','gift_shop'],null,'Denver','CO',null),                                                  // no website
 row('b1','Edge Bowls (west tile)','gift_shop',['shopping','gift_shop'],null,'Denver','CO','https://edge.example',{x:-105.05,y:39.70}),
 row('b2','Tibetan Gifts With Email','gift_shop',['shopping','gift_shop'],null,'Denver','CO','https://tgifts.example',{email:'hello@tgifts.example'}),
];
const bbox={south:39.6,north:39.9,west:-105.1,east:-104.8};
async function build(extraRows=[]){
 const inst=await DuckDBInstance.create(':memory:');const c=await inst.connect();
 await c.run(`CREATE TABLE p AS SELECT * FROM (VALUES ${[...rows,...extraRows].join(',')}) t(id,names,taxonomy,addresses,websites,phones,emails,operating_status,bbox)`);
 await c.run(`COPY p TO '${file.replace(/\\/g,'/')}' (FORMAT PARQUET)`);c.closeSync?.();inst.closeSync?.();
}
const run=async(env={})=>{
 const old={};for(const [k,v] of Object.entries({OVERTURE_LOCAL_PARQUET:file,...env})){old[k]=process.env[k];process.env[k]=v;}
 try{const {overtureCandidates}=await import('../discovery.js?x='+Math.random());return await overtureCandidates({city:'Denver',state:'Colorado',bbox,category:'Singing Bowls'});}
 finally{for(const [k,v] of Object.entries(old))v===undefined?delete process.env[k]:process.env[k]=v;}
};
test.before(()=>build());
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));

test('real SQL: relevant specialist listings come first, de-duplicated, closed / wrong-city / website-less rows excluded',async()=>{
 const {records}=await run();
 const names=records.map(r=>r.companyName);
 assert.ok(names.includes('Mile High Singing Bowls')&&names.includes('Crystal Cave'));
 assert.ok(!names.includes('Old Bowls Closed'),'permanently closed must be excluded');
 assert.ok(!names.includes('Bowls In Boulder'),'other city must be excluded');
 assert.ok(!names.includes('Tibetan No Website'),'listings without a website cannot be enriched');
 assert.ok(!names.includes('Himalayan Unlocalised'),'empty locality excluded by default');
 assert.equal(names.length,new Set(records.map(r=>r.sourceId)).size,'no duplicates across tiles');
 assert.ok(names.indexOf('Mile High Singing Bowls')<names.indexOf('Hallmark Cards'),'bowl-named listings are ranked before generic gift shops');
 assert.ok(names.indexOf('Mile High Singing Bowls')<names.indexOf('Chandra Yoga'),'studios are ranked last');
});
test('real SQL: matches the taxonomy hierarchy/alternates, not only taxonomy.primary',async()=>{
 const {records}=await run();
 assert.ok(records.some(r=>r.companyName==='Plain Name Emporium'),'row matched only via taxonomy.alternates (spiritual_shop) must be found');
});
test('real SQL: tile-boundary listings are found and carry phone/email from the listing',async()=>{
 const {records}=await run();
 assert.ok(records.some(r=>r.companyName.startsWith('Edge Bowls')));
 const g=records.find(r=>r.companyName==='Tibetan Gifts With Email');assert.equal(g.email,'hello@tgifts.example');assert.equal(g.phone,'+13035550100');
});
test('real SQL: OVERTURE_INCLUDE_UNLOCALIZED opts in rows with empty locality/region inside the box',async()=>{
 const {records}=await run({OVERTURE_INCLUDE_UNLOCALIZED:'true'});
 assert.ok(records.some(r=>r.companyName==='Himalayan Unlocalised'));
});
test('real SQL: studio terms are dropped from the query when studio checks are disabled',async()=>{
 const {records}=await run({MAX_STUDIO_CHECKS_PER_SCAN:'0'});
 assert.ok(!records.some(r=>r.companyName==='Chandra Yoga'));
});
test('real SQL: a tile that reaches the row cap is reported, and the cut falls on the least relevant rows',async()=>{
 const many=[];for(let i=0;i<150;i++)many.push(row('z'+i,'Generic Gifts '+String(i).padStart(3,'0'),'gift_shop',['shopping','gift_shop'],null,'Denver','CO','https://g'+i+'.example',{x:-104.95,y:39.8}));
 await build(many);
 const {records,warning}=await run({OVERTURE_ROWS_PER_TILE:'100',OVERTURE_GRID:'1'});
 assert.match(warning,/OVERTURE_ROWS_PER_TILE=100/);
 assert.equal(records.length,100);
 assert.ok(records.some(r=>r.companyName==='Mile High Singing Bowls'),'specialist rows survive truncation');
});
