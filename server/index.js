import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { discoverBuyers } from './discovery.js';
import { isBlockedEmail } from './lead-quality.js';
import { installOutreach } from './outreach.js';
import { createStore } from './store.js';
const app=express(); app.disable('x-powered-by'); app.use(express.json({limit:'12mb'}));
const port=Number(process.env.PORT||4100);
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:3000,http://localhost:3001,http://localhost:5173').split(',').map(x=>x.trim());
app.use(cors({origin:(requested,cb)=>{if(!requested||allowedOrigins.includes(requested))return cb(null,true);cb(new Error('Origin not allowed'));}}));
app.use((req,res,next)=>{if(req.method!=='GET'&&req.method!=='HEAD'&&req.method!=='OPTIONS'&&req.headers.origin&&!allowedOrigins.includes(req.headers.origin))return res.status(403).json({error:'Origin not permitted'});next()});
app.use('/api',(req,res,next)=>{res.setHeader('Cache-Control','no-store');next()});
const file=process.env.DB_PATH||path.resolve(import.meta.dirname,'tradepulse.sqlite');fs.mkdirSync(path.dirname(path.resolve(file)),{recursive:true});
const db=new DatabaseSync(file);db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS send_log (id TEXT PRIMARY KEY, recipient TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_send_day ON send_log(day);`);
const getSetting=k=>db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value||'';
const setSetting=(k,v)=>db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,v);
const normalizeEmail=v=>String(v||'').trim().toLowerCase();
const validEmail=e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)&&e.length<=254;
const isSample=lead=>(String(lead.id||'').startsWith('lead-') && !String(lead.id).startsWith('lead-real-')) || /sample|mock|demo|simulation/i.test(String(lead.notes||''));
const normalizeDomain=url=>{try{return new URL(/^https?:\/\//i.test(url)?url:'https://'+url).hostname.toLowerCase().replace(/^www\./,'')}catch{return ''}};
const {readRecords,saveRecords,upsertLeads,upsertResearch,siteCache}=createStore(db);
// Safe data migration: preserve all existing research records by merging valid ones into lead records
(() => {
  try {
    const researchRows = readRecords('research');
    if (researchRows.length > 0) {
      console.log(`[Migration] Safely migrating ${researchRows.length} existing research records into buyers...`);
      // Update classification for migration: convert Research tier to Potential if specialty/commercial fit, else keep transparent
      const migrated = researchRows.map(r => {
        const isNotFit = /\b(?:restaurant|food|cafe|dentist|security|school|pup|wine|leeches)\b/i.test(r.companyName + ' ' + (r.notes||''));
        const tier = isNotFit ? 'Not relevant' : (r.buyerTier === 'Strong match' ? 'Strong match' : 'Potential');
        return {
          ...r,
          buyerTier: tier,
          classificationReason: r.classificationReason || (isNotFit ? 'Filtered: unrelated commercial category' : 'Potential Buyer: specialty retail / commercial distributor fit')
        };
      });
      upsertLeads(migrated);
    }
  } catch (err) {
    console.error('[Migration] Non-fatal migration check:', err);
  }
})();
// Test hook only: lets integration tests inject fake providers; empty in normal operation.
export const testHooks={providers:{}};
const reply=(res,e)=>res.status(e.status||500).json({error:e.message||'Unexpected error'});
const providerStatus=()=>({
  overture:process.env.ENABLE_OVERTURE!=='false',
  geoapify:!!process.env.GEOAPIFY_API_KEY,
  overpass:process.env.ENABLE_OVERPASS==='true',
  tomtom:!!process.env.TOMTOM_API_KEY,
});
const limitSetting=(k,def,min=1,max=20000)=>Math.max(min,Math.min(max,Number.parseInt(process.env[k]||def,10)||def));
app.get('/api/health',(_,res)=>res.json({ok:true,service:'TradePulse API',discoveryProviders:providerStatus(),limits:{maxLeads:limitSetting('MAX_LEADS_PER_SCAN',1800,1,5000),websiteChecks:limitSetting('MAX_WEBSITES_PER_SCAN',900,1,2500),overtureRowsPerTile:limitSetting('OVERTURE_ROWS_PER_TILE',3000,100,8000),overtureGrid:limitSetting('OVERTURE_GRID',2,1,4)}}));
app.get('/api/leads',(_,res)=>res.json({leads:readRecords('lead')}));
app.get('/api/research',(_,res)=>res.json({leads:readRecords('research')}));
app.delete('/api/research/:id',(req,res)=>{try{const rows=readRecords('research');const left=rows.filter(x=>x.id!==req.params.id);if(rows.length===left.length)return res.status(404).json({error:'Research prospect not found'});saveRecords('research',left);res.json({ok:true,total:left.length});}catch(e){reply(res,e)}});
app.patch('/api/leads/:id', (req,res)=>{try{
  const rows=readRecords('lead'),index=rows.findIndex(x=>x.id===req.params.id);
  if(index<0)return res.status(404).json({error:'Lead not found'});
  const allowed=['reviewed','notes'];const patch={};for(const key of allowed)if(Object.hasOwn(req.body||{},key)){
    if(key==='reviewed'&&typeof req.body[key]!=='boolean')return res.status(400).json({error:'reviewed must be boolean'});
    if(key==='notes'&&(typeof req.body[key]!=='string'||req.body[key].length>4000))return res.status(400).json({error:'Invalid notes'});
    patch[key]=req.body[key];
  }
  rows[index]={...rows[index],...patch};saveRecords('lead',rows);res.json({lead:rows[index]});
}catch(e){reply(res,e)}});
app.delete('/api/leads/:id',(req,res)=>{try{const rows=readRecords('lead'),left=rows.filter(x=>x.id!==req.params.id);if(left.length===rows.length)return res.status(404).json({error:'Lead not found'});saveRecords('lead',left);res.json({ok:true,total:left.length})}catch(e){reply(res,e)}});
// Revalidate all saved buyer records with the latest classification rules
app.post('/api/leads/revalidate',async(req,res)=>{try{
  // 1. Create a dated backup before modifying any data
  const {assessWebsite,scoreBuyer,isBlockedEmail}=await import('./lead-quality.js');
  const stamp=Date.now();
  const backupFile=path.resolve(import.meta.dirname,`tradepulse-revalidate-backup-${stamp}.sqlite`);
  db.exec('PRAGMA wal_checkpoint(PASSIVE)');
  db.exec(`VACUUM INTO '${backupFile.replace(/'/g,"''")}'`);
  // 2. Reclassify every lead record
  const rows=readRecords('lead');
  let kept=0,removed=0,reclassified=0;
  const updated=rows.map(r=>{
    const catMatch=(r.notes||'').match(/Overture Maps;\s*([^;]+);/);
    const overtureCat=catMatch?catMatch[1].trim().replace(/_/g,' '):(r.kind||'').replace(/_/g,' ');
    const kind=r.kind||overtureCat;
    const score=scoreBuyer({companyName:r.companyName,kind},r.category||'Singing Bowls');
    const assessment=assessWebsite({
      product:r.category||'Singing Bowls',
      companyName:r.companyName||'',
      kind,
      listingScore:score,
      pages:[],
      siteText:r.evidenceExcerpt||'',
      siteUrl:r.website||''
    });
    if(assessment.tier==='Not relevant'){removed++;return null;}
    const changed=assessment.tier!==r.buyerTier||assessment.evidenceClass!==r.evidenceClass;
    if(changed)reclassified++;
    kept++;
    return {
      ...r,
      buyerTier:assessment.tier==='Research'?'Potential':assessment.tier,
      evidenceClass:assessment.evidenceClass,
      evidenceRank:assessment.evidenceRank,
      classificationReason:assessment.classificationReason,
      buyerEvidence:assessment.evidence||r.buyerEvidence,
      productSignal:assessment.productSignal,
    };
  }).filter(Boolean);
  saveRecords('lead',updated);
  res.json({ok:true,total:updated.length,kept,removed,reclassified,backup:backupFile});
}catch(e){reply(res,e)}});

