import React, {useCallback,useEffect,useMemo,useState} from 'react';
import {request} from './services/api';
import {Navbar} from './components/Navbar';
import {Sidebar,NavTab} from './components/Sidebar';
import {OverviewView} from './views/OverviewView';
import {DiscoveryView} from './views/DiscoveryView';
import {DataMasterView} from './views/DataMasterView';
import {OutreachView} from './views/OutreachView';
import {AuditHistoryView} from './views/AuditHistoryView';
import {SettingsView} from './views/SettingsView';
import {Lead,OutreachRecord,GmailStatus,ApiHealth,SuppressionRecord} from './types';

const emptyGmail:GmailStatus={configured:false,connected:false,email:'',dailyLimit:50,sentAttemptsToday:0,perBatchLimit:10,clientType:'web',replyTrackingScope:''};
export const App:React.FC=()=>{
 const [leads,setLeads]=useState<Lead[]>([]),[history,setHistory]=useState<OutreachRecord[]>([]),[suppressions,setSuppressions]=useState<SuppressionRecord[]>([]);
 const [gmail,setGmail]=useState<GmailStatus>(emptyGmail),[health,setHealth]=useState<ApiHealth|null>(null);
 const [busy,setBusy]=useState(true),[backendError,setBackendError]=useState('');
 const [activeTab,setActiveTab]=useState<NavTab>('overview'),[sidebarCollapsed,setSidebarCollapsed]=useState(false),[searchTerm,setSearchTerm]=useState('');
 const [composeLeadId,setComposeLeadId]=useState<string>('');
 const refresh=useCallback(async()=>{
  try {
   const [a,b,c,d,e]=await Promise.all([
    request<{leads:Lead[]}>('/api/leads'),
    request<{records:OutreachRecord[]}>('/api/outreach/history'),
    request<{records:SuppressionRecord[]}>('/api/outreach/suppression'),
    request<GmailStatus>('/api/gmail/status'),
    request<ApiHealth>('/api/health')
   ]);
   setLeads(a.leads);setHistory(b.records);setSuppressions(c.records);setGmail(d);setHealth(e);setBackendError('');
  }catch(e){setBackendError(e instanceof Error?e.message:'Backend unavailable')}finally{setBusy(false)}
 },[]);
 useEffect(()=>{void refresh()},[refresh]);
 const counts=useMemo(()=>({total:leads.length,validated:leads.filter(l=>l.reviewed).length,b2bCount:leads.filter(l=>l.buyerTier==='Strong match').length,sentCount:history.filter(h=>h.status==='sent'||h.status==='replied').length,dialerQueue:0,duplicates:suppressions.length}),[leads,history,suppressions]);
 const suppressed=useMemo(()=>suppressions.map(s=>s.email.toLowerCase()),[suppressions]);
 const navigateToCompose=(lead:Lead)=>{setComposeLeadId(lead.id);setActiveTab('outreach')};
 const tabTitles:Record<NavTab,string>={overview:'Overview',discovery:'Discovery',datamaster:'Buyers',outreach:'Outreach',audit:'Replies & History',settings:'Settings'};
 return <div className="flex h-screen w-screen overflow-hidden bg-ambient-canvas bg-[#0A0D12] text-[#E5E9F0]">
  <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} counts={counts} gmailConnected={gmail.connected}/>
  <div className="flex flex-1 flex-col min-w-0 overflow-hidden relative z-10">
   <Navbar searchTerm={searchTerm} setSearchTerm={setSearchTerm} onOpenDiscovery={()=>setActiveTab('discovery')} activeTabTitle={tabTitles[activeTab]} gmailConnected={gmail.connected}/>
   <main className="flex-1 overflow-y-auto px-6 sm:px-10 py-10">
    <div className="max-w-[1360px] mx-auto space-y-10">
     {backendError&&<div role="alert" className="rounded-xl border border-red-500/40 bg-red-950/40 text-red-200 p-4 text-sm">Backend: {backendError}. Start the API terminal with <code>npm run dev:api</code>. <button onClick={()=>void refresh()} className="underline ml-2">Retry</button></div>}
     {busy&&<p className="text-sm text-[#9AA4B2]">Loading workspace…</p>}
     {activeTab==='overview'&&<OverviewView leads={leads} history={history} gmail={gmail} onNavigate={setActiveTab} />}
     {activeTab==='discovery'&&<DiscoveryView health={health} onComplete={refresh}/>}
     {activeTab==='datamaster'&&<DataMasterView leads={leads} history={history} searchTerm={searchTerm} suppressed={suppressed} onChanged={refresh} onCompose={navigateToCompose}/>}
     {activeTab==='outreach'&&<OutreachView leads={leads} gmail={gmail} suppressed={suppressed} history={history} initialLeadId={composeLeadId} onChanged={refresh} onOpenSettings={()=>setActiveTab('settings')}/>}
     {activeTab==='audit'&&<AuditHistoryView history={history} leads={leads} suppressed={suppressions} onChanged={refresh}/>}
     {activeTab==='settings'&&<SettingsView health={health} gmail={gmail} onChanged={refresh}/>}
     <div className="h-16"/>
    </div>
   </main>
  </div>
 </div>;
};
