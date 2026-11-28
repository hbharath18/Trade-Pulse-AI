/** Local-only, manually approved Gmail outreach. No background sending or tracking pixels. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isBlockedEmail } from './lead-quality.js';

export const DAILY_EMAIL_CAP = 50;
export const BATCH_EMAIL_CAP = 10;
export const SCOPE = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email';
const validEmail = value => /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(String(value||'')) && String(value).length <= 254 && !isBlockedEmail(value);
const cleanHeader = v => String(v||'').replace(/[\r\n\0]/g,' ').trim().slice(0,180);
const dayUTC = () => new Date().toISOString().slice(0,10);
const envCap = () => Math.max(1,Math.min(DAILY_EMAIL_CAP,Number.parseInt(process.env.DAILY_EMAIL_CAP||'50',10)||DAILY_EMAIL_CAP));
export const mailbox = header => (String(header||'').match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] || String(header||'').match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i)?.[0] || '').toLowerCase();
export const merge = (value,lead={}) => {
  const merged = String(value||'').replace(/\{(companyName|city|state|product|evidence|website)\}/g,(_,k)=>String({companyName:lead.companyName||'',city:lead.city||'',state:lead.state||'',product:lead.category||'Singing Bowls',evidence:lead.buyerEvidence||'related products',website:lead.website||''}[k])).trim();
  const unmapped = merged.match(/\{[a-zA-Z0-9_-]+\}/g);
  if(unmapped) throw Object.assign(Error(`Unresolved template variable(s): ${unmapped.join(', ')}`), {status: 400});
  return merged;
};
export const defaultSubject = 'Wholesale Inquiry – Handcrafted Home Décor & Giftware';
export const defaultBody = 'Hello,\n\nI hope you’re doing well.\n\nI’m reaching out on behalf of OM Enterprise, where we specialize in handcrafted home décor and gifting products, including decorative lanterns, candle holders, and decorative jars.\n\nWe would love to explore the possibility of working with your business and would be happy to share our product collection for your review.\n\nWould you be interested in exploring potential wholesale opportunities with us?\n\nLooking forward to hearing from you.';
export function footer({senderName,businessName,postalAddress,gmail}) {
 const sigName=senderName||'Bharath';
 const sigCompany=businessName||'OM Enterprise';
 return `\n\nSincerely,\n${sigName}\nExport & International Sourcing Coordinator\n${sigCompany}\n\n---\n${postalAddress}\nTo stop receiving these inquiries, reply UNSUBSCRIBE to ${gmail}.`;
}
export function composePreview(lead,subject,body,settings){
 return {to:lead.email,subject:merge(subject||defaultSubject,lead),body:merge(body||defaultBody,lead)+footer(settings)};
}
const ALLOWED_MIME=/^(?:application\/(?:pdf|msword|vnd\.openxmlformats-officedocument\.(?:wordprocessingml\.document|spreadsheetml\.sheet))|text\/csv|image\/(?:png|jpeg|webp|gif))$/;
export function validateAttachments(list=[]){
 if(!Array.isArray(list))throw Object.assign(Error('Invalid attachments list'),{status:400});
 if(list.length>6)throw Object.assign(Error('Maximum 6 attachments in batch pool'),{status:400});
 let totalBytes=0;
 return list.map(item=>{
  const filename=cleanHeader(item?.filename||'attachment').replace(/["\\\/]/g,'_').slice(0,120)||'attachment';
  const mimeType=String(item?.mimeType||'').toLowerCase().trim();
  const data=String(item?.data||'').replace(/\s+/g,'');
  if(!ALLOWED_MIME.test(mimeType))throw Object.assign(Error(`Unsupported file type for ${filename}. Allowed: PDF, DOCX, XLSX, CSV, PNG, JPG, WEBP`),{status:400});
  if(!data||!/^[A-Za-z0-9+/=]+$/.test(data))throw Object.assign(Error(`Invalid file encoding for ${filename}`),{status:400});
  const bytes=Buffer.byteLength(data,'base64');
  totalBytes+=bytes;
  if(bytes>5*1024*1024||totalBytes>8*1024*1024)throw Object.assign(Error('Attachments exceed 8 MB total (or 5 MB per file)'),{status:400});
  return {filename,mimeType,data};
 });
}
const PRESET_PRODUCT_ORDER=['Singing Bowls','Indian Handicrafts','Home Decor','Brass Lamps','Handcrafted Accents'];

export function buildProductOrder(allCategories=[]){
 const order=[...PRESET_PRODUCT_ORDER];
 for(const cat of allCategories){
  const clean=String(cat||'').trim();
  if(clean && !order.some(x=>x.toLowerCase()===clean.toLowerCase()))order.push(clean);
 }
 return order;
}

export function resolveAttachmentsForProduct(attachments, product, allCategories=[]){
 const files=validateAttachments(attachments);
 if(!files.length)return [];
 const order=buildProductOrder(allCategories);
 const target=String(product||'Singing Bowls').trim().toLowerCase();
 const idx=order.findIndex(p=>p.toLowerCase()===target);
 const expectedNum=idx>=0?idx+1:-1; // 1-based: Singing Bowls -> 1, Indian Handicrafts -> 2, Home Decor -> 3...

 const getImageSlot=filename=>{
  const base=String(filename||'').replace(/\.[^.]+$/,'').trim();
  const m=base.match(/^image[\s_-]*(\d+)$/i);
  return m?Number(m[1]):null;
 };

 const numberedFiles=files.filter(f=>getImageSlot(f.filename)!==null);
 if(!numberedFiles.length)return files;
 const sharedFiles=files.filter(f=>getImageSlot(f.filename)===null);
 const matched=numberedFiles.filter(f=>getImageSlot(f.filename)===expectedNum);
 return [...matched,...sharedFiles];
}

export function encodeMime({to,from,displayName,subject,body,messageId,attachments=[]}) {
 if(!validEmail(to)||!validEmail(from))throw Error('Invalid email address');
 const hdr=s=>'=?UTF-8?B?'+Buffer.from(cleanHeader(s),'utf8').toString('base64')+'?=';
 const name=displayName?hdr(displayName)+' ':'';
 const cleanBody=String(body).replace(/\r?\n/g,'\r\n');
 const files=validateAttachments(attachments);
 if(!files.length){
  const mime=[`To: ${to}`,`From: ${name}<${from}>`,`Reply-To: ${from}`,`Subject: ${hdr(subject)}`,`Date: ${new Date().toUTCString()}`,`Message-ID: <${messageId}@tradepulse.local>`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 8bit','',cleanBody].join('\r\n');
  return Buffer.from(mime,'utf8').toString('base64url');
 }
 const inlineImages=files.filter(f=>f.mimeType.startsWith('image/'));
 const docAttachments=files.filter(f=>!f.mimeType.startsWith('image/'));
 const escHtml=s=>String(s).replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"');
 const footerSplit=cleanBody.split('\r\n\r\n---\r\n');
 const mainHtml=escHtml(footerSplit[0]).replace(/\r\n/g,'<br>');
 const footerHtml=footerSplit[1]?`<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0 12px;"><div style="font-size:12px;color:#64748b;line-height:1.5;">${escHtml(footerSplit[1]).replace(/\r\n/g,'<br>')}</div>`:'';
 const imgGalleryHtml=inlineImages.length
  ?`<div style="margin:0 0 18px 0;">${inlineImages.map((img,idx)=>`<div style="margin-bottom:12px;"><img src="cid:img${idx}@tradepulse.local" alt="${escHtml(img.filename)}" style="max-width:340px;max-height:440px;width:auto;height:auto;border-radius:8px;border:1px solid #e2e8f0;display:block;"/></div>`).join('')}</div>`
  :'';
 const fullHtml=`<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1e293b;margin:0;padding:0;">${imgGalleryHtml}<div>${mainHtml}</div>${footerHtml}</body></html>`;
 const mixBoundary='----=_TradePulse_Mix_'+crypto.randomBytes(12).toString('hex');
 const relBoundary='----=_TradePulse_Rel_'+crypto.randomBytes(12).toString('hex');
 const altBoundary='----=_TradePulse_Alt_'+crypto.randomBytes(12).toString('hex');
 const parts=[
  `To: ${to}`,`From: ${name}<${from}>`,`Reply-To: ${from}`,`Subject: ${hdr(subject)}`,`Date: ${new Date().toUTCString()}`,`Message-ID: <${messageId}@tradepulse.local>`,
  'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${mixBoundary}"`,'',
  `--${mixBoundary}`,`Content-Type: multipart/related; boundary="${relBoundary}"`,'',
  `--${relBoundary}`,`Content-Type: multipart/alternative; boundary="${altBoundary}"`,'',
  `--${altBoundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 8bit','',cleanBody,
  `--${altBoundary}`,'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: 8bit','',fullHtml,
  `--${altBoundary}--`
 ];
 inlineImages.forEach((img,idx)=>{
  const wrapped=img.data.replace(/.{1,76}/g,'$&\r\n').trim();
  parts.push(`--${relBoundary}`,`Content-Type: ${img.mimeType}; name="${img.filename}"`,`Content-ID: <img${idx}@tradepulse.local>`,`Content-Disposition: inline; filename="${img.filename}"`,'Content-Transfer-Encoding: base64','',wrapped);
 });
 parts.push(`--${relBoundary}--`);
 for(const f of docAttachments){
  const wrapped=f.data.replace(/.{1,76}/g,'$&\r\n').trim();
  parts.push(`--${mixBoundary}`,`Content-Type: ${f.mimeType}; name="${f.filename}"`,`Content-Disposition: attachment; filename="${f.filename}"`,'Content-Transfer-Encoding: base64','',wrapped);
 }
 parts.push(`--${mixBoundary}--`,'');
 return Buffer.from(parts.join('\r\n'),'utf8').toString('base64url');
}
/** Key lives locally beside SQLite and must be backed up with the database. */
export function tokenCipher(databasePath){
 const keyPath=path.join(path.dirname(path.resolve(databasePath)),'.tradepulse-token-key');
 let key;
 try {key=fs.readFileSync(keyPath);}catch(e){if(e.code!=='ENOENT')throw e;try{fs.writeFileSync(keyPath,crypto.randomBytes(32),{flag:'wx',mode:0o600});}catch(err){if(err.code!=='EEXIST')throw err;}key=fs.readFileSync(keyPath);}
 if(key.length!==32)throw Error('Invalid token encryption key. Restore the original .tradepulse-token-key backup.');
 return {
  encrypt(plain){const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',key,iv);const payload=Buffer.concat([c.update(String(plain),'utf8'),c.final()]);return [iv.toString('base64url'),c.getAuthTag().toString('base64url'),payload.toString('base64url')].join('.');},
  decrypt(data){if(!data)return '';const parts=String(data).split('.');if(parts.length!==3)throw Error('Stored Gmail credentials unreadable; reconnect Gmail.');const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(parts[0],'base64url'));d.setAuthTag(Buffer.from(parts[1],'base64url'));return Buffer.concat([d.update(Buffer.from(parts[2],'base64url')),d.final()]).toString('utf8');}
 };
}
export function matchingReply(messages, recipient, sentAt, ownAddress){
 const after=(Date.parse(sentAt)||0)-60000;
 const rec=String(recipient||'').toLowerCase();
 const recDomain=rec.split('@')[1]||'';
 const own=String(ownAddress||'').toLowerCase();
 return (messages||[]).filter(m=>{
  const headers=m.payload?.headers||[];
  const rawFrom=headers.find(h=>h.name.toLowerCase()==='from')?.value||'';
  const from=mailbox(rawFrom);
  if(!from || from===own)return false;
  if(/mailer-daemon|postmaster|delivery subsystem/i.test(rawFrom))return false;
  if((m.labelIds||[]).includes('SENT') && !(m.labelIds||[]).includes('INBOX'))return false;
  if(Number(m.internalDate||0)<after)return false;
  const fromDomain=from.split('@')[1]||'';
  return from===rec || (Boolean(recDomain) && fromDomain===recDomain);
 }).sort((a,b)=>Number(b.internalDate||0)-Number(a.internalDate||0))[0]||null;
}
export function matchingBounce(messages, recipient, sentAt, ownAddress){
 const after=Date.parse(sentAt)||0;
 const own=String(ownAddress||'').toLowerCase();
 return (messages||[]).filter(m=>{
  const headers=m.payload?.headers||[];
  const rawFrom=headers.find(h=>h.name.toLowerCase()==='from')?.value||'';
  const from=mailbox(rawFrom);
  const subj=String(headers.find(h=>h.name.toLowerCase()==='subject')?.value||'').toLowerCase();
  const snippet=String(m.snippet||'').toLowerCase();
  if(from && from===own)return false;
  if(Number(m.internalDate||0)<after)return false;
  return /mailer-daemon|postmaster|delivery subsystem/i.test(rawFrom)
   || /delivery status notification|undeliverable|returned mail|failure notice/.test(subj)
   || /address not found|wasn't delivered|couldn't be delivered|550 5\.1\.1|does not exist/.test(snippet);
 }).sort((a,b)=>Number(b.internalDate||0)-Number(a.internalDate||0))[0]||null;
}
export function installOutreach(app,{db,getSetting,setSetting,readRecords,saveRecords,dbPath,fetchImpl=fetch}){
 db.exec(`CREATE TABLE IF NOT EXISTS outreach (id TEXT PRIMARY KEY, lead_id TEXT NOT NULL, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL, gmail_message_id TEXT NOT NULL DEFAULT '', gmail_thread_id TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', reply_at TEXT NOT NULL DEFAULT '', reply_from TEXT NOT NULL DEFAULT '', reply_snippet TEXT NOT NULL DEFAULT '');
 CREATE INDEX IF NOT EXISTS outreach_day_idx ON outreach(day); CREATE INDEX IF NOT EXISTS outreach_thread_idx ON outreach(gmail_thread_id);
 CREATE TABLE IF NOT EXISTS suppression (email TEXT PRIMARY KEY, created_at TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '');`);
 const cipher=tokenCipher(dbPath);
 const cfg={client:process.env.GOOGLE_CLIENT_ID||'',secret:process.env.GOOGLE_CLIENT_SECRET||'',redirect:process.env.GOOGLE_REDIRECT_URI||'http://localhost:4100/api/gmail/callback'};
 const configured=()=>Boolean(cfg.client && cfg.secret && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api\/gmail\/callback$/.test(cfg.redirect));
 const smtpEmail=()=>getSetting('gmail_email');
 const emailStatus=()=>({configured:configured(),connected:Boolean(smtpEmail()&&getSetting('gmail_refresh_enc')),email:smtpEmail(),replyTrackingScope:'gmail.readonly (restricted Google OAuth scope)',clientType:process.env.GOOGLE_OAUTH_CLIENT_TYPE||'web',dailyLimit:envCap(),sentAttemptsToday:db.prepare('SELECT COUNT(*) AS n FROM outreach WHERE day=?').get(dayUTC()).n,perBatchLimit:BATCH_EMAIL_CAP});
 const now=()=>new Date().toISOString();
 async function request(url,opts={}){
  const r=await fetchImpl(url,{...opts,signal:AbortSignal.timeout(20000)});
  let data;try{data=await r.json();}catch{data={};}
  if(!r.ok)throw Object.assign(Error(data.error_description||data.error?.message||data.error||`Request failed (${r.status})`),{status:r.status>=500?502:400});return data;
 }
 async function accessToken(){
  const access=getSetting('gmail_access_enc');
  if(access && Number(getSetting('gmail_expires_at'))>Date.now()+60000)return cipher.decrypt(access);
  const refresh=getSetting('gmail_refresh_enc');if(!refresh||!configured())throw Object.assign(Error('Gmail is not connected. Open Settings and connect Gmail.'),{status:401});
  const token=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:cfg.client,client_secret:cfg.secret,refresh_token:cipher.decrypt(refresh),grant_type:'refresh_token'})});
  if(!token.access_token)throw Error('Google did not return a valid access token');
  setSetting('gmail_access_enc',cipher.encrypt(token.access_token));setSetting('gmail_expires_at',String(Date.now()+Number(token.expires_in||3600)*1000));return token.access_token;
 }
 async function gmail(url,options={}){const bearer=await accessToken();return request('https://gmail.googleapis.com/gmail/v1/users/me/'+url,{...options,headers:{Authorization:'Bearer '+bearer,...options.headers}})}
 function error(res,e){return res.status(e.status||500).json({error:e.message||'Unexpected error'});}
 app.get('/api/gmail/status',(_,res)=>res.json(emailStatus()));
 app.get('/api/gmail/connect',(req,res)=>{
  if(!configured())return res.status(503).type('text/plain').send('Gmail setup incomplete. Check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI in server/.env; localhost callback must match your Cloud OAuth client.');
  const state=crypto.randomBytes(30).toString('base64url'),verifier=crypto.randomBytes(32).toString('base64url');const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  setSetting('oauth_pending',JSON.stringify({state,verifier,time:Date.now()}));
  const q=new URLSearchParams({client_id:cfg.client,redirect_uri:cfg.redirect,response_type:'code',scope:SCOPE,access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'});
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?'+q);
 });
 app.get('/api/gmail/callback',async(req,res)=>{
  try{
   const pending=JSON.parse(getSetting('oauth_pending')||'{}');setSetting('oauth_pending','');
   if(!pending.state||typeof req.query.state!=='string'||pending.state!==req.query.state||Date.now()-pending.time>600000)throw Error('Expired or invalid OAuth state. Start Gmail connection again.');
   if(req.query.error)throw Error('Google authorization declined: '+String(req.query.error));
   if(typeof req.query.code!=='string')throw Error('Authorization code missing');
   const t=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:cfg.client,client_secret:cfg.secret,code:req.query.code,code_verifier:pending.verifier,redirect_uri:cfg.redirect,grant_type:'authorization_code'})});
   if(!t.access_token)throw Error('Google did not provide an access token');
   if(t.refresh_token)setSetting('gmail_refresh_enc',cipher.encrypt(t.refresh_token));
   if(!getSetting('gmail_refresh_enc'))throw Error('Google did not return offline authorization. Reconnect with prompt=consent.');
   setSetting('gmail_access_enc',cipher.encrypt(t.access_token));setSetting('gmail_expires_at',String(Date.now()+Number(t.expires_in||3600)*1000));
   const profile=await gmail('profile');if(!validEmail(profile.emailAddress))throw Error('Google account email unavailable');setSetting('gmail_email',profile.emailAddress.toLowerCase());
   res.type('html').send('<!doctype html><html><meta charset="utf-8"><body style="font:16px system-ui;padding:35px;background:#0e1719;color:#eee"><h2>Gmail connected successfully ✓</h2><p>Return to TradePulse AI, open Settings, and refresh connection status. No emails were sent.</p></body></html>');
  }catch(e){res.status(400).type('text/plain').send('Gmail connection unsuccessful: '+String(e.message).replace(/[<>]/g,''));}
 });
 app.post('/api/gmail/disconnect',async(_,res)=>{
  const tok=getSetting('gmail_access_enc');
  if(tok){try{await fetchImpl('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:cipher.decrypt(tok)}),signal:AbortSignal.timeout(4000)});}catch{}}
  for(const k of ['gmail_access_enc','gmail_refresh_enc','gmail_expires_at','gmail_email','oauth_pending'])setSetting(k,'');res.json({ok:true});
 });
 const settings=()=>({senderName:getSetting('outreach_sender_name'),businessName:getSetting('outreach_business_name'),postalAddress:getSetting('outreach_postal'),openAiEnabled:process.env.ENABLE_OPENAI==='true'&&!!process.env.OPENAI_API_KEY,openAiConfigured:!!process.env.OPENAI_API_KEY,openAiModel:process.env.OPENAI_MODEL||'gpt-5-mini'});
 app.get('/api/outreach/settings',(_,res)=>res.json({settings:settings(),gmail:emailStatus(),templates:{subject:defaultSubject,body:defaultBody}}));
 app.put('/api/outreach/settings',(req,res)=>{
  try{const {senderName,businessName,postalAddress}=req.body||{};
   for(const [k,v,max] of [['senderName',senderName,90],['businessName',businessName,110],['postalAddress',postalAddress,400]])if(typeof v!=='string'||v.length>max)throw Object.assign(Error('Invalid '+k),{status:400});
   setSetting('outreach_sender_name',cleanHeader(senderName));setSetting('outreach_business_name',cleanHeader(businessName));setSetting('outreach_postal',postalAddress.trim());res.json({settings:settings()});
  }catch(e){error(res,e)}
 });
 function checkCompose(lead){if(!lead||!lead.id||!validEmail(lead.email))throw Object.assign(Error('Select a real lead with a usable business email'),{status:422});}
 app.post('/api/outreach/preview',(req,res)=>{
  try{const lead=readRecords('lead').find(x=>x.id===req.body?.leadId);checkCompose(lead);
   const {subjectTemplate=defaultSubject,bodyTemplate=defaultBody}=req.body||{};
   if(typeof subjectTemplate!=='string'||typeof bodyTemplate!=='string'||subjectTemplate.length>300||bodyTemplate.length>7000)throw Object.assign(Error('Subject or message too long'),{status:400});
   res.json(composePreview(lead,subjectTemplate,bodyTemplate,{senderName:settings().senderName,businessName:settings().businessName,postalAddress:settings().postalAddress||'[Add a real sender postal address in Settings before sending]',gmail:smtpEmail()||'[Connect Gmail before sending]'}));
  }catch(e){error(res,e)}
 });
 app.post('/api/outreach/ai-draft',async(req,res)=>{
  const allLeads=readRecords('lead');
  const ids=Array.isArray(req.body?.leadIds)&&req.body.leadIds.length?req.body.leadIds:(req.body?.leadId?[req.body.leadId]:[]);
  const picked=ids.map(id=>allLeads.find(x=>x.id===id)).filter(Boolean);
  const isBatch=picked.length>1;
  const lead=picked[0];
  try{
   if(!lead)return res.status(422).json({error:'Select at least 1 reviewed buyer first'});
   checkCompose(lead);
   if(process.env.ENABLE_OPENAI!=='true'||!process.env.OPENAI_API_KEY){
    return res.json({subject:defaultSubject,body:defaultBody,fallback:true,note:'OpenAI disabled — loaded built-in formal template.'});
   }
   const categories=[...new Set(picked.map(x=>x.category||'Singing Bowls'))].join(' / ');
   const prompt=isBatch
    ?`Write a formal, polished B2B wholesale supplier introduction email from an Indian export sourcing business to US retail/wholesale buyers of ${categories}.\nCRITICAL: You MUST use these exact template placeholders where appropriate so the system can merge each recipient's details: {companyName}, {city}, {state}, and {product}. Do NOT hardcode any single store name.\nFormat:\n- Formal business greeting ("Dear {companyName} Purchasing Team," or "Dear {companyName} Team,")\n- 2–3 concise, formal paragraphs introducing direct sourcing from Indian artisan workshops, reliable export packaging/dispatch, and offering to share our wholesale catalog and line sheet.\n- Do NOT include a closing ("Sincerely,"), sender name, postal address, or unsubscribe text (the signature and compliance footer are appended automatically).\n- Do not claim they already purchase from us or invent certifications/pricing.\nSender Company: ${settings().businessName||'OM Enterprise'}\nLength: 90-135 words. Respond in JSON only: {"subject":"...","body":"..."}.`
    :`Write a formal, polished B2B wholesale supplier introduction email from an Indian export sourcing business to a US buyer.\nFormat:\n- Formal business greeting ("Dear ${lead.companyName} Purchasing Team," or "Dear ${lead.companyName} Team,")\n- 2–3 concise, formal paragraphs referencing their business in ${lead.city}, ${lead.state} (${lead.buyerEvidence||'specialty retailer'}), introducing direct wholesale sourcing of ${lead.category||'Singing Bowls'} from Indian workshops, and offering a wholesale catalog/line sheet for their buyer review.\n- Do NOT include a closing ("Sincerely,"), sender name, postal address, or unsubscribe text (the signature and compliance footer are appended automatically).\n- Do not claim they already purchase from us or invent certifications/pricing.\nTarget Buyer: ${lead.companyName}\nLocation: ${lead.city}, ${lead.state}\nProduct Category: ${lead.category||'Singing Bowls'}\nStore Context: ${lead.buyerEvidence||'specialty retailer'}\nSender Company: ${settings().businessName||'OM Enterprise'}\nLength: 90-135 words. Respond in JSON only: {"subject":"...","body":"..."}.`;
   const model=process.env.OPENAI_MODEL||'gpt-5-mini';
   const resAi=await fetchImpl('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    signal:AbortSignal.timeout(20000),
    headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({
     model,
     messages:[
      {role:'system',content:'You write formal, courteous, executive B2B international trade outreach emails—never casual text messages. Output valid JSON only with keys "subject" and "body".'},
      {role:'user',content:prompt}
     ],
     response_format:{type:'json_object'}
    })
   });
   if(!resAi.ok){
    const errBody=await resAi.json().catch(()=>({}));
    throw Error(errBody?.error?.message||`OpenAI status ${resAi.status}`);
   }
   const jsonRes=await resAi.json();
   const rawOutput=jsonRes.choices?.[0]?.message?.content||'';
   const cleanOutput=rawOutput.replace(/^```json\s*/i,'').replace(/```\s*$/i,'').trim();
   const match=cleanOutput.match(/\{[\s\S]*\}/);
   if(!match)throw Error('Non-JSON response from OpenAI');
   const draft=JSON.parse(match[0]);
   if(typeof draft.subject!=='string'||typeof draft.body!=='string'||!draft.subject.trim()||!draft.body.trim())throw Error('Incomplete AI draft');
   res.json({
    subject:draft.subject.slice(0,200),
    body:draft.body.slice(0,4000),
    fallback:false,
    note:isBatch
     ?`Formal AI batch template generated for ${picked.length} buyers using merge tokens. Click Preview to inspect before sending.`
     :`Formal AI email generated for ${lead.companyName}. Review before sending.`
   });
  }catch(e){
   res.json({
    subject:defaultSubject,
    body:defaultBody,
    fallback:true,
    note:`OpenAI generation failed (${e instanceof Error?e.message:String(e)}) — fell back to the built-in formal template.`
   });
  }
 });
 let sending=false;
 app.post('/api/outreach/send',async(req,res)=>{
  if(sending)return res.status(409).json({error:'An email batch is already in progress'});
  try {
  const {leadIds,subjectTemplate=defaultSubject,bodyTemplate=defaultBody,approvalPhrase,attachments=[]}=req.body||{};
  const validFiles=validateAttachments(attachments);
  if(!Array.isArray(leadIds)||leadIds.length<1||leadIds.length>BATCH_EMAIL_CAP||new Set(leadIds).size!==leadIds.length)return res.status(400).json({error:`Select 1–${BATCH_EMAIL_CAP} unique buyers per batch`});
  if(approvalPhrase!==`SEND ${leadIds.length}`)return res.status(400).json({error:`Manual approval required: enter SEND ${leadIds.length}`});
  if(typeof subjectTemplate!=='string'||typeof bodyTemplate!=='string'||!subjectTemplate.trim()||!bodyTemplate.trim()||subjectTemplate.length>300||bodyTemplate.length>7000)return res.status(400).json({error:'A valid editable subject and message are required'});
  const sender=settings(),gmailEmail=smtpEmail();
  if(!gmailEmail||!getSetting('gmail_refresh_enc'))return res.status(401).json({error:'Connect Gmail in Settings before sending'});
  if(!sender.postalAddress||sender.postalAddress.length<10||/\[|placeholder|your address|example|sample street|fake street|test address/i.test(sender.postalAddress))return res.status(422).json({error:'Enter your real postal address in Settings before sending commercial outreach'});
  if(!sender.senderName)return res.status(422).json({error:'Enter sender name in Settings'});
  const all=readRecords('lead'),leads=leadIds.map(id=>all.find(x=>x.id===id));
  for(const lead of leads){if(!lead||!lead.reviewed||!['Strong match','Potential'].includes(lead.buyerTier)||!validEmail(lead.email))return res.status(422).json({error:'Every selected lead must be individually reviewed, relevant, and have a valid public business email'});
    if(db.prepare('SELECT 1 FROM suppression WHERE email=?').get(lead.email.toLowerCase()))return res.status(422).json({error:`Suppressed contact: ${lead.email}`});
    const previous=db.prepare("SELECT 1 FROM outreach WHERE recipient=? AND ((status IN ('attempted','sent','replied') AND created_at>=?) OR (status='failed' AND created_at>=?))").get(lead.email.toLowerCase(),new Date(Date.now()-30*86400000).toISOString(),new Date(Date.now()-86400000).toISOString());
    if(previous)return res.status(422).json({error:`Recently contacted or ambiguous recent failed attempt: ${lead.email}. See History before retrying.`});
  }
  const used=db.prepare('SELECT COUNT(*) AS n FROM outreach WHERE day=?').get(dayUTC()).n;
  if(used+leads.length>envCap())return res.status(429).json({error:`Daily cap of ${envCap()} attempts reached or would be exceeded (${used} used today, UTC)`});
  const allCategories=all.map(x=>x.category||'Singing Bowls');
  sending=true;
  const results=[];
  try{
   for(const lead of leads){
    const preview=composePreview(lead,subjectTemplate,bodyTemplate,{senderName:sender.senderName,businessName:sender.businessName,postalAddress:sender.postalAddress,gmail:gmailEmail});
    const id=crypto.randomUUID(),created=now();
    db.prepare('INSERT INTO outreach (id,lead_id,recipient,subject,body,created_at,day,status) VALUES (?,?,?,?,?,?,?,?)').run(id,lead.id,lead.email.toLowerCase(),preview.subject,preview.body,created,dayUTC(),'attempted');
    try{
     const leadFiles=resolveAttachmentsForProduct(validFiles,lead.category||'Singing Bowls',allCategories);
     const raw=encodeMime({to:lead.email,from:gmailEmail,displayName:sender.senderName,subject:preview.subject,body:preview.body,messageId:id,attachments:leadFiles});
     const sent=await gmail('messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({raw})});
     db.prepare('UPDATE outreach SET status=?,gmail_message_id=?,gmail_thread_id=? WHERE id=?').run('sent',sent.id||'',sent.threadId||'',id);
     results.push({leadId:lead.id,recipient:lead.email,status:'sent',threadId:sent.threadId||''});
    }catch(e){db.prepare('UPDATE outreach SET status=?,error=? WHERE id=?').run('failed',String(e.message).slice(0,300),id);results.push({leadId:lead.id,recipient:lead.email,status:'failed',error:e.message});}
    if(leads.length>1)await new Promise(resolve=>setTimeout(resolve,1100));
   }
   res.json({results,sent:results.filter(x=>x.status==='sent').length,failed:results.filter(x=>x.status==='failed').length,attemptsRemainingToday:Math.max(0,envCap()-db.prepare('SELECT COUNT(*) AS n FROM outreach WHERE day=?').get(dayUTC()).n)});
  }finally{sending=false;}
  }catch(e){sending=false;error(res,e)}
 });
 app.get('/api/outreach/history',(_,res)=>res.json({records:db.prepare('SELECT * FROM outreach ORDER BY created_at DESC LIMIT 1000').all(),gmail:emailStatus()}));
 app.get('/api/outreach/suppression',(_,res)=>res.json({records:db.prepare('SELECT * FROM suppression ORDER BY created_at DESC LIMIT 1000').all()}));
 app.post('/api/outreach/suppression',(req,res)=>{
  const email=String(req.body?.email||'').trim().toLowerCase();if(!validEmail(email))return res.status(400).json({error:'Valid email required'});
  const reason=String(req.body?.reason||'Opted out / do not contact').slice(0,150);
  db.prepare('INSERT INTO suppression(email,created_at,reason) VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET reason=excluded.reason').run(email,now(),reason);
  const rows=readRecords('lead').map(lead=>lead.email.toLowerCase()===email?{...lead,reviewed:false}:lead);saveRecords('lead',rows);
  res.json({ok:true,email});
 });
 app.post('/api/outreach/sync-replies',async(req,res)=>{
  try{
   if(!smtpEmail())return res.status(401).json({error:'Connect Gmail first'});
   const list=db.prepare("SELECT * FROM outreach WHERE status IN ('sent','replied') AND gmail_thread_id<>'' AND created_at>=? ORDER BY created_at DESC LIMIT 50").all(new Date(Date.now()-90*86400000).toISOString());
   const byThread=new Map();for(const item of list)if(!byThread.has(item.gmail_thread_id))byThread.set(item.gmail_thread_id,[]);
   for(const item of list)byThread.get(item.gmail_thread_id).push(item);
   let checked=0,matched=0,bounced=0,failures=0;
   const extractText=(part)=>{
    if(!part)return '';
    let out=(part.headers||[]).map(h=>`${h.name}: ${h.value}`).join('\n')+'\n';
    if(part.body?.data)out+=Buffer.from(part.body.data,'base64url').toString('utf8')+'\n';
    for(const sub of (part.parts||[]))out+=extractText(sub);
    return out;
   };
   const markBounced=(row,snippetText)=>{
    if(row.status==='failed')return;
    row.status='failed';
    bounced++;
    const reason=String(snippetText||'Delivery bounced (Address not found)').slice(0,240);
    db.prepare("UPDATE outreach SET status='failed',error=? WHERE id=?").run(reason,row.id);
    db.prepare('INSERT INTO suppression(email,created_at,reason) VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET reason=excluded.reason').run(row.recipient.toLowerCase(),now(),'Delivery bounced');
    const updatedLeads=readRecords('lead').map(l=>l.email.toLowerCase()===row.recipient.toLowerCase()?{...l,reviewed:false}:l);
    saveRecords('lead',updatedLeads);
   };
   const own=smtpEmail().toLowerCase();
   for(const [threadId,records] of byThread){
    try{
     const thread=await gmail('threads/'+encodeURIComponent(threadId)+'?format=full');checked++;
     for(const row of records){
      const reply=matchingReply(thread.messages||[],row.recipient,row.created_at,own);
      if(reply){
       const from=mailbox(reply.payload?.headers?.find(x=>x.name.toLowerCase()==='from')?.value||'');
       const replyDate=new Date(Number(reply.internalDate)).toISOString();
       db.prepare("UPDATE outreach SET status='replied',reply_at=?,reply_from=?,reply_snippet=? WHERE id=?").run(replyDate,from,String(reply.snippet||'').slice(0,240),row.id);matched++;
       continue;
      }
      const bounceInThread=(thread.messages||[]).filter(m=>{
       const rawFrom=m.payload?.headers?.find(x=>x.name.toLowerCase()==='from')?.value||'';
       const from=mailbox(rawFrom);
       const subj=String(m.payload?.headers?.find(x=>x.name.toLowerCase()==='subject')?.value||'').toLowerCase();
       const snip=String(m.snippet||'').toLowerCase();
       if(!from || from===own)return false;
       return /mailer-daemon|postmaster|delivery subsystem/i.test(rawFrom)
        || /delivery status notification|undeliverable|returned mail|failure notice/.test(subj)
        || /address not found|wasn't delivered|couldn't be delivered|550 5\.1\.1|does not exist/.test(snip);
      });
      if(bounceInThread.length){
       const bMsg=bounceInThread[bounceInThread.length-1];
       const subj=bMsg.payload?.headers?.find(x=>x.name.toLowerCase()==='subject')?.value||'';
       const reason=String(bMsg.snippet||subj||'Delivery bounced (Address not found)').slice(0,240);
       markBounced(row,reason);
      }
     }
    }catch(e){failures++;console.error('Thread sync error:',threadId,e.message);}
   }
   let searchErr='';
   try{
    const bounceSearch=await gmail('messages?q='+encodeURIComponent('mailer-daemon OR "Address not found" OR "Delivery Status Notification"')+'&maxResults=25');
    for(const item of (bounceSearch.messages||[])){
     const msg=await gmail('messages/'+encodeURIComponent(item.id)+'?format=full');
     const fullBlob=(String(msg.snippet||'')+'\n'+extractText(msg.payload)).toLowerCase();
     for(const row of list){
      if(row.status==='sent' && fullBlob.includes(row.recipient.toLowerCase())){
       markBounced(row,msg.snippet||'Address not found (Delivery Status Notification)');
      }
     }
    }
   }catch(e){searchErr=e.message;console.error('Bounce search error:',e.message);}
   res.json({checkedThreads:checked,newOrKnownReplies:matched,failedThreads:failures,note:`${bounced} bounced address(es) flagged.${searchErr?' Bounce search error: '+searchErr:''}`});
  }catch(e){error(res,e)}
 });
}