app.post('/api/leads/clear',(req,res)=>{try{if(req.body?.confirmation!=='CLEAR_BUYERS')return res.status(400).json({error:'Confirmation required'});
  const backup='tradepulse-backup-'+Date.now()+'.sqlite';db.exec("PRAGMA wal_checkpoint(PASSIVE)");db.exec(`VACUUM INTO '${path.resolve(backup).replace(/'/g,"''")}'`);
  const buyers=db.prepare("DELETE FROM records WHERE kind='lead'").run().changes;const research=db.prepare("DELETE FROM records WHERE kind='research'").run().changes;siteCache.clear();res.json({ok:true,deleted:buyers,researchDeleted:research,backup:path.resolve(backup)});
}catch(e){reply(res,e)}});
let discoveryRunning=false;
let discoveryStatus={running:false,stage:'idle',stageDetail:'Ready to scan',updatedAt:new Date().toISOString(),listingsFetched:0,websitesChecked:0,websitesTotal:0};
app.get('/api/discovery/status',(_,res)=>res.json(discoveryStatus));
app.post('/api/discover',async(req,res)=>{
 if(discoveryRunning)return res.status(409).json({error:'Discovery scan already running. Check /api/discovery/status for progress.'});
 discoveryRunning=true;
 discoveryStatus={running:true,stage:'starting',stageDetail:'Starting discovery',updatedAt:new Date().toISOString(),listingsFetched:0,websitesChecked:0,websitesTotal:0};
 try{
  const data=await discoverBuyers(req.body||{}, {...testHooks.providers,cache:siteCache}, patch=>{discoveryStatus={...discoveryStatus,...patch,running:true,updatedAt:new Date().toISOString()};});
  discoveryStatus={...discoveryStatus,stage:'saving',stageDetail:'Saving qualified and research leads',updatedAt:new Date().toISOString()};
  const saved=upsertLeads(data.leads);
  const researchSaved=upsertResearch(data.research||[]);
  discoveryStatus={...discoveryStatus,running:false,stage:'complete',stageDetail:'Scan complete',saved,researchSaved,updatedAt:new Date().toISOString()};
  res.json({...data,saved,researchSaved});
 }catch(e){discoveryStatus={...discoveryStatus,running:false,stage:'error',stageDetail:String(e.message||e),updatedAt:new Date().toISOString()};reply(res,e)}
 finally{discoveryRunning=false;}
});

installOutreach(app,{db,getSetting,setSetting,readRecords,saveRecords,dbPath:file});
app.use((e,req,res,next)=>res.status(500).json({error:'Internal server error'}));
export {app};
if(process.env.TRADEPULSE_NO_LISTEN!=='1')app.listen(port,'127.0.0.1',()=>console.log(`TradePulse API on http://localhost:${port}`));
