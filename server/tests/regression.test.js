import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {assessWebsite} from '../lead-quality.js';
import {inspectPublicWebsite,enrichBusinessLeads,classifyFetchError,entryVariants,extractProducts} from '../email-enrichment.js';
import {discoverBuyers,normalizeCandidate,makeLead} from '../discovery.js';
import {createStore} from '../store.js';

/* ---------- helpers: no real network is ever touched ---------- */
const html=(body,title='Site')=>`<html><head><title>${title}</title></head><body>${body}</body></html>`;
const ok=(body,headers={})=>new Response(body,{status:200,headers:{'content-type':'text/html; charset=utf-8',...headers}});
const redirect=(location,status=301)=>new Response(null,{status,headers:{location}});
const dnsFail=()=>Object.assign(new TypeError('fetch failed'),{cause:{code:'ENOTFOUND'}});
const publicDns=async()=>[{address:'93.184.216.34'}];
const mxOk=async()=>[{exchange:'mx.example.net',priority:10}];
const crawl=(site,handler,opts={})=>{const calls=[];const fetchImpl=async url=>{calls.push(url);return handler(url)};
 // `calls` excludes robots.txt / sitemap housekeeping requests so assertions are about page fetches only
 return inspectPublicWebsite(site,{companyName:'Bowl Shop',kind:'gift_shop',listingScore:72,fetchImpl,lookup:publicDns,resolveMx:mxOk,resolve4:mxOk,retryDelayMs:1,pageDelayMs:0,...opts}).then(r=>Object.assign(r,{calls:calls.filter(u=>!/robots\.txt|sitemap/i.test(u)),allCalls:calls}));};

/* ---------- PART D.1: Pawty Yoga false positive ---------- */
test('Pawty Yoga: a third-person singing-bowl mention on a yoga studio is never Strong or Potential, even with commercial wording',()=>{
 const pages=[{url:'https://pawtyyoga.com/puppy-wellness-experiences-houston',text:'Some want to lie down in the dark with singing bowls. Book your puppy yoga session today, $35 per person. Add to cart. Shop our events.'}];
 const r=assessWebsite({companyName:'Pawty Yoga',kind:'yoga_studio',listingScore:30,pages});
 assert.notEqual(r.tier,'Strong match');assert.notEqual(r.tier,'Potential');
 assert.equal(r.tier,'Research');assert.equal(r.evidenceClass,'mention-only');
 const mention=assessWebsite({companyName:'Pawty Yoga',kind:'yoga_studio',listingScore:30,pages:[{url:'https://pawtyyoga.com/about',text:'Some guests prefer to relax with singing bowls while the puppies play.'}]});
 assert.equal(mention.tier,'Research');assert.equal(mention.evidenceClass,'mention-only');assert.match(mention.classificationReason,/no evidence of selling/i);
});
test('studio that describes (first person) running sound baths with the instruments is a Potential EQUIPMENT USER, clearly not a seller',()=>{
 const r=assessWebsite({companyName:'Echo Energetics Sound Bath Studio',kind:'spiritual_center',listingScore:40,pages:[{url:'https://echo.example/',text:'Our sound bath sessions use Tibetan singing bowls and crystal bowls to guide deep relaxation.'}]});
 assert.equal(r.tier,'Potential');assert.equal(r.evidenceClass,'equipment-user');assert.match(r.classificationReason,/NOT verified/);
 assert.match(r.evidenceExcerpt,/singing bowls/);assert.equal(r.evidenceUrl,'https://echo.example/');
 const y=assessWebsite({companyName:'Chandra Yoga',kind:'yoga_studio',listingScore:30,pages:[{url:'https://c.example/',text:'Weekly vinyasa classes for all levels. Private events available.'}]});
 assert.equal(y.tier,'Not relevant');
});
test('a bare mention, blog post or event page on a gift shop is only "Potential", never "Strong"',()=>{
 const blog=assessWebsite({companyName:'Maple Gifts',kind:'gift_shop',listingScore:60,pages:[{url:'https://x.com/blog/history',text:'Tibetan singing bowls are handmade in Nepal and have a long history in meditation.'}]});
 assert.equal(blog.tier,'Potential');assert.equal(blog.evidenceClass,'retailer-mention');
 const event=assessWebsite({companyName:'Serenity Gifts',kind:'gift_shop',listingScore:60,pages:[{url:'https://x.com/events',text:'Join our monthly sound bath with Tibetan singing bowls. $20 add to cart for tickets.'}]});
 assert.notEqual(event.tier,'Strong match'); // editorial/event URL with a ticket cart is not product evidence
 const phrase=assessWebsite({companyName:'Grace Gifts',kind:'gift_shop',listingScore:60,pages:[{url:'https://x.com/about',text:'In order to relax, our guide uses singing bowls during workshops.'}]});
 assert.notEqual(phrase.tier,'Strong match');
 // generic words ("order", "handmade", "products", "shop") on a NON-editorial page must not count as selling evidence
 const home=assessWebsite({companyName:'Grace Gifts',kind:'gift_shop',listingScore:60,pages:[{url:'https://x.com/',text:'Our handmade products include candles. In order to relax, our guide uses singing bowls in workshops at our shop.'}]});
 assert.equal(home.tier,'Potential');assert.equal(home.evidenceClass,'retailer-mention');
});

