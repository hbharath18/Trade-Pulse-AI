import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCandidate,scoreBuyer,discoverBuyers,locationMatches} from '../discovery.js';
import {extractEmails} from '../email-enrichment.js';
import {assessWebsite,isBlockedEmail} from '../lead-quality.js';

test('technical, Sentry, temporary and placeholder emails are removed',()=>{
 assert.equal(isBlockedEmail('support@mycompany.com'),false);
 for(const bad of ['abc@o555.ingest.sentry.io','dev@ingest.sentry.io','jane@example.com','foo@sample.test','email@domain.invalid'])assert.equal(isBlockedEmail(bad),true,bad);
 assert.deepEqual(extractEmails('Contact <a href="mailto:info@shop-example.com">info@shop-example.com</a>; support@o123.ingest.sentry.io, logo@foo.png','shop-example.com'),['info@shop-example.com']);
});
test('product-specific screening excludes unrelated churches and instrument specialists',()=>{
 for(const name of ['Christ of POWER Church','Southpaw Guitars','Kawai Piano Gallery','Gabbanelli Accordions','Trinity Ministries'])assert.equal(scoreBuyer({companyName:name,kind:'musical_instrument_store'}),0,name);
 assert.equal(scoreBuyer({companyName:'A Crystal Shop',kind:'crystal_shop'}),90);
 assert.equal(scoreBuyer({companyName:'Metaphysical Supplies',kind:'metaphysical_store'}),90);
 assert.equal(scoreBuyer({companyName:'Singing Bowls Houston',kind:'gift_shop'}),100);
 assert.equal(scoreBuyer({companyName:'Home Accessories Shop',kind:'home_decor_store'},'Home Decor'),70);
 assert.equal(scoreBuyer({companyName:'Artisan Gift Shop',kind:'gift_shop'},'Indian Handicrafts'),70);
});
test('website product evidence is stronger than only a listing category',()=>{
 const strong=assessWebsite({product:'Singing Bowls',listingScore:60,companyName:'Gift store',siteText:'Shop our Tibetan singing bowls and sound healing instruments',siteUrl:'https://abc.com'});
 assert.equal(strong.tier,'Strong match');
 const weak=assessWebsite({product:'Singing Bowls',listingScore:60,companyName:'Generic gift store',siteText:'We sell birthday greeting cards and party balloons.',siteUrl:'https://abc.com'});
 assert.equal(weak.tier,'Not relevant');
 const candidate=assessWebsite({product:'Singing Bowls',listingScore:80,companyName:'Crystal shop',siteText:'Come join our sound bath and vibrational healing events.',siteUrl:'https://abc.com'});
 assert.equal(candidate.tier,'Potential');
});
test('normalization, state codes and source email filtering',()=>{
 const row=normalizeCandidate({name:'Crystal World',website:'shop.example.org',emails:['system@o123.ingest.sentry.io'],city:'Houston',state:'US-TX',kind:'crystal_shop'},'Test','Houston','Texas');
 assert.equal(row.email,'');assert.equal(row.website,'https://shop.example.org/');assert.equal(locationMatches(row,'Houston','Texas'),true);
 assert.equal(locationMatches({...row,city:'Rosenberg'},'Houston','Texas'),false);
});
test('discovery only returns email-bearing website-corroborated product prospects and dedupes by domain',async()=>{
 const mk=(name,website,kind)=>normalizeCandidate({name,website,city:'Denver',state:'US-CO',kind},'Test data','Denver','Colorado');
 const result=await discoverBuyers({city:'Denver',state:'Colorado',category:'Singing Bowls',maxLeads:800},{
  geocode:async()=>({south:39,north:40,west:-106,east:-104}),
  overture:async()=>({records:[mk('Sound Bowl Store','https://bowls.demo-business.org','gift_shop'),mk('Duplicate','https://bowls.demo-business.org/contacts','gift_shop'),mk('Guitar Gallery','https://guitars.demo-business.org','musical_instrument_store'),mk('Wellness Store','https://wellness.demo-business.org','crystal_shop')]}),
  geoapify:async()=>({records:[]}),overpass:async()=>({records:[]}),
  enrich:async(rows)=>rows.map(r=>({...r,websiteVerified:true,email:'hello@'+new URL(r.website).hostname,emailStatus:'Risky',buyerTier:r.companyName==='Sound Bowl Store'?'Strong match':'Unverified',b2bConfidence:r.companyName==='Sound Bowl Store'?92:0,buyerEvidence:'Site explicitly lists singing bowls',emailSourceUrl:r.website}))
 });
 assert.equal(result.stats.relevantWithWebsite,2);assert.equal(result.stats.outreachReady,1);assert.equal(result.leads[0].companyName,'Sound Bowl Store');
 assert.equal(result.leads[0].buyerTier,'Strong match');assert.equal(result.leads[0].reviewed,false);
});

