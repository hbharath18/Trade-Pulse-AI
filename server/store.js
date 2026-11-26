import {isBlockedEmail} from './lead-quality.js';
export const domainOf=url=>{try{return new URL(/^https?:\/\//i.test(url)?url:'https://'+url).hostname.toLowerCase().replace(/^www\./,'')}catch{return ''}};
/** Record storage on top of the existing `records(kind,id,data)` table. Display order = newest first. */
export function createStore(db){
 const readRecords=kind=>db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r=>JSON.parse(r.data));
 // Rows arrive in display order (newest first). They are inserted oldest-first so that `ORDER BY rowid DESC` returns the same order
 // on every read; inserting them as given reversed the list on every save.
 const saveRecords=(kind,rows)=>{
  db.exec('BEGIN');
  try{
   db.prepare('DELETE FROM records WHERE kind=?').run(kind);
   const put=db.prepare('INSERT INTO records(kind,id,data) VALUES(?,?,?)');
   for(const r of [...rows].reverse()){if(!r||typeof r.id!=='string'||r.id.length>160)throw Error('Invalid record id');put.run(kind,r.id,JSON.stringify(r));}
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
 };
 function upsertLeads(newLeads, options={}){
  const existing=readRecords('lead'),byDomain=new Map(),fresh=[];
  existing.forEach((r,i)=>{const d=domainOf(r.website);if(d&&!byDomain.has(d))byDomain.set(d,i)});
  let added=0,updated=0,skippedNoEmail=0;
  for(const candidate of newLeads){
   const d=domainOf(candidate.website);
   if(!d)continue;
   const hasEmail = Boolean(candidate.email && !isBlockedEmail(candidate.email));
   if(!hasEmail && options.requireEmail !== false){
    skippedNoEmail++;
    continue;
   }
   const i=byDomain.get(d);
   if(i===undefined){byDomain.set(d,-1-fresh.length);fresh.push(candidate);added++;continue;}
   if(i<0){ // same domain twice inside one scan: keep the stronger evidence
    const k=-1-i;if((candidate.evidenceRank||0)>(fresh[k].evidenceRank||0))fresh[k]={...candidate,id:fresh[k].id};continue;
   }
   const old=existing[i];
   const stronger=(candidate.evidenceRank||0)>=(old.evidenceRank||0)||!old.buyerTier;
   if(stronger){const materialChange=(old.email!==candidate.email)||(old.website!==candidate.website)||(old.buyerTier!==candidate.buyerTier);
    existing[i]={...old,...candidate,id:old.id,dateAdded:old.dateAdded||candidate.dateAdded,reviewed:materialChange?false:Boolean(old.reviewed),
     outreachStatus:old.outreachStatus||'Not Contacted',callStatus:old.callStatus||'Pending',
     notes:[old.notes,candidate.notes].filter(Boolean).slice(-2).join(' | ')};updated++;}
  }
  const merged=[...fresh,...existing];
  saveRecords('lead',merged);
  return {added,updated,skippedNoEmail,missingContactCount:skippedNoEmail,total:merged.length};
 }
 function upsertResearch(incoming){
  const buyers=new Set(readRecords('lead').map(x=>domainOf(x.website)));
  const rows=readRecords('research'),index=new Map(rows.map((x,i)=>[domainOf(x.website),i])),fresh=[];
  let added=0,updated=0;
  for(const r of incoming){const key=domainOf(r.website);if(!key||buyers.has(key))continue;
   const i=index.get(key);
   if(i===undefined){index.set(key,-1-fresh.length);fresh.push(r);added++;}
   else if(i<0){continue;}
   else {rows[i]={...rows[i],...r,id:rows[i].id,dateAdded:rows[i].dateAdded||r.dateAdded,reviewed:false};updated++;}
  }
  // When a genuine buyer is later qualified, remove that domain from research.
  const remaining=[...fresh,...rows].filter(r=>!buyers.has(domainOf(r.website)));
  saveRecords('research',remaining);
  return {added,updated,total:remaining.length};
 }

 // Cache of website checks (per domain + product) so repeat scans do not re-crawl, and an interrupted scan can resume cheaply.
 // Successful checks live RESCAN_AFTER_DAYS (default 14; 0 disables). Permanent failures live 3 days. Transient failures are never cached.
 db.exec('CREATE TABLE IF NOT EXISTS site_checks (domain TEXT NOT NULL, product TEXT NOT NULL, checked_at TEXT NOT NULL, ok INTEGER NOT NULL, reason TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(domain,product))');
 const PERMANENT=new Set(['dns_not_found','ssl_error','http_not_found','not_html','social_profile','invalid_url','redirect_offsite_unusable','robots_disallowed','blocked_by_site','unsafe_host']);
 const days=()=>{const n=Number.parseFloat(process.env.RESCAN_AFTER_DAYS??'14');return Number.isFinite(n)?Math.max(0,n):14;};
 const siteCache={
  get(website,product){
   const ttl=days();if(!ttl)return null;const d=domainOf(website);if(!d)return null;
   const row=db.prepare('SELECT checked_at,ok,data FROM site_checks WHERE domain=? AND product=?').get(d,product);
   if(!row)return null;
   const age=Date.now()-Date.parse(row.checked_at),limit=(row.ok?ttl:Math.min(3,ttl))*86400000;
   return age<limit?JSON.parse(row.data):null;
  },
  set(website,product,result){
   if(!days())return;const d=domainOf(website);if(!d)return;
   const ok=Boolean(result.websiteVerified);
   if(!ok&&!PERMANENT.has(result.failureReason))return;
   db.prepare('INSERT OR REPLACE INTO site_checks(domain,product,checked_at,ok,reason,data) VALUES(?,?,?,?,?,?)').run(d,product,new Date().toISOString(),ok?1:0,result.failureReason||'',JSON.stringify(result));
  },
  clear(){db.exec('DELETE FROM site_checks');}
 };
 return {readRecords,saveRecords,upsertLeads,upsertResearch,siteCache};
}