/* ---------- PART D.2: genuine retailer / wholesaler ---------- */
test('genuine singing-bowl retailer: price/cart on a product page is Strong, with excerpt, URL and reason stored',()=>{
 const r=assessWebsite({companyName:'Himalayan Art Shop',kind:'gift_shop',listingScore:72,pages:[{url:'https://artshop.example/collections/singing-bowls',text:'Handcrafted Tibetan singing bowls. 7 inch bowl $89 Add to cart, in stock.'}]});
 assert.equal(r.tier,'Strong match');assert.equal(r.evidenceClass,'confirmed-seller');assert.equal(r.evidenceRank,5);
 assert.equal(r.evidenceUrl,'https://artshop.example/collections/singing-bowls');assert.match(r.evidenceExcerpt,/Tibetan singing bowls/);assert.match(r.classificationReason,/offered for sale/);
 assert.equal('confidence' in r,false); // no invented percentages
});
test('structured Product data with an offer and wholesale wording are each recognised',()=>{
 const ld=`<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Tibetan Singing Bowl Set","offers":{"@type":"Offer","price":"120","priceCurrency":"USD"}}</script>`;
 const products=extractProducts(html(ld));assert.equal(products.length,1);assert.equal(products[0].hasOffer,true);
 const s=assessWebsite({companyName:'Nepal Imports',kind:'gift_shop',listingScore:72,pages:[{url:'https://n.example/',text:'welcome',products}]});
 assert.equal(s.tier,'Strong match');assert.match(s.evidenceExcerpt,/Tibetan Singing Bowl Set/);
 const w=assessWebsite({companyName:'Himalayan Wholesale Co',kind:'wholesaler',listingScore:90,pages:[{url:'https://w.example/wholesale',text:'Wholesale singing bowls and trade pricing for retailers.'}]});
 assert.equal(w.tier,'Strong match');assert.equal(w.evidenceClass,'wholesale-evidence');
});
test('negation ("bring their own") is not evidence, and unrelated sites are Not relevant',()=>{
 const n=assessWebsite({companyName:'Zen Gifts',kind:'gift_shop',listingScore:60,pages:[{url:'https://z.example/',text:'Practitioners bring their own singing bowls to sessions.'}]});
 assert.equal(n.tier,'Not relevant');
 assert.equal(assessWebsite({companyName:'Generic Gifts',kind:'gift_shop',listingScore:60,pages:[{url:'https://g.example/',text:'Greeting cards and balloons.'}]}).tier,'Not relevant');
});

