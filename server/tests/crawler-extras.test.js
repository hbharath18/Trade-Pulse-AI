import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPublicWebsite,parseRobots,robotsAllows,extractEmails} from '../email-enrichment.js';
import {isBlockedEmail} from '../lead-quality.js';

const html=b=>`<html><head><title>Home</title></head><body>${b}</body></html>`;
const ok=(b,type='text/html')=>new Response(b,{status:200,headers:{'content-type':type}});
const dnsOk=async()=>[{address:'93.184.216.34'}];
const mx=async()=>[{exchange:'mx.example.net',priority:10}];
const noDns=async()=>{throw Object.assign(new Error('x'),{code:'ENOTFOUND'})};
const crawl=(site,handler,opts={})=>{const calls=[];return inspectPublicWebsite(site,{companyName:'Bowl Shop',kind:'gift_shop',listingScore:72,fetchImpl:async u=>{calls.push(u);return handler(u)},lookup:dnsOk,resolveMx:mx,resolve4:mx,retryDelayMs:1,pageDelayMs:0,...opts}).then(r=>Object.assign(r,{calls}));};

test('robots.txt: Disallow is respected for pages (and nothing disallowed is fetched); allowed paths still crawled',async()=>{
 const r=await crawl('https://shop.example',u=>{
  if(u.endsWith('/robots.txt'))return ok('User-agent: *\nDisallow: /collections/\n','text/plain');
  if(u.includes('/collections/'))return ok(html('Tibetan singing bowls $89 Add to cart'));
  return ok(html('<a href="/collections/singing-bowls">Singing bowls</a><a href="/contact">Contact</a> sales@shop.example'));
 });
 assert.equal(r.websiteVerified,true);
 assert.ok(!r.calls.some(u=>u.includes('/collections/')),'disallowed URL must not be requested');
 assert.notEqual(r.buyerTier,'Strong match','no product evidence may come from a disallowed page');
});
test('robots.txt: a site that disallows everything is reported as robots_disallowed and not crawled',async()=>{
 const r=await crawl('https://closed.example',u=>u.endsWith('/robots.txt')?ok('User-agent: *\nDisallow: /','text/plain'):ok(html('should never be fetched')));
 assert.equal(r.failureReason,'robots_disallowed');assert.ok(!r.calls.some(u=>!u.endsWith('/robots.txt')));
});
test('robots.txt: our own user-agent group wins over *, wildcards / $ / Allow precedence work, Crawl-delay and Sitemap are parsed',()=>{
 const g=parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: TradePulseAI\nCrawl-delay: 3\nDisallow: /private/\nAllow: /private/ok\nSitemap: https://a.com/s.xml','tradepulseai/2.0');
 assert.equal(robotsAllows(g,'/shop'),true);assert.equal(robotsAllows(g,'/private/x'),false);assert.equal(robotsAllows(g,'/private/ok'),true);
 assert.equal(g.delay,3);assert.deepEqual(g.sitemaps,['https://a.com/s.xml']);
 assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /*.pdf$','x'),'/a.pdf'),false);
});
test('robots.txt: missing (404) means no restrictions; unavailable (503) is reported honestly and nothing is crawled',async()=>{
 const none=await crawl('https://a.example',u=>u.endsWith('/robots.txt')?new Response('',{status:404}):ok(html('hello')));
 assert.equal(none.websiteVerified,true);
 const down=await crawl('https://b.example',u=>u.endsWith('/robots.txt')?new Response('',{status:503}):ok(html('hello')));
 assert.equal(down.failureReason,'http_server_error');assert.ok(!down.calls.some(u=>!u.endsWith('/robots.txt')));
});
test('sitemap discovery finds a singing-bowl product page that the homepage does not link to',async()=>{
 const r=await crawl('https://hidden.example',u=>{
  if(u.endsWith('/robots.txt'))return ok('User-agent: *\nSitemap: https://hidden.example/sitemap_products_1.xml','text/plain');
  if(u.endsWith('/sitemap_products_1.xml'))return ok('<urlset><url><loc>https://hidden.example/products/tibetan-singing-bowl-7in</loc></url><url><loc>https://hidden.example/products/candle</loc></url></urlset>','application/xml');
  if(u.includes('/products/tibetan-singing-bowl'))return ok(html('<h1>Tibetan singing bowl 7 inch</h1>$89 Add to cart'));
  return ok(html('<p>Welcome to our store</p> contact@hidden.example'));
 });
 assert.equal(r.buyerTier,'Strong match');assert.match(r.evidenceUrl,/tibetan-singing-bowl-7in/);assert.equal(r.sitemapProductUrls,1);
});
test('product pages are followed from the homepage (not only the homepage is read) and JSON-LD products are used',async()=>{
 const ld='<script type="application/ld+json">{"@type":"Product","name":"Himalayan Singing Bowl","offers":{"price":"95","priceCurrency":"USD"}}</script>';
 const r=await crawl('https://ld.example',u=>/robots|sitemap/.test(u)?new Response('',{status:404}):u.includes('/shop')?ok(html('Browse'+ld)):ok(html('<a href="/shop">Shop</a>')));
 assert.equal(r.buyerTier,'Strong match');assert.match(r.evidenceExcerpt,/Himalayan Singing Bowl/);
});
test('e-mail: placeholder / technical / platform addresses are rejected; same-domain public addresses are preferred; source URL recorded',async()=>{
 for(const bad of ['you@domain.com','name@example.com','user@yoursite.com','error@sentry.io','abc123@sentry.wixpress.com','support@shopify.com','test@test.com','noreply@shop.com'])assert.equal(isBlockedEmail(bad),true,bad);
 assert.equal(isBlockedEmail('sales@himalayanbowls.com'),false);
 assert.deepEqual(extractEmails('a@gmail.com  info@shop.example  b@sentry.io','shop.example')[0],'info@shop.example');
 const r=await crawl('https://mail.example',u=>/robots|sitemap/.test(u)?new Response('',{status:404}):ok(html('<a href="mailto:Info@Mail.Example">Email us</a> you@domain.com')));
 assert.equal(r.email,'info@mail.example');assert.equal(r.emailSourceType,'website');assert.match(r.emailSourceUrl,/^https:\/\/mail\.example/);
 assert.match(r.emailVerification,/mailbox not verified/i);assert.equal(r.emailDomainCheck,'mx_found');
});
test('e-mail: an address whose domain cannot receive mail (no MX, no A) is dropped and counted; the next valid one is used',async()=>{
 const resolveMx=async d=>{if(d==='dm.example')throw Object.assign(new Error('x'),{code:'ENOTFOUND'});return [{exchange:'m',priority:1}]};
 const resolve4=async d=>{if(d==='dm.example')throw Object.assign(new Error('x'),{code:'ENOTFOUND'});return ['1.2.3.4']};
 const r=await crawl('https://dm.example',u=>/robots|sitemap/.test(u)?new Response('',{status:404}):ok(html('info@dm.example owner@gmail.com')),{resolveMx,resolve4});
 assert.equal(r.email,'owner@gmail.com');assert.equal(r.rejectedEmailCount,1);
});
test('e-mail: listing (Overture) e-mail is flagged as listing-sourced; none is ever invented when nothing is found',async()=>{
 const withSeed=await crawl('https://seed.example',u=>/robots|sitemap/.test(u)?new Response('',{status:404}):ok(html('no address here')),{seedEmail:'owner@seed.example'});
 assert.equal(withSeed.email,'owner@seed.example');assert.equal(withSeed.emailSourceType,'listing');
 const none=await crawl('https://none.example',u=>/robots|sitemap/.test(u)?new Response('',{status:404}):ok(html('no address here')));
 assert.equal(none.email,'');assert.equal(none.emailSourceType,'');
});
test('e-mail: with the site unreachable the listing e-mail is still domain-checked',async()=>{
 const r=await crawl('https://down.example',()=>{throw Object.assign(new TypeError('fetch failed'),{cause:{code:'ENOTFOUND'}})},{seedEmail:'x@down.example',resolveMx:noDns,resolve4:noDns});
 assert.equal(r.websiteVerified,false);assert.equal(r.email,'');assert.equal(r.rejectedEmailCount,1);
});
