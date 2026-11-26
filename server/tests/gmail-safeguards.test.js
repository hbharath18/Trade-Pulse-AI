import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {DatabaseSync} from 'node:sqlite';
import {installOutreach,tokenCipher,BATCH_EMAIL_CAP} from '../outreach.js';

const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json'}});
async function harness(leads){
 process.env.DAILY_EMAIL_CAP='500'; // an over-large value must still be clamped to 50
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tp-safe-')),dbPath=path.join(dir,'db.sqlite'),db=new DatabaseSync(dbPath);
 db.exec("CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
 const getSetting=k=>db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value||'';
 const setSetting=(k,v)=>db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,v);
 const readRecords=k=>db.prepare('SELECT data FROM records WHERE kind=?').all(k).map(x=>JSON.parse(x.data));
 const saveRecords=(kind,rows)=>{db.prepare('DELETE FROM records WHERE kind=?').run(kind);for(const r of rows)db.prepare('INSERT INTO records(kind,id,data) VALUES(?,?,?)').run(kind,r.id,JSON.stringify(r));};
 saveRecords('lead',leads);
 let sends=0;
 const fakeFetch=async(url)=>{if(url.endsWith('messages/send')){sends++;return json({id:'m'+sends,threadId:'t'+sends});}throw Error('Unexpected external request '+url);};
 const app=express();app.use(express.json());installOutreach(app,{db,getSetting,setSetting,readRecords,saveRecords,dbPath,fetchImpl:fakeFetch});
 const cipher=tokenCipher(dbPath);
 setSetting('gmail_email','agent@gmail.com');setSetting('gmail_refresh_enc',cipher.encrypt('r'));setSetting('gmail_access_enc',cipher.encrypt('a'));setSetting('gmail_expires_at',String(Date.now()+3600000));
 setSetting('outreach_sender_name','Real Sender');setSetting('outreach_business_name','Actual Supplier');setSetting('outreach_postal','15 Cedar Lane, City, Country 12345');
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const post=async(p,body)=>{const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 return {db,post,sends:()=>sends,get:async p=>(await fetch(base+p)).json(),close:async()=>{await new Promise(r=>server.close(r));db.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
const L=(i,over={})=>({id:'lead-real-'+i,companyName:'Shop '+i,city:'Denver',state:'CO',website:`https://shop${i}.com`,email:`info@shop${i}.com`,buyerTier:'Strong match',reviewed:true,category:'Singing Bowls',buyerEvidence:'x',...over});
const body=ids=>({leadIds:ids,subjectTemplate:'Hello {companyName}',bodyTemplate:'About {product}',approvalPhrase:`SEND ${ids.length}`});

test('safeguard: Research / Unverified / unreviewed / suppressed leads can never be sent to, and nothing is sent',async()=>{
 const h=await harness([L(1,{buyerTier:'Research'}),L(2,{buyerTier:'Unverified'}),L(3,{reviewed:false}),L(4),L(5,{email:''})]);
 try{
  for(const id of ['lead-real-1','lead-real-2','lead-real-3','lead-real-5'])assert.equal((await h.post('/api/outreach/send',body([id]))).status,422,id);
  assert.equal((await h.post('/api/outreach/suppression',{email:'info@shop4.com'})).status,200);
  const lead4=JSON.parse(h.db.prepare("SELECT data FROM records WHERE id='lead-real-4'").get().data);assert.equal(lead4.reviewed,false); // suppression also clears review
  assert.equal(h.sends(),0);
 }finally{await h.close();}
});
test('safeguard: approval phrase must match the batch size; batch limit is 10; duplicate ids rejected',async()=>{
 const leads=Array.from({length:12},(_,i)=>L(i+1));const h=await harness(leads);
 try{
  assert.equal((await h.post('/api/outreach/send',{...body(['lead-real-1']),approvalPhrase:'SEND 2'})).status,400);
  assert.equal((await h.post('/api/outreach/send',{...body(['lead-real-1']),approvalPhrase:''})).status,400);
  assert.equal(BATCH_EMAIL_CAP,10);assert.equal((await h.post('/api/outreach/send',body(leads.map(l=>l.id)))).status,400);
  assert.equal((await h.post('/api/outreach/send',body(['lead-real-1','lead-real-1']))).status,400);
  assert.equal(h.sends(),0);
 }finally{await h.close();}
});
test('safeguard: the 50-attempt daily cap is enforced (and cannot be raised by DAILY_EMAIL_CAP=500)',async()=>{
 const h=await harness([L(1),L(2)]);
 try{
  assert.equal((await h.get('/api/gmail/status')).dailyLimit,50);
  const day=new Date().toISOString().slice(0,10),ins=h.db.prepare("INSERT INTO outreach (id,lead_id,recipient,subject,body,created_at,day,status) VALUES (?,?,?,?,?,?,?,'sent')");
  for(let i=0;i<49;i++)ins.run('o'+i,'x','r'+i+'@z.com','s','b',new Date().toISOString(),day);
  assert.equal((await h.post('/api/outreach/send',body(['lead-real-1','lead-real-2']))).status,429); // 49 + 2 > 50
  assert.equal(h.sends(),0);
  const one=await h.post('/api/outreach/send',body(['lead-real-1']));assert.equal(one.status,200);assert.equal(one.data.attemptsRemainingToday,0);
  assert.equal((await h.post('/api/outreach/send',body(['lead-real-2']))).status,429);
  assert.equal(h.sends(),1);
 }finally{await h.close();}
});