/* ---------- PART D.3: redirects ---------- */
test('http -> https -> www redirect chain is followed and the pages are used (was silently discarded before)',async()=>{
 const r=await crawl('http://bowlshop.com',url=>{
  if(url==='http://bowlshop.com/')return redirect('https://bowlshop.com/');
  if(url==='https://bowlshop.com/')return redirect('https://www.bowlshop.com/');
  if(url.includes('/collections/'))return ok(html('<h1>Tibetan singing bowls</h1><p>$89 Add to cart</p>'));
  return ok(html('<a href="/collections/singing-bowls">Singing bowls</a> Email: hello@bowlshop.com'));
 });
 assert.equal(r.websiteVerified,true);assert.equal(r.finalUrl,'https://www.bowlshop.com/');assert.equal(r.buyerTier,'Strong match');assert.equal(r.email,'hello@bowlshop.com');
});
test('non-www host that fails DNS falls back to the www twin; https is tried before http',async()=>{
 const r=await crawl('http://bowlshop.com/',url=>{if(/^https?:\/\/bowlshop\.com/.test(url))throw dnsFail();return ok(html('hello'));});
 assert.equal(r.websiteVerified,true);assert.match(r.finalUrl,/^https:\/\/www\.bowlshop\.com/);
 assert.deepEqual(entryVariants(new URL('http://a.com/shop')).slice(0,2),['https://a.com/shop','http://a.com/shop']);
});
test('a redirect to a social/parking host is rejected without fetching that host',async()=>{
 const r=await crawl('https://moved.com',url=>url.startsWith('https://moved.com')?redirect('https://www.facebook.com/moved'):ok('x'));
 assert.equal(r.websiteVerified,false);assert.equal(r.failureReason,'redirect_offsite_unusable');assert.ok(!r.calls.some(u=>u.includes('facebook.com')));
});
test('redirect loops are detected',async()=>{
 const r=await crawl('https://loop.com',url=>redirect(url.endsWith('/a')?'https://loop.com/b':'https://loop.com/a'));
 assert.equal(r.failureReason,'too_many_redirects');
});

/* ---------- PART D.4: unreachable websites (classified, retried sensibly, never bypassed) ---------- */
test('failure categories: DNS, SSL, timeout (retried once), 403 (not retried, not bypassed), 404, 5xx, non-HTML, invalid, social',async()=>{
 assert.equal((await crawl('https://nope.example-x.com',()=>{throw dnsFail()})).failureReason,'dns_not_found');
 assert.equal((await crawl('https://bad.com',()=>{throw Object.assign(new TypeError('fetch failed'),{cause:{code:'CERT_HAS_EXPIRED',message:'certificate has expired'}})})).failureReason,'ssl_error');
 let n=0;const slow=await crawl('https://slow.com',()=>{if(n++===0)throw Object.assign(new Error('t'),{name:'TimeoutError'});return ok(html('ok'));});
 assert.equal(slow.websiteVerified,true); // the single retry succeeded
 const alwaysTimeout=await crawl('https://dead.com',()=>{throw Object.assign(new Error('t'),{name:'TimeoutError'})});assert.equal(alwaysTimeout.failureReason,'timeout');
 const blocked=await crawl('https://blocked.com',()=>new Response('Forbidden',{status:403}));
 assert.equal(blocked.failureReason,'blocked_by_site');assert.equal(blocked.calls.length,1,'403 must not be retried or worked around');
 assert.equal((await crawl('https://r.com',()=>new Response('',{status:429,headers:{'retry-after':'0'}}))).failureReason,'rate_limited');
 assert.equal((await crawl('https://gone.com/',()=>new Response('',{status:404}))).failureReason,'http_not_found');
 assert.equal((await crawl('https://err.com',()=>new Response('',{status:503}))).failureReason,'http_server_error');
 assert.equal((await crawl('https://pdf.com',()=>new Response('%PDF',{status:200,headers:{'content-type':'application/pdf'}}))).failureReason,'not_html');
 assert.equal((await crawl('http://%zz',()=>ok('x'))).failureReason,'invalid_url');
 assert.equal((await crawl('https://www.facebook.com/shop',()=>ok('x'))).failureReason,'social_profile');
 assert.equal(classifyFetchError(Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}})),'connection_error');
});
test('private / local addresses are still refused (SSRF guard retained)',async()=>{
 const r=await inspectPublicWebsite('https://intranet.example.com',{fetchImpl:async()=>ok('x'),lookup:async()=>[{address:'10.0.0.5'}],retryDelayMs:1});
 assert.equal(r.failureReason,'unsafe_host');
});
test('JavaScript-only shells are reported as unverified, not as "no product"',async()=>{
 const r=await crawl('https://spa.com',()=>ok('<html><body><div id="root"></div><script src=a.js></script><script src=b.js></script><script src=c.js></script></body></html>'));
 assert.equal(r.websiteVerified,true);assert.equal(r.rendering,'js_shell');assert.equal(r.evidenceClass,'unverified-site');assert.equal(r.buyerTier,'Unverified');
});
test('enrichment aggregates failures by reason for the progress bar and survives a throwing inspector',async()=>{
 const leads=[{website:'https://a.com',score:90,companyName:'A'},{website:'https://b.com',score:90,companyName:'B'},{website:'https://c.com',score:90,companyName:'C'}];
 const snaps=[];
 const out=await enrichBusinessLeads(leads,{concurrency:2,onProgress:s=>snaps.push(s),inspect:async site=>{
  if(site.includes('a.com'))return {websiteVerified:false,failureReason:'dns_not_found',buyerTier:'Unverified',email:''};
  if(site.includes('b.com'))throw Object.assign(new Error('boom'),{reason:'timeout'});
  return {websiteVerified:true,buyerTier:'Strong match',evidenceClass:'confirmed-seller',email:'sales@c.com'};}});
 const last=snaps.at(-1);
 assert.equal(out.length,3);assert.equal(last.websitesChecked,3);assert.equal(last.websitesSucceeded,1);assert.equal(last.websitesFailed,2);
 assert.deepEqual(last.failureReasons,{dns_not_found:1,timeout:1});assert.equal(last.strongMatches,1);assert.equal(last.outreachCandidates,1);assert.equal(last.emailsFound,1);
});

