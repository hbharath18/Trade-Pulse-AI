import React from 'react';
import {Radar,Database,CheckCircle2,Send,ArrowUpRight,ShieldAlert,MailCheck} from 'lucide-react';
import {PageHero} from '../components/ui/PageHero';
import {Card} from '../components/ui/Card';
import {StatCard} from '../components/ui/StatCard';
import {Button} from '../components/ui/Button';
import {Lead,OutreachRecord,GmailStatus} from '../types';
import {NavTab} from '../components/Sidebar';
export const OverviewView:React.FC<{leads:Lead[];history:OutreachRecord[];gmail:GmailStatus;onNavigate:(tab:NavTab)=>void}>=({leads,history,gmail,onNavigate})=>{
 const strong=leads.filter(l=>l.buyerTier==='Strong match').length,reviewed=leads.filter(l=>l.reviewed).length;
 const sent=history.filter(h=>h.status==='sent'||h.status==='replied').length,replied=history.filter(h=>h.status==='replied').length;
 return <div className="space-y-10 animate-in fade-in duration-200">
  <PageHero eyebrow="Real buyer intelligence" eyebrowIcon={<Radar className="h-3.5 w-3.5"/>} title="Export Research Overview" gradientWord="Overview" description="Discover US businesses, verify product relevance and contacts, then review each outreach email before sending." actions={<Button onClick={()=>onNavigate('discovery')} icon={<Radar className="h-4 w-4"/>}>Start Discovery</Button>}/>
  <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
   <StatCard title="Saved Prospects" value={leads.length} icon={<Database className="h-5 w-5"/>} description="Unique company websites in your local database" />
   <StatCard title="Strong Product Match" value={strong} icon={<CheckCircle2 className="h-5 w-5"/>} iconVariant="slate" description="Website evidence suggests a relevant product fit"/>
   <StatCard title="Manually Reviewed" value={reviewed} icon={<MailCheck className="h-5 w-5"/>} description="Reviewed by you before any outreach"/>
   <StatCard title="Emails Accepted by Gmail" value={sent} icon={<Send className="h-5 w-5"/>} iconVariant="slate" description={`${replied} tracked replies · Gmail accepted is not inbox delivery`}/>
  </section>
  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
   <Card padding="md" className="lg:col-span-7"><div className="flex justify-between items-center mb-5"><h3 className="text-lg font-semibold">Recent Business Prospects</h3><button className="text-xs text-[#2FBF8F] flex gap-1 items-center" onClick={()=>onNavigate('datamaster')}>View buyers <ArrowUpRight className="h-4 w-4"/></button></div><div className="divide-y divide-white/[.07]">
    {leads.slice(0,6).map(l=><div key={l.id} className="py-3 flex justify-between items-center gap-3"><div className="min-w-0"><p className="text-sm font-medium truncate">{l.companyName}</p><p className="text-xs text-[#667085] truncate">{l.city}, {l.state} · {l.buyerTier||'Unverified'}</p></div><span className={'shrink-0 text-xs '+(l.reviewed?'text-[#2FBF8F]':'text-[#9AA4B2]')}>{l.reviewed?'Reviewed':'Needs review'}</span></div>)}
    {!leads.length&&<p className="text-sm text-[#9AA4B2] py-5">No saved prospects yet. Start a real API discovery scan.</p>}
   </div></Card>
   <Card padding="md" className="lg:col-span-5"><h3 className="text-lg font-semibold mb-5">Readiness & Next Steps</h3><div className="space-y-4 text-sm"><div className="rounded-xl bg-[#161C25] p-4 border border-white/[.06]"><p className="font-semibold">Gmail connection</p><p className="text-[#9AA4B2] text-xs mt-1">{gmail.connected?`Connected: ${gmail.email}`:'Not connected. Add Google OAuth credentials and connect in Settings.'}</p><button onClick={()=>onNavigate('settings')} className="text-[#2FBF8F] text-xs mt-2 underline">Open Settings</button></div><div className="rounded-xl bg-[#161C25] p-4 border border-white/[.06]"><p className="font-semibold">Daily sending safeguards</p><p className="text-[#9AA4B2] text-xs mt-1">{gmail.sentAttemptsToday} / {gmail.dailyLimit} attempts today (UTC); 10 per approved batch maximum.</p></div><div className="flex items-start gap-2 text-[#C9A66B] text-xs"><ShieldAlert className="h-4 w-4 shrink-0"/><p>Public emails and product relevance require review. No auto-sending, fabricated contacts or promised conversions.</p></div></div></Card>
  </div>
 </div>;
};