test('regression: yoga studios (incl. Pawty Yoga) are low-priority, below the retail threshold; puppy-yoga and instrument shops are excluded',()=>{
 assert.equal(scoreBuyer({companyName:'Puppy Yoga Houston',kind:'yoga_studio'},'Singing Bowls'),0);
 assert.equal(scoreBuyer({companyName:'Music Centre',kind:'musical_instrument_store'},'Singing Bowls'),0);
 for(const entry of [{companyName:'Pawty Yoga',kind:'yoga_studio'},{companyName:'Chandra Yoga',kind:'yoga_studio'},{companyName:'Valor - Yoga, Leadership, and Vitality',kind:'yoga_studio'},{companyName:'True North Yoga',kind:'yoga_studio'}]){
  const score=scoreBuyer(entry,'Singing Bowls');assert.ok(score>0&&score<60,entry.companyName+' scored '+score);
 }
 assert.equal(scoreBuyer({companyName:'Echo Energetics - Sound Bath Studio',kind:'spiritual_center'},'Singing Bowls'),40);
 assert.equal(scoreBuyer({companyName:'Peak Fitness Gym',kind:'gym'},'Singing Bowls'),0);
});

test('regression: passing singing-bowl mention or visiting practitioner never earns strong match',()=>{
 const pawty=assessWebsite({product:'Singing Bowls',companyName:'Pawty Yoga',kind:'yoga_studio',listingScore:60,pages:[
  {url:'https://pawtyyoga.com/puppy-wellness-experiences-houston',text:'Some want to lie down in the dark with singing bowls. The sound bath practitioner brings their own bowls. Our puppy yoga sessions focus on puppies.'}
 ]});
 assert.notEqual(pawty.tier,'Strong match');
 assert.match(pawty.evidence,/product mentioned|no first-party|No first-party|No evidence/i);
 const seller=assessWebsite({product:'Singing Bowls',companyName:'Himalayan Art Shop',kind:'gift_shop',listingScore:72,pages:[
  {url:'https://artshop.example/collections/singing-bowls',text:'Handcrafted Tibetan singing bowls. Add to cart, in stock. We ship orders throughout the US.'}
 ]});
 assert.equal(seller.tier,'Strong match');
 assert.equal(seller.evidenceUrl,'https://artshop.example/collections/singing-bowls');
 assert.match(seller.evidenceExcerpt,/Tibetan singing bowls/);
 const shopMention=assessWebsite({product:'Singing Bowls',companyName:'Crystal Shop',kind:'crystal_shop',listingScore:90,pages:[
  {url:'https://crystal.example/blog',text:'Our guide mentions Tibetan singing bowls in history and meditation. We primarily sell crystals.'}
 ]});
 assert.notEqual(shopMention.tier,'Strong match');
});

test('research leads are retained without email but never treated as outreach candidates',async()=>{
 const create=(name,kind,url)=>normalizeCandidate({name,kind,website:url,city:'Houston',state:'US-TX'},'Test dataset','Houston','Texas');
 const stages=[];
 const r=await discoverBuyers({city:'Houston',state:'Texas',maxLeads:500}, {
  geocode:async()=>({south:29,north:30,west:-96,east:-95}),
  overture:async()=>({records:[create('Crystal Boutique','crystal_shop','https://crystal-store.test'),create('Himalayan Bowl Supplies','gift_shop','https://bowl-store.test'),create('Pawty Yoga','yoga_studio','https://yoga.test')]}),
  geoapify:async()=>({records:[]}),overpass:async()=>({records:[]}),
  enrich:async(rows,options)=>{const enriched=rows.map(row=>({...row,websiteVerified:true, buyerTier:row.companyName==='Himalayan Bowl Supplies'?'Strong match':'Research', buyerEvidence:'Synthetic fixture',b2bConfidence:row.companyName==='Himalayan Bowl Supplies'?92:25,email:row.companyName==='Himalayan Bowl Supplies'?'info@bowl-supplies.org':''})); options.onProgress({websitesChecked:rows.length,websitesTotal:rows.length});return enriched;}
 },patch=>stages.push(patch));
 assert.equal(r.leads.length,1);
 // the crystal shop AND the studio (low-priority tier) are retained as research, never as outreach candidates
 assert.deepEqual(r.research.map(x=>x.companyName).sort(),['Crystal Boutique','Pawty Yoga']);
 assert.ok(r.research.every(x=>x.email===''));
 assert.equal(r.stats.rejections.missingEmails,0);
 assert.ok(stages.some(s=>s.stage==='inspecting'&&s.websitesChecked===3));
 assert.equal(stages.at(-1).stage,'complete');
});