/* ---------- PART D.5: missing e-mails, duplicates, candidate selection ---------- */
const mkRow=(name,website,kind,extra={})=>normalizeCandidate({name,website,city:'Denver',state:'US-CO',kind,...extra},'Test data','Denver','Colorado');
const fixtureEnrich=map=>async rows=>rows.map(r=>({websiteVerified:true,evidenceRank:0,...r,...(map[r.companyName]||{})}));
test('a verified product match WITHOUT a public email is retained as a research lead; no email is ever invented',async()=>{
 const res=await discoverBuyers({city:'Denver',state:'Colorado',maxLeads:50},{
  geocode:async()=>({south:39,north:40,west:-106,east:-104}),geoapify:async()=>({records:[]}),overpass:async()=>({records:[]}),
  overture:async()=>({records:[mkRow('Singing Bowls Denver','https://bowls.test','gift_shop'),mkRow('Crystal Cave','https://cave.test','crystal_shop')]}),
  enrich:fixtureEnrich({'Singing Bowls Denver':{buyerTier:'Strong match',evidenceClass:'confirmed-seller',evidenceRank:5,email:''},'Crystal Cave':{buyerTier:'Strong match',evidenceClass:'confirmed-seller',evidenceRank:5,email:'hello@cave.test.com'}})});
 assert.equal(res.leads.length,1);assert.equal(res.leads[0].email,'hello@cave.test.com');
 assert.equal(res.research.length,1);assert.equal(res.research[0].companyName,'Singing Bowls Denver');assert.equal(res.research[0].email,'');
 assert.equal(res.stats.rejections.missingEmails,1);
});
test('unreachable SPECIALIST listings are kept as flagged research leads; unreachable generic gift shops are not',async()=>{
 const res=await discoverBuyers({city:'Denver',state:'Colorado'},{
  geocode:async()=>({south:39,north:40,west:-106,east:-104}),geoapify:async()=>({records:[]}),overpass:async()=>({records:[]}),
  overture:async()=>({records:[mkRow('Tibetan Treasures','https://tt.test','gift_shop'),mkRow('Generic Gifts','https://gg.test','gift_shop')]}),
  enrich:async rows=>rows.map(r=>({...r,websiteVerified:false,failureReason:'blocked_by_site',buyerTier:'Unverified',evidenceClass:'unverified-site',email:''}))});
 assert.equal(res.leads.length,0);assert.deepEqual(res.research.map(r=>r.companyName),['Tibetan Treasures']);
 assert.equal(res.research[0].websiteStatus,'unreachable');assert.equal(res.research[0].websiteFailureReason,'blocked_by_site');
 assert.deepEqual(res.stats.failureReasons,{blocked_by_site:2});
});
test('duplicates: www/non-www, http/https and redirect-to-same-final-domain collapse to one lead',async()=>{
 const res=await discoverBuyers({city:'Denver',state:'Colorado'},{
  geocode:async()=>({south:39,north:40,west:-106,east:-104}),geoapify:async()=>({records:[]}),overpass:async()=>({records:[]}),
  overture:async()=>({records:[mkRow('Himalayan Bowls','http://himalayanbowls.com','gift_shop'),mkRow('Himalayan Bowls LLC','https://www.himalayanbowls.com/contact','gift_shop'),mkRow('Himalayan Bowl Outlet','https://outlet-brand.com','gift_shop')]}),
  enrich:async rows=>rows.map(r=>({...r,websiteVerified:true,buyerTier:'Strong match',evidenceClass:'confirmed-seller',evidenceRank:5,email:'sales@himalayanbowls.com',finalUrl:'https://www.himalayanbowls.com/'}))});
 assert.equal(res.leads.length,1);
});
test('selection order: specialist listings are inspected before generic gift shops when the website cap is smaller than the pool',async()=>{
 process.env.MAX_WEBSITES_PER_SCAN='2';let inspected=[];
 try{await discoverBuyers({city:'Denver',state:'Colorado'},{
  geocode:async()=>({south:39,north:40,west:-106,east:-104}),geoapify:async()=>({records:[]}),overpass:async()=>({records:[]}),
  overture:async()=>({records:[mkRow('Aaa Gifts','https://a.test','gift_shop'),mkRow('Bbb Gifts','https://b.test','gift_shop'),mkRow('Zed Singing Bowls','https://z.test','gift_shop'),mkRow('Metaphysical Corner','https://m.test','gift_shop')]}),
  enrich:async rows=>{inspected=rows.map(r=>r.companyName);return rows.map(r=>({...r,websiteVerified:true,buyerTier:'Research',evidenceClass:'adjacent-retailer',email:''}))}});}
 finally{delete process.env.MAX_WEBSITES_PER_SCAN;}
 assert.deepEqual(inspected.sort(),['Metaphysical Corner','Zed Singing Bowls']);
});
test('progress snapshots carry real counters and never an invented percentage',async()=>{
 const snaps=[];
 await discoverBuyers({city:'Denver',state:'Colorado'},{
  geocode:async()=>({south:39,north:40,west:-106,east:-104}),geoapify:async()=>({records:[]}),overpass:async()=>({records:[]}),
  overture:async()=>({records:[mkRow('Singing Bowls Denver','https://bowls.test','gift_shop')]}),
  enrich:async(rows,o)=>{const r=rows.map(x=>({...x,websiteVerified:true,buyerTier:'Strong match',evidenceClass:'confirmed-seller',evidenceRank:5,email:'a@b-shop.com'}));o.onProgress({websitesChecked:1,websitesTotal:1,websitesSucceeded:1,websitesFailed:0,failureReasons:{},emailsFound:1,productMatches:1,strongMatches:1,outreachCandidates:1});return r;}},p=>snaps.push(p));
 const done=snaps.at(-1);
 assert.equal(done.stage,'complete');assert.equal(done.listingsFetched,1);assert.equal(done.categoryProspects,1);assert.equal(done.outreachCandidates,1);assert.equal(done.research,0);
 assert.ok(snaps.every(s=>!('percent' in s)&&!('percentage' in s)));
});

