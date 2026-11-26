import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

/* End-to-end through the REAL Express API + SQLite + crawler + classifier, with fake businesses and fake websites (no network).
   Pipeline under test: POST /api/discover -> providers -> category scoring -> dedupe -> crawl -> evidence -> email -> qualification
   -> SQLite -> GET /api/leads, /api/research, /api/discovery/status -> CSV export. */
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tp-e2e-'));
process.env.DB_PATH=path.join(dir,'e2e.sqlite');process.env.TRADEPULSE_NO_LISTEN='1';
process.env.MAX_STUDIO_CHECKS_PER_SCAN='50';process.env.ENABLE_HUNTER='false';
const {app,testHooks}=await import('../index.js');
const {enrichBusinessLeads}=await import('../email-enrichment.js');
const {normalizeCandidate}=await import('../discovery.js');
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);const ts=require('typescript');
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const csvSrc=fs.readFileSync(path.resolve(__dirname,'../../src/services/csv.ts'),'utf8');
const {buildVerifiedCsv}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(csvSrc,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));

/* ----- fake web ----- */
const page=(body,title='Home')=>new Response(`<html><head><title>${title}</title></head><body>${body}</body></html>`,{status:200,headers:{'content-type':'text/html'}});
const redirect=l=>new Response(null,{status:301,headers:{location:l}});
let fetchCount=0;
const SITES={
 'http://himalayanbowls.example/':()=>redirect('https://www.himalayanbowls.example/'),
 'https://www.himalayanbowls.example/':()=>page('<a href="/collections/singing-bowls">Singing bowls</a> info@himalayanbowls.example'),
 'https://www.himalayanbowls.example/collections/singing-bowls':()=>page('<h1>Hand-hammered Tibetan singing bowls</h1><p>7 inch bowl $89 Add to cart</p>'),
 'https://nepalcrafts.example/':()=>page('<a href="/wholesale">Wholesale</a> sales@nepalcrafts.example'),
 'https://nepalcrafts.example/wholesale':()=>page('Wholesale Himalayan singing bowls and Nepalese handicrafts for retailers. Trade pricing available.'),
 'https://mysticcrystals.example/':()=>page('Crystals, tarot decks and incense. hello@mysticcrystals.example'),
 'https://chandrayoga.example/':()=>page('Vinyasa classes weekly. hello@chandrayoga.example'),
 'https://pawtyyoga.example/':()=>page('Some guests like to relax with singing bowls while puppies play. hello@pawtyyoga.example'),
 'https://tibetantreasures.example/':()=>new Response('Forbidden',{status:403}),
 'https://bowlbarn.example/':()=>page('<a href="/products/bowl">Shop</a>'),
 'https://bowlbarn.example/products/bowl':()=>page('<h1>Tibetan singing bowl</h1>$120 in stock Add to cart'),
 'https://bloggifts.example/':()=>page('<a href="/blog/bowls">Blog</a> hello@bloggifts.example'),
 'https://bloggifts.example/blog/bowls':()=>page('Our guide to Tibetan singing bowls and their history in meditation.'),
 'https://echosound.example/':()=>page('Our sound bath sessions use Tibetan singing bowls and crystal bowls. book@echosound.example'),
 'https://gonedomain.example/':()=>{throw Object.assign(new TypeError('fetch failed'),{cause:{code:'ENOTFOUND'}})},
};
const fetchImpl=async url=>{fetchCount++;if(/robots\.txt|sitemap/.test(url))return new Response('',{status:404});const h=SITES[url];if(!h)return new Response('',{status:404});return h();};
const dnsOk=async()=>[{address:'93.184.216.34'}],mxOk=async()=>[{exchange:'mx',priority:1}];
const listing=(name,site,kind,extra={})=>normalizeCandidate({name,website:site,city:'Denver',state:'CO',kind,address:'1 Main St',...extra},'Overture Maps','Denver','Colorado','Singing Bowls');
testHooks.providers={
 geocode:async()=>({south:39.6,north:39.9,west:-105.1,east:-104.8}),
 geoapify:async()=>({records:[]}),overpass:async()=>({records:[]}),
 overture:async()=>({records:[
  listing('Himalayan Bowls Denver','http://himalayanbowls.example','gift_shop'),
  listing('Himalayan Bowls Denver LLC','https://www.himalayanbowls.example/about','gift_shop'),      // duplicate domain
  listing('Nepal Crafts Wholesale','https://nepalcrafts.example','wholesaler'),
  listing('Mystic Crystal Shop','https://mysticcrystals.example','crystal_shop'),                      // metaphysical, no relevant products
  listing('Chandra Yoga','https://chandrayoga.example','yoga_studio'),
  listing('Pawty Yoga','https://pawtyyoga.example','yoga_studio'),
  listing('Denver Guitar Emporium','https://guitars.example','guitar_store'),                           // unrelated shop
  listing('Mile High Violins','https://violins.example','musical_instrument_store'),
  listing('First Baptist Church Gift Shop','https://church.example','church'),
  listing('Tibetan Treasures','https://tibetantreasures.example','gift_shop'),                          // blocked by access restrictions
  listing('Bowl Barn','https://bowlbarn.example','gift_shop'),                                          // strong evidence, NO email
  listing('Blog Gifts','https://bloggifts.example','gift_shop'),                                        // public email, weak evidence
  listing('Echo Energetics Sound Bath Studio','https://echosound.example','spiritual_center'),
  listing('Gone Domain Gifts','https://gonedomain.example','gift_shop'),
 ]}),
 enrich:(rows,o)=>enrichBusinessLeads(rows,{...o,inspectOptions:{...o.inspectOptions,fetchImpl,lookup:dnsOk,resolveMx:mxOk,resolve4:mxOk,retryDelayMs:1,pageDelayMs:0}}),
};
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
const api=async(p,opt)=>{const r=await fetch(base+p,opt);return {status:r.status,data:await r.json()};};
const post=(p,b)=>api(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
test.after(()=>{
 server.close();
 try { fs.rmSync(dir,{recursive:true,force:true}); } catch {}
});

let first;
test('API: full discovery run classifies every kind of business correctly',async()=>{
 first=await post('/api/discover',{category:'Singing Bowls',city:'Denver',state:'Colorado'});
 assert.equal(first.status,200);
 const names=first.data.leads.map(l=>l.companyName);
 assert.ok(names.includes('Himalayan Bowls Denver'),'retailer with a product listing (after http->https->www redirect)');
 assert.ok(names.includes('Nepal Crafts Wholesale'),'wholesale supplier');
 assert.ok(names.includes('Blog Gifts'),'public email + weak evidence is only a Potential lead');
 assert.ok(names.includes('Echo Energetics Sound Bath Studio'),'sound-bath studio as equipment user');
 assert.ok(names.includes('Mystic Crystal Shop'),'crystal & incense shop qualifies as Potential Buyer without exact product listing');
 for(const bad of ['Chandra Yoga','Pawty Yoga','Denver Guitar Emporium','Mile High Violins','First Baptist Church Gift Shop','Tibetan Treasures','Bowl Barn','Gone Domain Gifts'])assert.ok(!names.includes(bad),bad+' must not be an outreach candidate');
 const by=n=>first.data.leads.find(l=>l.companyName===n);
 assert.equal(by('Himalayan Bowls Denver').buyerTier,'Strong match');assert.equal(by('Himalayan Bowls Denver').evidenceClass,'confirmed-seller');
 assert.match(by('Himalayan Bowls Denver').evidenceUrl,/collections\/singing-bowls/);assert.match(by('Himalayan Bowls Denver').evidenceExcerpt,/singing bowls/i);
 assert.equal(by('Himalayan Bowls Denver').websiteFinalUrl,'https://www.himalayanbowls.example/');
 assert.equal(by('Nepal Crafts Wholesale').evidenceClass,'wholesale-evidence');
 assert.equal(by('Blog Gifts').evidenceClass,'retailer-mention');assert.equal(by('Blog Gifts').buyerTier,'Potential');
 assert.equal(by('Echo Energetics Sound Bath Studio').evidenceClass,'equipment-user');assert.match(by('Echo Energetics Sound Bath Studio').persona,/equipment purchaser/);
 assert.equal(by('Mystic Crystal Shop').buyerTier,'Potential');assert.equal(by('Mystic Crystal Shop').evidenceClass,'specialty-retailer');
 assert.equal(first.data.leads.length,5);
 assert.equal(first.data.leads.filter(l=>/himalayanbowls/.test(l.website)).length,1,'duplicate domain collapsed');
});
test('API: research leads keep the rest, with reasons, separate from buyers',async()=>{
 const r=first.data.research;const by=n=>r.find(x=>x.companyName===n);
 assert.equal(by('Bowl Barn').buyerTier,'Strong match');assert.equal(by('Bowl Barn').email,'');                         // strong evidence, no email
 assert.equal(by('Tibetan Treasures').websiteStatus,'unreachable');assert.equal(by('Tibetan Treasures').websiteFailureReason,'blocked_by_site');
 assert.equal(by('Pawty Yoga').evidenceClass,'mention-only');assert.equal(by('Pawty Yoga').buyerTier,'Research');
 assert.equal(by('Chandra Yoga'),undefined,'generic yoga with no product evidence is not kept');
 assert.equal(by('Denver Guitar Emporium'),undefined);assert.equal(by('Mile High Violins'),undefined);assert.equal(by('First Baptist Church Gift Shop'),undefined);
 assert.equal(by('Gone Domain Gifts'),undefined,'unreachable GENERIC gift shop is not worth keeping');
});
test('API: stats and status contain truthful counters and failure reasons',async()=>{
 const st=first.data.stats;
 assert.equal(st.businessesFetched,14);assert.equal(st.websitesFailed,2);assert.deepEqual(st.failureReasons,{blocked_by_site:1,dns_not_found:1});
 assert.equal(st.providerCounts.Overture,14);assert.ok(st.taxonomyBreakdown.some(t=>t.kind==='gift_shop'));
 assert.ok(st.classCounts['confirmed-seller']>=2);assert.equal(st.rejections.unrelatedCategories,3,'guitar, violin, church dropped by category');assert.equal(st.rejections.duplicateListings,1,'second listing of the same domain');
 assert.ok(st.rejections.missingEmails>=1);assert.equal(st.outreachReady,5);
 const status=(await api('/api/discovery/status')).data;
 assert.equal(status.running,false);assert.equal(status.stage,'complete');assert.equal(status.websitesChecked,status.websitesTotal);assert.equal(status.outreachCandidates,5);
});
test('API: SQLite persistence matches the response, and nothing was invented',async()=>{
 const leads=(await api('/api/leads')).data.leads,research=(await api('/api/research')).data.leads;
 assert.equal(leads.length,5);assert.ok(research.length>=3);
 assert.equal(new Set(leads.map(l=>l.id)).size,leads.length);
 for(const l of leads){assert.ok(/@/.test(l.email));assert.ok(l.evidenceUrl.startsWith('https://'));assert.match(l.emailVerification,/not verified/i);assert.equal(l.phone,'');}
 assert.ok(research.every(r=>!leads.some(l=>l.id===r.id)),'no overlap between buyers and research');
});
test('API: re-running reuses cached site checks (no re-crawl) and does not duplicate records',async()=>{
 const before=fetchCount;
 const again=await post('/api/discover',{category:'Singing Bowls',city:'Denver',state:'Colorado'});
 assert.equal(again.status,200);assert.equal(fetchCount,before,'second scan must not fetch any site again');
 assert.equal(again.data.stats.cachedSites>=10,true);
 assert.equal(again.data.saved.added,0);assert.equal((await api('/api/leads')).data.leads.length,5);
});
test('export: nine-column CSV from the saved buyers, no fabricated data',async()=>{
 const leads=(await api('/api/leads')).data.leads;
 const csv=buildVerifiedCsv(leads,'2026-11-24').slice(1).split('\r\n');
 assert.equal(csv[0],'"DATE","SR NO.","CATEGORY","PRODUCT NAME","COMPANY NAME","LOCATION","WEBSITE","EMAIL","CONTACT NO."');
 assert.equal(csv.length,6);
 for(const line of csv.slice(1)){assert.equal(line.split('","').length,9);assert.ok(line.endsWith(',""'),'missing phone stays empty');}
});
test('regression: Gmail module is still mounted and safe-by-default',async()=>{
 const st=await api('/api/gmail/status');assert.equal(st.status,200);assert.equal(st.data.dailyLimit,50);assert.equal(st.data.connected,false);
 const send=await post('/api/outreach/send',{leadIds:[(await api('/api/leads')).data.leads[0].id],subjectTemplate:'s',bodyTemplate:'b',approvalPhrase:'SEND 1'});
 assert.equal(send.status>=400,true,'sending without a connected Gmail account must fail');
});
test('regression: clearing buyers also resets the site-check cache',async()=>{
 const before=fetchCount;
 assert.equal((await post('/api/leads/clear',{confirmation:'CLEAR_BUYERS'})).status,200);
 assert.equal((await api('/api/leads')).data.leads.length,0);
 await post('/api/discover',{category:'Singing Bowls',city:'Denver',state:'Colorado'});
 assert.ok(fetchCount>before,'cache cleared => sites are crawled again');
});
