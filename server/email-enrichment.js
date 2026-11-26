import dns from 'node:dns/promises';
import net from 'node:net';
import {assessWebsite,isBlockedEmail} from './lead-quality.js';

const MAIL_RX=/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;
const SOCIAL_HOST=/(?:^|\.)(?:facebook\.com|instagram\.com|tiktok\.com|linkedin\.com|youtube\.com|x\.com|twitter\.com|maps\.google\.com|yelp\.com)$/i;
const PARKING_HOST=/(?:^|\.)(?:godaddy\.com|sedoparking\.com|hugedomains\.com|afternic\.com|dan\.com|squadhelp\.com)$/i;
const SUSPICIOUS_HOST=/(?:^|\.)(?:tk|ml|ga|cf|gq|work|click|top|loan|men|stream|trade|win|bid|party|cricket|download|review|country|link)$/i;
const RETRYABLE=new Set(['timeout','connection_error','dns_error','http_server_error','rate_limited']);
const CONNECTIVITY=new Set(['dns_not_found','dns_error','ssl_error','timeout','connection_error']);
/** Every website failure is classified into exactly one of these codes (shown in the scan summary). */
export const FAILURE_REASONS=['dns_not_found','dns_error','ssl_error','timeout','connection_error','blocked_by_site','rate_limited','http_not_found','http_client_error','http_server_error','too_many_redirects','redirect_offsite_unusable','not_html','too_large','unsafe_host','invalid_url','social_profile','robots_disallowed','unknown'];
const fail=(reason,detail)=>Object.assign(new Error(detail||reason),{reason});
export function classifyFetchError(e){
 if(e?.reason)return e.reason;
 const code=String(e?.code||e?.cause?.code||''),text=code+' '+String(e?.message||'')+' '+String(e?.cause?.message||'');
 if(code==='ENOTFOUND'||code==='ENODATA')return 'dns_not_found';
 if(code==='EAI_AGAIN')return 'dns_error';
 if(/CERT|SSL|TLS|self[- ]signed|certificate|EPROTO|HOSTNAME_MISMATCH/i.test(text))return 'ssl_error';
 if(e?.name==='TimeoutError'||e?.name==='AbortError'||/timeout|timed out|ETIMEDOUT/i.test(text))return 'timeout';
 if(/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE|UND_ERR_SOCKET|fetch failed/i.test(text))return 'connection_error';
 return 'unknown';
}
function privateAddress(ip) {
 const raw=String(ip||'').trim().toLowerCase();
 if(raw.startsWith('::ffff:')){
  const mapped=raw.slice(7);
  if(net.isIP(mapped)===4)return privateAddress(mapped);
  return true;
 }
 if(net.isIP(raw)===4) {const [a,b]=raw.split('.').map(Number);return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===192&&b===0)||(a===198&&b===18);}
 return raw==='::'||raw==='::1'||raw.startsWith('fc')||raw.startsWith('fd')||raw.startsWith('fe80');
}
async function publicUrl(raw,ctx) {
 const u=new URL(raw);
 if(ctx.allowPrivate)return u; // test-only escape hatch; never enabled by the application
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password||(u.port&&!['80','443'].includes(u.port)))throw fail('unsafe_host','Unsafe URL');
 if(u.hostname==='localhost'||/\.(?:local|internal|localhost|test|invalid)$/i.test(u.hostname))throw fail('unsafe_host','Local host denied');
 const ips=await ctx.lookup(u.hostname,{all:true});
 if(!ips.length||ips.some(x=>privateAddress(x.address)))throw fail('unsafe_host','Non-public host denied');
 return u;
}
function cleanHtml(html) {
 return String(html).replace(/<(?:script|style|svg|noscript|template)\b[^>]*>[\s\S]*?<\/\s*(?:script|style|svg|noscript|template)>/gi,' ')
  .replace(/<!--([\s\S]*?)-->/g,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').slice(0,350000);
}
const metaContent=(html,key)=>{const h=String(html);const a=h.match(new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`,'i'))||h.match(new RegExp(`<meta\\s+[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,'i'));return a?.[1]||''};
function siteName(html) {
 const title=String(html).match(/<title\b[^>]*>([\s\S]{1,170}?)<\/title>/i);
 return (metaContent(html,'og:site_name')||title?.[1]||'').replace(/&amp;/g,'&').split(/[|–—]/)[0].trim().slice(0,100);
}
/** Product data that many shop themes only expose as JSON-LD (stripped by cleanHtml). */
export function extractProducts(html){
 const out=[];
 for(const m of String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  let data;try{data=JSON.parse(m[1].trim())}catch{continue}
  const walk=(node,depth)=>{
   if(!node||depth>5||out.length>=60)return;
   if(Array.isArray(node))return node.forEach(x=>walk(x,depth+1));
   if(typeof node!=='object')return;
   const types=[].concat(node['@type']||[]).map(String);
   if(types.includes('Product')&&node.name){const offer=[].concat(node.offers||[])[0]||{};out.push({name:String(node.name).slice(0,200),hasOffer:Boolean(node.offers),price:offer.price?`${offer.price}${offer.priceCurrency?' '+offer.priceCurrency:''}`:''});}
   for(const key of ['@graph','itemListElement','item','mainEntity','hasPart'])if(node[key])walk(node[key],depth+1);
  };
  walk(data,0);
 }
 return out;
}
export function extractEmails(text,domain='') {
 const decoded=String(text).replace(/&#(?:x([\da-f]+)|(\d+));/gi,(_,h,d)=>{try{return String.fromCodePoint(parseInt(h||d,h?16:10))}catch{return ''}})
 .replace(/&commat;/gi,'@').replace(/\s*(?:\[at\]|\(at\))\s*/gi,'@').replace(/\s*(?:\[dot\]|\(dot\))\s*/gi,'.');
 return [...new Set((decoded.match(MAIL_RX)||[]).map(e=>e.toLowerCase().replace(/[.,;:)>]+$/g,'')))]
 .filter(e=>!isBlockedEmail(e)).sort((a,b)=>{
  const rank=e=>{const [local,host]=e.split('@');return Number(host===domain||host.endsWith('.'+domain))*20+Number(/^(?:sales|wholesale|info|contact|hello|orders|support|shop)\b/.test(local))*4-Number(/no.?reply|webmaster|privacy|abuse/.test(local))*10};
  return rank(b)-rank(a);
 });
}
const MAIL_CACHE=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function makeCtx(o={}){
 const num=(v,d)=>Number.isFinite(Number(v))&&Number(v)>=0?Number(v):d;
 return {fetch:o.fetchImpl||fetch,lookup:o.lookup||dns.lookup,allowPrivate:Boolean(o.allowPrivate),
  timeoutMs:num(o.timeoutMs??process.env.WEBSITE_TIMEOUT_MS,6500),retries:Math.min(2,num(o.retries??process.env.WEBSITE_RETRIES,0)),retryDelayMs:num(o.retryDelayMs,400),
  siteBudgetMs:num(o.siteBudgetMs??process.env.WEBSITE_SITE_BUDGET_MS,15000),pageDelayMs:num(o.pageDelayMs,80),maxRedirects:6,deadline:0,robots:new Map(),resolveMx:o.resolveMx||dns.resolveMx,resolve4:o.resolve4||dns.resolve4,mailCache:(o.resolveMx||o.resolve4)?new Map():MAIL_CACHE,checkMail:o.checkMail??(process.env.EMAIL_DOMAIN_CHECK!=='false'),
  userAgent:process.env.CRAWLER_USER_AGENT||'TradePulseAI/2.0 (public business research)'};
}
/** One HTTP request. Only a polite, honest User-Agent is used; 401/403/429 and CAPTCHA-style blocks are reported, never bypassed. */
async function requestOnce(target,ctx,kind='html'){
 if(ctx.deadline&&Date.now()>ctx.deadline)throw fail('timeout','Per-site time budget exceeded');
 await publicUrl(target,ctx);
 const res=await ctx.fetch(target,{redirect:'manual',signal:AbortSignal.timeout(ctx.timeoutMs),headers:{'user-agent':ctx.userAgent,'accept':kind==='html'?'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1':'text/plain,application/xml,text/xml;q=0.9,*/*;q=0.1','accept-language':'en-US,en;q=0.8'}});
 if([301,302,303,307,308].includes(res.status)){const loc=res.headers.get('location');if(!loc)throw fail('too_many_redirects','Redirect without location');return {redirect:new URL(loc,target).href};}
 if(res.status===429){const e=fail('rate_limited','HTTP 429 (rate limited)');e.retryAfterMs=Math.min(5000,(Number(res.headers.get('retry-after'))||0)*1000);throw e;}
 if(res.status===401||res.status===403)throw fail('blocked_by_site',`HTTP ${res.status}: site refuses automated access (not bypassed)`);
 if(res.status===404||res.status===410)throw fail('http_not_found',`HTTP ${res.status}`);
 if(res.status>=500)throw fail('http_server_error',`HTTP ${res.status}`);
 if(!res.ok)throw fail('http_client_error',`HTTP ${res.status}`);
 const type=(res.headers.get('content-type')||'').toLowerCase();
 if(kind==='html'&&type&&!/text\/html|application\/xhtml/.test(type))throw fail('not_html',`Content-Type ${type.split(';')[0]}`);
 if(kind==='xml'&&type&&!/xml|text\/plain/.test(type))throw fail('not_html',`Content-Type ${type.split(';')[0]}`);
 if(Number(res.headers.get('content-length')||0)>900000)throw fail('too_large','Webpage too large');
 return {html:(await res.text()).slice(0,750000),url:target,contentType:type};
}
async function withRetry(fn,ctx){
 for(let attempt=0;;attempt++){
  try{return await fn();}
  catch(e){const reason=classifyFetchError(e);e.reason=reason;
   if(!RETRYABLE.has(reason)||attempt>=ctx.retries)throw e;
   await sleep(Math.max(e.retryAfterMs||0,ctx.retryDelayMs*(attempt+1)));}
 }
}
/* ---------- robots.txt (RFC 9309 subset): we obey Disallow/Allow/Crawl-delay for our user-agent token or '*' ---------- */
export function parseRobots(text,token='tradepulseai'){
 const groups=[],sitemaps=[];let cur=null;
 for(const raw of String(text).split(/\r?\n/)){
  const line=raw.replace(/#.*/,'').trim();if(!line)continue;
  const m=line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);if(!m)continue;
  const k=m[1].toLowerCase(),v=m[2].trim();
  if(k==='user-agent'){if(!cur||cur.rules.length||cur.delay!==null){cur={agents:[],rules:[],delay:null};groups.push(cur);}cur.agents.push(v.toLowerCase());}
  else if(k==='allow'||k==='disallow'){if(cur)cur.rules.push({allow:k==='allow',path:v});}
  else if(k==='crawl-delay'){if(cur)cur.delay=Number(v)||0;}
  else if(k==='sitemap'&&/^https?:\/\//i.test(v))sitemaps.push(v);
 }
 const group=groups.find(g=>g.agents.some(a=>a!=='*'&&token.includes(a)))||groups.find(g=>g.agents.includes('*'))||{rules:[],delay:null};
 return {rules:group.rules.filter(r=>r.path),delay:group.delay,sitemaps,disallowAll:false};
}
const robotsRegex=pattern=>new RegExp('^'+pattern.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\\\$$/,'$'));
export function robotsAllows(info,pathAndQuery){
 if(info.disallowAll)return false;
 let best=null;
 for(const r of info.rules){if(!robotsRegex(r.path).test(pathAndQuery))continue;if(!best||r.path.length>best.path.length||(r.path.length===best.path.length&&r.allow))best=r;}
 return !best||best.allow;
}
async function robotsFor(origin,ctx){
 if(ctx.robots.has(origin))return ctx.robots.get(origin);
 let info={rules:[],delay:null,sitemaps:[],disallowAll:false};
 try{
  const res=await fetchPage(origin+'/robots.txt',ctx,{skipRobots:true,kind:'text',timeoutMs:Math.min(ctx.timeoutMs,4500),retries:0});
  if(!/html/.test(res.contentType||'')&&!/^\s*</.test(res.html))info=parseRobots(res.html,ctx.userAgent.toLowerCase());
 }catch(e){
  const reason=classifyFetchError(e);
  // RFC 9309: an unavailable robots.txt (429 / 5xx / unreachable) means we must NOT assume access is allowed; report the true reason instead.
  if(reason==='rate_limited'||reason==='http_server_error'||CONNECTIVITY.has(reason)||reason==='unsafe_host')throw e;
  // 404 / 401 / 403 / other 4xx / non-text: no usable robots.txt => no restrictions declared
 }
 ctx.robots.set(origin,info);return info;
}
async function assertRobots(target,ctx){
 const u=new URL(target);if(u.pathname==='/robots.txt')return;
 const info=await robotsFor(u.origin,ctx);
 if(!robotsAllows(info,u.pathname+u.search))throw fail('robots_disallowed',`robots.txt disallows ${u.pathname} for this crawler (respected)`);
}
async function fetchPage(url,ctx,opts={}){
 let target=url;const seen=new Set(),kind=opts.kind||'html';
 const local={
  ...ctx,
  timeoutMs:opts.timeoutMs??ctx.timeoutMs,
  retries:opts.retries??ctx.retries
 };
 for(let hop=0;hop<=ctx.maxRedirects;hop++){
  if(seen.has(target))throw fail('too_many_redirects','Redirect loop');seen.add(target);
  if(!opts.skipRobots)await assertRobots(target,ctx);
  const out=await withRetry(()=>requestOnce(target,local,kind),local);
  if(out.redirect){
   const host=new URL(out.redirect).hostname;
   if(SOCIAL_HOST.test(host)||PARKING_HOST.test(host))throw fail('redirect_offsite_unusable',`Redirected to ${host}, which is not a usable business website`);
   target=out.redirect;continue;
  }
  return out;
 }
 throw fail('too_many_redirects','Too many redirects');
}
const baseHost=h=>String(h||'').toLowerCase().replace(/^www\./,'');
/** https first, then http fallback (for sites without TLS), then the www/non-www twin, then site root. */
export function entryVariants(u){
 const out=[],add=x=>{if(!out.includes(x))out.push(x)};
 const hosts=[u.hostname,u.hostname.startsWith('www.')?u.hostname.slice(4):'www.'+u.hostname];
 const path=u.pathname+u.search;
 for(const h of hosts){add(`https://${h}${path}`);add(`http://${h}${path}`);}
 if(u.pathname!=='/')for(const h of hosts)add(`https://${h}/`);
 return out;
}
async function resolveEntry(u,ctx){
 const errors=[];
 // Do not burn retries across 4+ entry variants; reserve retries for confirmed pages.
 const probeCtx={...ctx,retries:0,timeoutMs:Math.min(ctx.timeoutMs,8000)};
 for(const candidate of entryVariants(u)){
  try{return await fetchPage(candidate,probeCtx);}
  catch(e){errors.push(e);const reason=classifyFetchError(e);
   if(CONNECTIVITY.has(reason))continue;                                             // try the next variant (https / www / http)
   if(reason==='http_not_found')continue;                                            // wrong vhost / deep link gone: try the remaining variants
   break;}                                                                           // 403 / 5xx / robots / unsafe host: stop, do not hammer the site
 }
 // report the most informative failure (a 404 from a fallback variant says less than a DNS/SSL/403 on the primary one)
 throw errors.find(e=>classifyFetchError(e)!=='http_not_found')||errors[0]||fail('unknown','No attempt made');
}
const canon=href=>{const u=new URL(href);u.hash='';for(const k of [...u.searchParams.keys()])if(/^(?:utm_|fbclid|gclid)/i.test(k))u.searchParams.delete(k);if(u.pathname.length>1)u.pathname=u.pathname.replace(/\/+$/,'');return u.href;};
function parsePage(html,url){
 const body=cleanHtml(html);
 const meta=[siteName(html),metaContent(html,'description'),metaContent(html,'og:title'),metaContent(html,'og:description')].filter(Boolean).join(' . ');
 const products=extractProducts(html);
 const jsShell=body.length<250&&/<script\b/i.test(html)&&(/id=["'](?:root|__next|app|___gatsby)["']/i.test(html)||(html.match(/<script\b/gi)||[]).length>=3);
 return {url,text:(meta+' . '+body).slice(0,350000),products,jsShell};
}
function discoverLinks(html,url,sameSite){
 const links=[];
 for(const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)){
  const label=(match[1]+' '+cleanHtml(match[2])).toLowerCase();
  if(!/\b(?:singing[\s\-_]*bowl|bowls?|tibetan|himalayan|nepal|sound[\s\-_]*healing|crystal|metaphysical|shop|store|product|catalog|collection|wholesale|trade|stockist|gift|spiritual|meditation|contact|about)\b/i.test(label))continue;
  try{const next=new URL(match[1],url);if(!['http:','https:'].includes(next.protocol)||!sameSite(next.href)||/\.(?:pdf|png|jpe?g|webp|svg|gif|zip)(?:$|\?)/i.test(next.pathname))continue;
   const priority=/singing|bowl|tibetan|himalayan|nepal|sound[\s\-_]*healing/i.test(label)?0:/product|collection|shop|store|catalog/i.test(label)?2:/wholesale|trade|stockist/i.test(label)?3:/contact/i.test(label)?1.5:4;
   links.push({url:canon(next.href),priority});
  }catch{}
 }
 return links;
}
/** DNS-level check only: can this domain receive mail at all? It does NOT verify that the mailbox exists. */
export async function mailDomainCheck(domain,ctx){
 const hit=ctx.mailCache.get(domain);if(hit&&Date.now()-hit.t<6*3600e3)return hit.v;
 const guard=p=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(Object.assign(new Error('timeout'),{code:'ETIMEOUT'})),4000))]);
 const missing=e=>['ENODATA','ENOTFOUND','ENOENT'].includes(e?.code);
 let v='no_mail_dns';
 try{const mx=await guard(ctx.resolveMx(domain));if(mx?.length)v='mx_found';}catch(e){if(!missing(e))v='unknown';}
 if(v==='no_mail_dns'){try{const a=await guard(ctx.resolve4(domain));if(a?.length)v='a_record_only';}catch(e){if(!missing(e))v='unknown';}}
 ctx.mailCache.set(domain,{v,t:Date.now()});return v;
}
const BOWLY=/(?:singing|tibetan|himalayan|nepal|sound[-_ ]?(?:bowl|healing)|meditation[-_ ]?bowl|chakra[-_ ]?bowl|bowls?)/i;
/** Product-page discovery from sitemaps (robots.txt Sitemap lines, else /sitemap.xml). At most 3 sitemap files are fetched. */
async function sitemapBowlUrls(origin,ctx,sameSite){
 const info=await robotsFor(origin,ctx).catch(()=>({sitemaps:[]}));
 const roots=[...new Set([...(info.sitemaps||[]),origin+'/sitemap.xml'])].filter(u=>sameSite(u)).slice(0,2);
 let fetched=0;const urls=[];
 const grab=async url=>{if(fetched>=3||/\.gz(?:\?|$)/i.test(url))return '';fetched++;try{return (await fetchPage(url,ctx,{kind:'xml',skipRobots:true})).html.slice(0,300000);}catch{return '';}};
 const locs=xml=>[...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m=>m[1].replace(/&amp;/g,'&'));
 for(const root of roots){
  const xml=await grab(root);if(!xml)continue;
  if(/<sitemapindex/i.test(xml)){
   const rank=u=>/product|collection|shop|store/i.test(u)?2:/page/i.test(u)?1:0;
   for(const kid of locs(xml).filter(sameSite).sort((a,b)=>rank(b)-rank(a)).slice(0,2))urls.push(...locs(await grab(kid)));
  }else urls.push(...locs(xml));
 }
 return [...new Set(urls)].filter(u=>{try{return sameSite(u)&&BOWLY.test(new URL(u).pathname)}catch{return false}}).slice(0,4);
}
const failedResult=(reason,detail)=>({email:'',emailSourceUrl:'',emailStatus:'Pending',buyerTier:'Unverified',buyerEvidence:`Website could not be checked (${reason})`,classificationReason:`Website could not be checked (${reason}); no product evidence either way`,evidenceClass:'unverified-site',evidenceRank:0,evidenceExcerpt:'',evidenceUrl:'',productSignal:'none',websiteName:'',websiteVerified:false,pagesChecked:0,siteError:detail||reason,failureReason:reason,finalUrl:'',rendering:'unknown',emailSourceType:'',emailDomainCheck:'unchecked',emailVerification:'',rejectedEmailCount:0,sitemapProductUrls:0});
/** Inspect a few first-party pages only. No fabricated emails or purchasing claims. */
export async function inspectPublicWebsite(website,{product='Singing Bowls',listingScore=0,companyName='',kind='',seedEmail='',minAdjacentScore,maxPages,...netOptions}={}) {
 let u;try{u=new URL(/^https?:\/\//i.test(website)?website:'https://'+website);}catch{return failedResult('invalid_url','Invalid website URL');}
 if(SOCIAL_HOST.test(u.hostname))return failedResult('social_profile','Social/directory profile is not a first-party business website');
 if(PARKING_HOST.test(u.hostname))return failedResult('redirect_offsite_unusable','Domain parking host is not an active business');
 if(SUSPICIOUS_HOST.test(u.hostname)||/^[0-9.]+$/.test(u.hostname))return failedResult('unsafe_host','Suspicious or insecure domain flagged and skipped before request');
 const ctx=makeCtx(netOptions);ctx.deadline=Date.now()+ctx.siteBudgetMs;
 const limit=Math.min(8,Math.max(2,Number(maxPages??process.env.MAX_PAGES_PER_WEBSITE)||6));
 const pages=[],found=new Map();let siteTitle='',error='',errorReason='',finalUrl='',jsShell=false;
 let entry;
 try{entry=await resolveEntry(u,ctx);}catch(e){
  const reason=classifyFetchError(e);const r=failedResult(reason,String(e.message||reason));
  if(seedEmail&&!isBlockedEmail(seedEmail)){
   const check=ctx.checkMail?await mailDomainCheck(seedEmail.split('@')[1].toLowerCase(),ctx):'unchecked';
   if(check==='no_mail_dns')r.rejectedEmailCount=1;
   else Object.assign(r,{email:seedEmail.toLowerCase(),emailSourceUrl:'Open-data business listing (not site-confirmed)',emailSourceType:'listing',emailDomainCheck:check,emailVerification:'Listed publicly; mailbox not verified',emailStatus:'Risky'});
  }
  return r;
 }
 const first=new URL(entry.url);
 if(SOCIAL_HOST.test(first.hostname)||PARKING_HOST.test(first.hostname))return failedResult('redirect_offsite_unusable',`Redirected to ${first.hostname}, which is not a usable business website`);
 const base=baseHost(first.hostname);finalUrl=first.href;
 const sameSite=href=>{try{return baseHost(new URL(href).hostname)===base}catch{return false}};
 const seen=new Set(),queue=[];
 const addQueue=(items)=>{for(const it of items)if(!seen.has(it.url)&&!queue.some(q=>q.url===it.url))queue.push(it)};
 function ingest(page){
  const parsed=parsePage(page.html,page.url);
  if(!siteTitle)siteTitle=siteName(page.html);
  if(parsed.jsShell)jsShell=true;
  pages.push(parsed);
  for(const email of extractEmails(page.html,base))if(!found.has(email))found.set(email,page.url);
  addQueue(discoverLinks(page.html,page.url,sameSite));
  if(!found.size)addQueue(['/contact','/contact-us','/pages/contact'].map(p=>({url:first.origin+p,priority:1.6,guess:true})));
 }
 seen.add(canon(entry.url));ingest(entry);
 let sitemapProductUrls=0;
 if(!queue.some(q=>q.priority===0)&&pages.length<limit){
  try{const urls=await sitemapBowlUrls(first.origin,ctx,sameSite);sitemapProductUrls=urls.length;addQueue(urls.map(u=>({url:canon(u),priority:0.5})));}catch{}
 }
 while(queue.length&&pages.length<limit){
  queue.sort((a,b)=>a.priority-b.priority);
  const next=queue.shift();if(seen.has(next.url))continue;seen.add(next.url);
  try{
   await sleep(Math.max(ctx.pageDelayMs,Math.min(5000,(ctx.robots.get(first.origin)?.delay||0)*1000)));
   const page=await fetchPage(next.url,ctx);
   if(!sameSite(page.url)){continue;}                                // never follow a redirect off the business's own domain
   seen.add(canon(page.url));ingest(page);
  }catch(e){if(!error&&!next.guess){error=String(e.message||e);errorReason=classifyFetchError(e);}}
 }
 if(seedEmail&&!isBlockedEmail(seedEmail)&&!found.has(seedEmail.toLowerCase()))found.set(seedEmail.toLowerCase(),'Open-data business listing (not site-confirmed)');
 let contact=[],emailDomainCheck='unchecked',rejectedEmailCount=0;
 for(const [em,src] of found.entries()){
  const check=ctx.checkMail?await mailDomainCheck(em.split('@')[1],ctx):'unchecked';
  if(check==='no_mail_dns'){rejectedEmailCount++;continue;}
  contact=[em,src];emailDomainCheck=check;break;
 }
 const quality=assessWebsite({product,listingScore,companyName,kind,pages,siteUrl:pages[0].url,minAdjacentScore});
 const jsOnly=jsShell&&pages.every(p=>p.text.length<400)&&['not-relevant','adjacent-retailer'].includes(quality.evidenceClass);
 return {email:contact[0]||'',emailSourceUrl:contact[1]||'',emailSourceType:contact[0]?(/^https?:/i.test(contact[1])?'website':'listing'):'',emailDomainCheck,emailVerification:contact[0]?'Listed publicly; mailbox not verified':'',rejectedEmailCount,sitemapProductUrls,emailStatus:contact[0]?'Risky':'Pending',buyerTier:jsOnly?'Unverified':quality.tier,buyerEvidence:jsOnly?'Website is JavaScript-rendered; no readable content without a browser':quality.evidence,classificationReason:jsOnly?'Website is JavaScript-rendered; product content could not be read':quality.classificationReason,evidenceClass:jsOnly?'unverified-site':quality.evidenceClass,evidenceRank:jsOnly?0:quality.evidenceRank,evidenceExcerpt:quality.evidenceExcerpt||'',evidenceUrl:quality.evidenceUrl||'',productSignal:jsOnly?'none':quality.productSignal||'none',websiteName:siteTitle,websiteVerified:true,pagesChecked:pages.length,siteError:error,failureReason:'',partialFailureReason:errorReason,finalUrl,rendering:jsShell?'js_shell':'html'};
}
export async function findPublicBusinessEmail(website,opts={}) {
 const r=await inspectPublicWebsite(website,opts);
 return {email:r.email,status:r.email?'FOUND_PUBLIC_UNVERIFIED':'NOT_FOUND',source:r.emailSourceUrl,candidates:r.email?[r.email]:[],error:r.siteError||'',failureReason:r.failureReason||''};
}
/** Same counters the live progress uses, for an arbitrary list of already-enriched results (e.g. reused from the cache). */
export function summarizeResults(results){
 const t={websitesChecked:0,websitesSucceeded:0,websitesFailed:0,failureReasons:{},jsRenderedSites:0,emailsFound:0,emailsRejected:0,productMatches:0,strongMatches:0,outreachCandidates:0};
 for(const r of results){
  t.websitesChecked++;
  if(r.websiteVerified){t.websitesSucceeded++;if(r.rendering==='js_shell')t.jsRenderedSites++;}else{t.websitesFailed++;const k=r.failureReason||'unknown';t.failureReasons[k]=(t.failureReasons[k]||0)+1;}
  const emailOk=r.email&&!isBlockedEmail(r.email);if(emailOk)t.emailsFound++;t.emailsRejected+=r.rejectedEmailCount||0;
  const match=r.websiteVerified&&['Strong match','Potential'].includes(r.buyerTier);
  if(match)t.productMatches++;if(r.websiteVerified&&r.buyerTier==='Strong match')t.strongMatches++;if(match&&emailOk)t.outreachCandidates++;
 }
 return t;
}
export async function enrichBusinessLeads(leads,{concurrency=4,product='Singing Bowls',inspect=inspectPublicWebsite,inspectOptions={},onProgress=()=>{}}={}) {
 const results=new Array(leads.length);let next=0;
 const tally={websitesChecked:0,websitesSucceeded:0,websitesFailed:0,failureReasons:{},jsRenderedSites:0,emailsFound:0,emailsRejected:0,productMatches:0,strongMatches:0,outreachCandidates:0};
 function count(r){
  tally.websitesChecked++;
  if(r.websiteVerified){tally.websitesSucceeded++;if(r.rendering==='js_shell')tally.jsRenderedSites++;}
  else{tally.websitesFailed++;const k=r.failureReason||'unknown';tally.failureReasons[k]=(tally.failureReasons[k]||0)+1;}
  const emailOk=r.email&&!isBlockedEmail(r.email);if(emailOk)tally.emailsFound++;tally.emailsRejected+=r.rejectedEmailCount||0;
  const match=r.websiteVerified&&['Strong match','Potential'].includes(r.buyerTier);
  if(match)tally.productMatches++;if(r.websiteVerified&&r.buyerTier==='Strong match')tally.strongMatches++;
  if(match&&emailOk)tally.outreachCandidates++;
  onProgress({...tally,failureReasons:{...tally.failureReasons},websitesTotal:leads.length});
 }
 const hardCapMs=Math.max(5000,Number(inspectOptions.siteBudgetMs??process.env.WEBSITE_SITE_BUDGET_MS)||15000)+3000;
 async function worker(){while(next<leads.length){const i=next++,lead=leads[i];let r;try{
  const inspected=await Promise.race([
   inspect(lead.website,{product,listingScore:lead.score,companyName:lead.companyName,kind:lead.kind,seedEmail:lead.email,...inspectOptions}),
   new Promise((_,rej)=>setTimeout(()=>rej(fail('timeout','Hard per-site timeout exceeded')),hardCapMs))
  ]);
  r={...lead,...inspected,email:inspected.email||'',notes:[lead.notes,inspected.siteError?`Website: ${inspected.siteError}`:''].filter(Boolean).join(' | ')};
 }catch(err){const reason=classifyFetchError(err);r={...lead,...failedResult(reason,String(err.message||err))};}
 results[i]=r;count(r);}}
 await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),leads.length)},worker));return results;
}