/* ---------- PART D.6: database saving (real SQLite, in memory) ---------- */
const memStore=()=>{const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id))');return {db,...createStore(db)};};
const lead=(name,domain,over={})=>makeLead({companyName:name,website:'https://'+domain,source:'t',city:'Denver',state:'CO',email:'info@'+domain,buyerTier:'Strong match',evidenceClass:'confirmed-seller',evidenceRank:5,websiteVerified:true,...over},'Singing Bowls');
test('database: leads are added, de-duplicated by domain, order is stable, and e-mail-less rows are not saved as buyers',()=>{
 const s=memStore();
 const a=s.upsertLeads([lead('A','a.com'),lead('A again','www.a.com'),lead('B','b.com'),lead('NoMail','c.com',{email:''})]);
 assert.deepEqual([a.added,a.updated,a.skippedNoEmail,a.total],[2,0,1,2]);
 const order1=s.readRecords('lead').map(x=>x.companyName);
 s.saveRecords('lead',s.readRecords('lead'));s.saveRecords('lead',s.readRecords('lead'));
 assert.deepEqual(s.readRecords('lead').map(x=>x.companyName),order1,'order must not flip on re-save');
 const again=s.upsertLeads([lead('A','a.com')]);assert.deepEqual([again.added,again.total],[0,2]);
 s.upsertLeads([lead('New','d.com')]);assert.equal(s.readRecords('lead')[0].companyName,'New','new leads appear first');
});
test('database: review flag survives a rescan unless the e-mail / tier materially changes',()=>{
 const s=memStore();s.upsertLeads([lead('A','a.com')]);
 const rows=s.readRecords('lead');rows[0].reviewed=true;s.saveRecords('lead',rows);
 s.upsertLeads([lead('A','a.com')]);assert.equal(s.readRecords('lead')[0].reviewed,true);
 s.upsertLeads([lead('A','a.com',{email:'other@a.com'})]);assert.equal(s.readRecords('lead')[0].reviewed,false);
 const weaker=s.upsertLeads([lead('A','a.com',{buyerTier:'Potential',evidenceClass:'retailer-mention',evidenceRank:3,email:'other@a.com'})]);assert.equal(weaker.updated,0,'a weaker rescan must not overwrite stronger evidence');
});
test('database: research leads are stored separately, de-duplicated, and removed once the domain becomes a buyer',()=>{
 const s=memStore();
 const r=s.upsertResearch([lead('R1','r1.com',{email:'',buyerTier:'Research'}),lead('R1 dup','www.r1.com',{email:'',buyerTier:'Research'}),lead('R2','r2.com',{email:'',buyerTier:'Research'})]);
 assert.deepEqual([r.added,r.total],[2,2]);assert.equal(s.readRecords('lead').length,0);
 s.upsertLeads([lead('R1 qualified','r1.com')]);
 const after=s.upsertResearch([]);assert.deepEqual(s.readRecords('research').map(x=>x.companyName),['R2']);assert.equal(after.total,1);
});
test('database: a failed write rolls back and leaves existing data intact',()=>{
 const s=memStore();s.upsertLeads([lead('A','a.com')]);
 assert.throws(()=>s.saveRecords('lead',[{id:'ok'},{id:42}]),/Invalid record id/);
 assert.deepEqual(s.readRecords('lead').map(x=>x.companyName),['A']);
});

