import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import {encodeMime,merge,defaultBody,tokenCipher,matchingReply,installOutreach} from '../outreach.js';

const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json'}});
test('template merger, RFC-compatible encoded MIME, encryption at rest',()=>{
 const l={companyName:'Quartz & Co',city:'Houston',state:'Texas',category:'Singing Bowls',buyerEvidence:'listed sound healing products',website:'https://example.net'};
 assert.match(merge(defaultBody,l),/Quartz & Co/);
 const raw=encodeMime({to:'buyer@quartz.co',from:'agent@gmail.com',displayName:'A Real Name',subject:'Singing bowls',body:'Hello\nThanks',messageId:crypto.randomUUID()});
 const decoded=Buffer.from(raw,'base64url').toString('utf8');assert.match(decoded,/To: buyer@quartz.co/);assert.match(decoded,/Reply-To: agent@gmail.com/);assert.match(decoded,/Content-Type: text\/plain; charset=UTF-8/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tp-cipher-'));try{const cipher=tokenCipher(path.join(dir,'db.sqlite'));assert.equal(cipher.decrypt(cipher.encrypt('secret-token')),'secret-token');assert.ok(fs.existsSync(path.join(dir,'.tradepulse-token-key')));}finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('reply matching only counts exact same sender within inbox thread after send time',()=>{
 const from=(email,date,labels)=>({internalDate:String(Date.parse(date)),labelIds:labels,payload:{headers:[{name:'From',value:`Name <${email}>`}]}});
 const messages=[from('someoneelse@example.com','2026-11-22T10:00:00Z',['INBOX']),from('buyer@quartz.co','2026-11-19T10:00:00Z',['INBOX']),from('buyer@quartz.co','2026-11-22T11:00:00Z',['SENT']),from('buyer@quartz.co','2026-11-22T09:00:00Z',['INBOX'])];
 assert.equal(matchingReply(messages,'buyer@quartz.co','2026-11-21T10:00:00Z','agent@gmail.com'),messages[3]);
 assert.equal(matchingReply(messages,'buyer@quartz.co','2026-11-23T10:00:00Z','agent@gmail.com'),null);
});
test('Gmail OAuth, human review, approval, safe sending, duplicate protection, reply sync and suppression end-to-end with mocked Google',async()=>{
 process.env.GOOGLE_CLIENT_ID='testing.apps.googleusercontent.com';process.env.GOOGLE_CLIENT_SECRET='not-a-real-secret';process.env.GOOGLE_REDIRECT_URI='http://localhost:4100/api/gmail/callback';process.env.DAILY_EMAIL_CAP='50';
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tp-outreach-'));const dbPath=path.join(dir,'db.sqlite');const db=new DatabaseSync(dbPath);
 db.exec("CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL, PRIMARY KEY(kind,id));CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
 const getSetting=k=>db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value||'';
 const setSetting=(k,v)=>db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,v);
 const readRecords=k=>db.prepare('SELECT data FROM records WHERE kind=?').all(k).map(x=>JSON.parse(x.data));
 const saveRecords=(kind,rows)=>{db.prepare('DELETE FROM records WHERE kind=?').run(kind);for(const r of rows)db.prepare('INSERT INTO records(kind,id,data) VALUES(?,?,?)').run(kind,r.id,JSON.stringify(r));};
 const lead={id:'lead-real-a',companyName:'Quartz Shop',city:'Houston',state:'Texas',website:'https://quartz-shop.example.org',email:'buyer@quartz.co',buyerTier:'Strong match',reviewed:false,category:'Singing Bowls',buyerEvidence:'singing bowls on official site'};
 saveRecords('lead',[lead]);
 let sends=0;let lastMime='';let threadGets=0;
 const fakeFetch=async(url,options)=>{
  if(url.includes('oauth2.googleapis.com/token'))return json({access_token:'fake-access',refresh_token:'fake-refresh',expires_in:3600});
  if(url.endsWith('profile'))return json({emailAddress:'agent@gmail.com'});
  if(url.endsWith('messages/send')){sends++;lastMime=Buffer.from(JSON.parse(options.body).raw,'base64url').toString('utf8');return json({id:'message-1',threadId:'thread-1'});}
  if(url.includes('threads/thread-1')){threadGets++;return json({messages:[{id:'message-reply',labelIds:['INBOX'],internalDate:String(Date.now()+120000),snippet:'Thanks, please send details',payload:{headers:[{name:'From',value:'Buyer <buyer@quartz.co>'}]}}]});}
  if(url.includes('oauth2.googleapis.com/revoke'))return json({});
  throw Error('Unexpected external request '+url);
 };
 const app=express();app.use(express.json());installOutreach(app,{db,getSetting,setSetting,readRecords,saveRecords,dbPath,fetchImpl:fakeFetch});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const api=async(p,body)=>{const res=await fetch(base+p,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});let data;if(res.headers.get('content-type')?.includes('json'))data=await res.json();else data=await res.text();return {status:res.status,data,location:res.headers.get('location')}};
 try{
  assert.equal((await api('/api/outreach/send',{leadIds:[lead.id],subjectTemplate:'Hi',bodyTemplate:'Hello',approvalPhrase:'SEND 1'})).status,401);
  const init=await api('/api/gmail/connect');assert.equal(init.status,302);const url=new URL(init.location);assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  const oauth=await api('/api/gmail/callback?state='+encodeURIComponent(url.searchParams.get('state'))+'&code=test');assert.equal(oauth.status,200);
  const status=await api('/api/gmail/status');assert.equal(status.data.connected,true);assert.equal(status.data.email,'agent@gmail.com');
  assert.equal((await api('/api/outreach/send',{leadIds:[lead.id],subjectTemplate:'Hi',bodyTemplate:'Hello',approvalPhrase:'SEND 1'})).status,422); // Missing postal address.
  const settingsResponse=await fetch(base+'/api/outreach/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({senderName:'Real Sender',businessName:'Actual Supplier',postalAddress:'15 Cedar Lane, City, Country 12345'})});assert.equal(settingsResponse.status,200);
  assert.equal((await api('/api/outreach/send',{leadIds:[lead.id],subjectTemplate:'Hello',bodyTemplate:'Message',approvalPhrase:'SEND 1'})).status,422); // Not reviewed.
  saveRecords('lead',[{...lead,reviewed:true}]);
  assert.equal((await api('/api/outreach/send',{leadIds:[lead.id],subjectTemplate:'Hello',bodyTemplate:'Message',approvalPhrase:'CONFIRM'})).status,400);
  const send=await api('/api/outreach/send',{leadIds:[lead.id],subjectTemplate:'Hello {companyName}',bodyTemplate:'Can we discuss {product}?',approvalPhrase:'SEND 1'});
  assert.equal(send.status,200);assert.equal(send.data.sent,1);assert.equal(sends,1);assert.match(lastMime,/actual/i);assert.match(lastMime,/UNSUBSCRIBE/i);assert.match(Buffer.from(lastMime.match(/Subject: =\?UTF-8\?B\?([^?]+)/)[1],'base64').toString('utf8'),/Quartz Shop/);
  const second=await api('/api/outreach/send',{leadIds:[lead.id],subjectTemplate:'Hello',bodyTemplate:'Message',approvalPhrase:'SEND 1'});assert.equal(second.status,422);assert.equal(sends,1);
  const synced=await api('/api/outreach/sync-replies',{});assert.equal(synced.status,200);assert.equal(synced.data.newOrKnownReplies,1);assert.equal(threadGets,1);
  const logs=await api('/api/outreach/history');assert.equal(logs.data.records[0].status,'replied');assert.equal(logs.data.records[0].reply_from,'buyer@quartz.co');
  const sup=await api('/api/outreach/suppression',{email:'buyer@quartz.co'});assert.equal(sup.status,200);assert.equal(readRecords('lead')[0].reviewed,false);
  const dis=await api('/api/gmail/disconnect',{});assert.equal(dis.status,200);assert.equal((await api('/api/gmail/status')).data.connected,false);
 }finally{await new Promise(r=>server.close(r));db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