/* ---------- PART D.7: Regression Tests for Prompt Fix Requirements (Fix 1-7) ---------- */
test('regression: unrelated businesses (restaurants, food trucks, dentists, security, schools) are classified as Not relevant',()=>{
 const cases = [
  { name: 'Himalayan Taj Restaurant', kind: 'indian_restaurant' },
  { name: 'Kathmandu Curry and Bar', kind: 'nepalese_restaurant' },
  { name: 'Himalayan Food Truck #3', kind: 'food_truck' },
  { name: 'Downtown Dental Care', kind: 'dentist' },
  { name: 'New Age Security Systems', kind: 'security_service' },
  { name: 'St. Jude Catholic School', kind: 'school' },
  { name: 'Lone Star Auto Repair', kind: 'auto_repair' },
  { name: 'Texas Leeches Distributor LLC', kind: 'b2b_food_products' }
 ];
 for(const c of cases){
  const r = assessWebsite({ companyName: c.name, kind: c.kind, listingScore: 90, pages: [{ url: 'https://example.com', text: 'Serving traditional Himalayan food and curry dishes daily.' }] });
  assert.equal(r.tier, 'Not relevant', `${c.name} should be Not relevant`);
 }
});

test('regression: generic yoga studios and unrelated music shops are not classified as High Relevance or Potential Buyer',()=>{
 const yoga = assessWebsite({ companyName: 'Pure Flow Yoga Studio', kind: 'yoga_studio', listingScore: 30, pages: [{ url: 'https://flow.example', text: 'Daily vinyasa classes, hot yoga and private meditation instruction.' }] });
 assert.equal(yoga.tier, 'Not relevant');

 const music = assessWebsite({ companyName: 'Houston Guitar & Piano Center', kind: 'musical_instrument_store', listingScore: 0, pages: [{ url: 'https://guitars.example', text: 'Acoustic and electric guitars, drum sets, and piano rentals.' }] });
 assert.equal(music.tier, 'Not relevant');
});

test('regression: actual singing-bowl seller is classified as High Relevance (Strong match)',()=>{
 const seller = assessWebsite({
  companyName: 'Himalayan Sound Healing Instruments',
  kind: 'gift_shop',
  listingScore: 90,
  pages: [{ url: 'https://himalayanhealing.example/shop/bowls', text: 'Handmade 7-metal Tibetan singing bowls. $145 USD. In stock now. Add to cart.' }]
 });
 assert.equal(seller.tier, 'Strong match');
 assert.equal(seller.evidenceClass, 'confirmed-seller');
 assert.match(seller.evidenceUrl, /\/shop\/bowls/);
 assert.match(seller.classificationReason, /Product explicitly offered for sale/i);
});

test('regression: plausible specialty retailer / handicraft shop qualifies as Potential Buyer without exact singing bowl product listing',()=>{
 const specialty = assessWebsite({
  companyName: 'Tibetan & Nepalese Handicrafts Emporium',
  kind: 'gift_shop',
  listingScore: 90,
  pages: [{ url: 'https://tibetanhandicrafts.example', text: 'We import authentic Himalayan artisan goods, prayer flags, incense, and Buddhist artifacts.' }]
 });
 assert.equal(specialty.tier, 'Potential');
 assert.equal(specialty.evidenceClass, 'specialty-retailer');
 assert.match(specialty.classificationReason, /Specialty retailer \/ handicraft shop with plausible commercial relationship/i);

 const metaphysical = assessWebsite({
  companyName: 'Sacred Stone Metaphysical & Crystals',
  kind: 'gift_shop',
  listingScore: 90,
  pages: [{ url: 'https://sacredstone.example/catalog', text: 'Browse our collection of healing crystals, sage, incense, and spiritual supplies.' }]
 });
 assert.equal(metaphysical.tier, 'Potential');
 assert.equal(metaphysical.evidenceClass, 'specialty-retailer');
});

test('regression: wrong-product matches (e.g. general brass fittings or food items) are excluded',()=>{
 const brassFitting = assessWebsite({
  companyName: 'Apex Industrial Plumbing Supply',
  kind: 'hardware_store',
  listingScore: 0,
  pages: [{ url: 'https://apexplumbing.example', text: 'Heavy duty brass valves, copper pipes, fittings and industrial equipment.' }]
 });
 assert.equal(brassFitting.tier, 'Not relevant');
});

test('regression: businesses without usable email remain in store as buyers with Missing Contact status, but excluded from export',()=>{
 const s = memStore();
 const buyerNoEmail = lead('Artisan Tibetan Crafts', 'tibetancrafts.example', { email: '' });
 s.upsertLeads([buyerNoEmail], { requireEmail: false });
 const saved = s.readRecords('lead');
 assert.equal(saved.length, 1);
 assert.equal(saved[0].companyName, 'Artisan Tibetan Crafts');
 assert.equal(saved[0].email, '');
});

