import React,{useMemo,useState} from 'react';
import {createPortal} from 'react-dom';
import {Database,Download,ExternalLink,Mail,Trash2,ShieldCheck,CheckCircle2,AlertTriangle,X,Search,RefreshCw} from 'lucide-react';
import {PageHero} from '../components/ui/PageHero';
import {Card} from '../components/ui/Card';
import {Button} from '../components/ui/Button';
import {request,jsonBody} from '../services/api';
import {Lead,OutreachRecord} from '../types';
import {buildVerifiedCsv} from '../services/csv';

const emailOk=(l:Lead)=>Boolean(l.email)&&['Strong match','Potential'].includes(l.buyerTier||'')&&l.reviewed;

export function downloadVerifiedCSV(leads:Lead[]){
 const csv=buildVerifiedCsv(leads);
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),href=URL.createObjectURL(blob);
 const a=document.createElement('a');
 a.href=href;
 a.download='tradepulse_verified_buyers_'+new Date().toISOString().slice(0,10)+'.csv';
 document.body.appendChild(a);
 a.click();
 a.remove();
 setTimeout(()=>URL.revokeObjectURL(href),5000);
}

export const DataMasterView:React.FC<{leads:Lead[];history?:OutreachRecord[];searchTerm:string;suppressed:string[];onChanged:()=>Promise<void>|void;onCompose:(lead:Lead)=>void}>=({leads,history=[],searchTerm,suppressed,onChanged,onCompose})=>{
 const [tier,setTier]=useState('all');
 const [productFilter,setProductFilter]=useState('all');
 const [workflowFilter,setWorkflowFilter]=useState<'unreviewed'|'reviewed-unsent'|'mailed'|'all'>('unreviewed');
 const [contactFilter,setContactFilter]=useState<'all'|'with-contact'|'missing-contact'>('all');
 const [selected,setSelected]=useState<Lead|null>(null);
 const [selectedIds,setSelectedIds]=useState<string[]>([]);
 const [bulkConfirmOpen,setBulkConfirmOpen]=useState(false);
 const [busy,setBusy]=useState(false);
 const [revalidateBusy,setRevalidateBusy]=useState(false);
 const [revalidateResult,setRevalidateResult]=useState<string>('');
 const [error,setError]=useState('');
 // Custom review-confirmation modal state
 const [reviewConfirmLead,setReviewConfirmLead]=useState<Lead|null>(null);

 // Only High Relevance and Potential Buyers are presented in the main directory
 const buyers = useMemo(
  () => leads.filter(l =>
    ['Strong match', 'Potential'].includes(l.buyerTier || '')
  ),
  [leads]
);

 const productCategories = useMemo(
  () => Array.from(new Set(buyers.map(l => (l.category || 'Singing Bowls').trim()).filter(Boolean))).sort(),
  [buyers]
 );

 const outreachByEmail=useMemo(()=>{
  const map=new Map<string,OutreachRecord>();
  for(const r of history){
   const key=String(r.recipient||'').toLowerCase();
   if(!key)continue;
   const prev=map.get(key);
   if(!prev||r.created_at>prev.created_at)map.set(key,r);
  }
  return map;
 },[history]);

 const workflowCounts=useMemo(()=>{
  let unreviewed=0,reviewedUnsent=0,mailed=0;
  for(const l of buyers){
   const rec=l.email?outreachByEmail.get(l.email.toLowerCase()):undefined;
   const isMailed=Boolean(rec && ['sent','replied'].includes(rec.status));
   if(isMailed)mailed++;
   else if(l.reviewed)reviewedUnsent++;
   else unreviewed++;
  }
  return {unreviewed,reviewedUnsent,mailed};
 },[buyers,outreachByEmail]);

 const filtered=useMemo(()=>buyers.filter(l=>{
  const matchesTier = tier==='all' || (tier==='Strong match' ? l.buyerTier==='Strong match' : l.buyerTier==='Potential');
  const leadCategory = (l.category || 'Singing Bowls').trim();
  const matchesProduct = productFilter==='all' || leadCategory===productFilter;
  const rec=l.email?outreachByEmail.get(l.email.toLowerCase()):undefined;
  const isMailed=Boolean(rec && ['sent','replied'].includes(rec.status));
  const matchesWorkflow =
   workflowFilter==='all' ? true :
   workflowFilter==='mailed' ? isMailed :
   workflowFilter==='reviewed-unsent' ? (l.reviewed && !isMailed) :
   (!l.reviewed && !isMailed);
  const hasContact = Boolean(l.email && l.email.trim());
  const matchesContact = contactFilter==='all' || (contactFilter==='with-contact' ? hasContact : !hasContact);
  const searchLower = searchTerm.toLowerCase();
  const matchesSearch = !searchTerm || `${l.companyName} ${l.city} ${l.state} ${l.email} ${l.website} ${leadCategory} ${l.classificationReason||''}`.toLowerCase().includes(searchLower);
  return matchesTier && matchesProduct && matchesWorkflow && matchesContact && matchesSearch;
 }),[buyers,tier,productFilter,workflowFilter,outreachByEmail,contactFilter,searchTerm]);

 const strongCount = useMemo(()=>buyers.filter(l=>l.buyerTier==='Strong match').length,[buyers]);
 const potentialCount = useMemo(()=>buyers.filter(l=>l.buyerTier==='Potential').length,[buyers]);
 const withContactCount = useMemo(()=>buyers.filter(l=>Boolean(l.email && l.email.trim())).length,[buyers]);
 const verified = useMemo(()=>buyers.filter(l=>emailOk(l)&&!suppressed.includes(l.email.toLowerCase())), [buyers,suppressed]);
 const researchExport = useMemo(
  () => buyers.filter(l =>
    Boolean(l.email?.trim()) &&
    !suppressed.includes(l.email.trim().toLowerCase())
  ),
  [buyers, suppressed]
);
 const action=async(fn:()=>Promise<any>)=>{
  setBusy(true);
  setError('');
  try{await fn();await onChanged();setSelected(null)}
  catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false)}
 };

 // Open custom confirmation modal instead of window.confirm
 const review=(l:Lead)=>{
  if(l.reviewed){
   // Undo review: no confirmation needed, just toggle back
   void action(()=>request(`/api/leads/${encodeURIComponent(l.id)}`,{method:'PATCH',body:JSON.stringify({reviewed:false})}));
  } else {
   setSelected(null);
   setReviewConfirmLead(l);
  }
 };

 const confirmReview=(l:Lead)=>{
  setReviewConfirmLead(null);
  void action(()=>request(`/api/leads/${encodeURIComponent(l.id)}`,{method:'PATCH',body:JSON.stringify({reviewed:true})}));
 };

 const approvableFiltered=useMemo(
  ()=>filtered.filter(l=>Boolean(l.email?.trim())&&!l.reviewed&&!suppressed.includes(l.email.toLowerCase())),
  [filtered,suppressed]
 );

 const toggleRowSelect=(id:string)=>{
  setSelectedIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
 };

 const toggleSelectAllVisible=()=>{
  const visibleIds=approvableFiltered.map(l=>l.id);
  const allSelected=visibleIds.length>0&&visibleIds.every(id=>selectedIds.includes(id));
  setSelectedIds(allSelected?selectedIds.filter(id=>!visibleIds.includes(id)):Array.from(new Set([...selectedIds,...visibleIds])));
 };

 const confirmBulkReview=()=>{
  const targets=selectedIds.filter(id=>buyers.some(b=>b.id===id&&!b.reviewed));
  setBulkConfirmOpen(false);
  if(!targets.length)return;
  void action(async()=>{
   for(const id of targets){
    await request(`/api/leads/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({reviewed:true})});
   }
   setSelectedIds([]);
  });
 };

 const remove=(l:Lead)=>{
  if(window.confirm(`Delete ${l.companyName} from saved buyers?`))void action(()=>request(`/api/leads/${encodeURIComponent(l.id)}`,{method:'DELETE'}));
 };

 const suppress=(l:Lead)=>{
  if(window.confirm(`Add ${l.email} to the permanent do-not-contact list?`))void action(()=>request('/api/outreach/suppression',jsonBody({email:l.email,reason:'Manual exclusion from buyer records'})));
 };

 const clear=()=>{
  if(window.prompt('This clears ALL saved buyer rows but keeps your email history and opt-outs. Type CLEAR_BUYERS to confirm:')!=='CLEAR_BUYERS')return;
  void action(()=>request('/api/leads/clear',jsonBody({confirmation:'CLEAR_BUYERS'})));
 };

 const revalidate=async()=>{
  setRevalidateBusy(true);
  setRevalidateResult('');
  setError('');
  try{
   const res=await request('/api/leads/revalidate',{method:'POST'}) as any;
   setRevalidateResult(`Revalidation complete — ${res.kept} buyers kept, ${res.removed} removed, ${res.reclassified} reclassified. Backup saved.`);
   await onChanged();
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setRevalidateBusy(false)}
 };

 return <div className="space-y-10 animate-in fade-in duration-200">
  <PageHero eyebrow="Verified Buyer Directory" eyebrowIcon={<Database className="h-3.5 w-3.5"/>} title="US Buyer Directory" gradientWord="Buyer" description="Discover genuine US businesses with High Relevance or Potential Buyer classification for Indian singing bowls and handicrafts." actions={
   <div className="flex gap-3 flex-wrap items-center">
    <Button icon={<RefreshCw className="h-4 w-4"/>} variant="secondary" onClick={revalidate} disabled={revalidateBusy||busy||!buyers.length}>
     {revalidateBusy ? 'Revalidating…' : 'Revalidate Saved Buyers'}
    </Button>
    <>
  <Button
    icon={<Download className="h-4 w-4"/>}
    variant="secondary"
    onClick={() => downloadVerifiedCSV(researchExport)}
    disabled={!researchExport.length}
  >
    Export Research CSV ({researchExport.length})
  </Button>

  <Button
    icon={<Download className="h-4 w-4"/>}
    onClick={() => downloadVerifiedCSV(verified)}
    disabled={!verified.length}
  >
    Export Reviewed CSV ({verified.length})
  </Button>
</>
   </div>
  }/>

  {revalidateResult&&<div role="status" className="p-4 rounded-xl border border-[#2FBF8F]/40 bg-[#2FBF8F]/10 text-[#2FBF8F] text-sm">{revalidateResult}</div>}

  <div className="grid grid-cols-1 sm:grid-cols-4 gap-5">
   {[['High Relevance',strongCount],['Potential Buyers',potentialCount],['With Public Contact',withContactCount],['Reviewed & Exportable',verified.length]].map(([k,v])=>(
    <Card key={String(k)} padding="md">
     <p className="text-[11px] uppercase tracking-eyebrow text-[#9AA4B2] font-mono">{k}</p>
     <p className="text-3xl font-bold mt-3 font-mono text-[#E5E9F0]">{v}</p>
    </Card>
   ))}
  </div>

  {error&&<div role="alert" className="p-4 rounded-xl border border-red-500/40 text-red-200">{error}</div>}

  <Card padding="md">
   <div className="flex items-center justify-between gap-4 flex-wrap pb-5 border-b border-white/10">
    <div className="flex flex-wrap gap-3 items-center">
     <Search className="h-4 w-4 text-[#2FBF8F]"/>
     <select value={tier} onChange={e=>setTier(e.target.value)} className="rounded-control bg-[#161C25] border border-white/10 px-3 h-10 text-sm text-[#E5E9F0]">
      <option value="all">All Relevance Tiers ({buyers.length})</option>
      <option value="Strong match">High Relevance ({strongCount})</option>
      <option value="Potential">Potential Buyers ({potentialCount})</option>
     </select>
     <select value={productFilter} onChange={e=>setProductFilter(e.target.value)} className="rounded-control bg-[#161C25] border border-white/10 px-3 h-10 text-sm text-[#E5E9F0]">
      <option value="all">All Products ({productCategories.length})</option>
      {productCategories.map(cat=>(
       <option key={cat} value={cat}>{cat}</option>
      ))}
     </select>
     <select value={contactFilter} onChange={e=>setContactFilter(e.target.value as any)} className="rounded-control bg-[#161C25] border border-white/10 px-3 h-10 text-sm text-[#E5E9F0]">
      <option value="all">All Contacts</option>
      <option value="with-contact">Has Email / Phone</option>
      <option value="missing-contact">Missing Contact Label</option>
     </select>
     <select value={workflowFilter} onChange={e=>setWorkflowFilter(e.target.value as any)} className="rounded-control bg-[#161C25] border border-white/10 px-3 h-10 text-sm text-[#E5E9F0]">
      <option value="unreviewed">Needs Review ({workflowCounts.unreviewed})</option>
      <option value="reviewed-unsent">Reviewed · Ready to Mail ({workflowCounts.reviewedUnsent})</option>
      <option value="mailed">Mail Sent / Replied ({workflowCounts.mailed})</option>
      <option value="all">All Buyers ({buyers.length})</option>
     </select>
    </div>
    <div className="flex items-center gap-2 flex-wrap">
     {selectedIds.length>0&&(
      <Button size="sm" icon={<ShieldCheck className="h-4 w-4"/>} onClick={()=>setBulkConfirmOpen(true)} disabled={busy}>
       Approve Selected ({selectedIds.length})
      </Button>
     )}
     <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4"/>} onClick={clear} disabled={busy||!buyers.length}>Clear saved records</Button>
    </div>
   </div>

   <div className="overflow-x-auto">
    <table className="w-full text-sm text-left">
     <thead>
      <tr className="text-[#667085] text-[11px] uppercase tracking-wide border-b border-white/10">
       <th className="py-4 pr-3 w-8">
        <input
         type="checkbox"
         aria-label="Select all unreviewed buyers on page"
         checked={approvableFiltered.length>0&&approvableFiltered.every(l=>selectedIds.includes(l.id))}
         onChange={toggleSelectAllVisible}
         disabled={!approvableFiltered.length}
         className="accent-[#2FBF8F] cursor-pointer"
        />
       </th>
       <th className="py-4 pr-4 min-w-[160px]">Company</th>
       <th className="py-4 pr-4 whitespace-nowrap">Location</th>
       <th className="py-4 pr-4 whitespace-nowrap min-w-[130px]">Relevance Tier</th>
       <th className="py-4 pr-4 min-w-[200px]">Reason for Qualification</th>
       <th className="py-4 pr-4 min-w-[160px]">Contact</th>
       <th className="py-4 whitespace-nowrap">Actions</th>
      </tr>
     </thead>
     <tbody className="divide-y divide-white/[.07]">
      {filtered.map(l=>{
       const hasEmail = Boolean(l.email && l.email.trim());
       const isHighRelevance = l.buyerTier==='Strong match';
       const canSelectForReview=hasEmail&&!l.reviewed&&!suppressed.includes(l.email.toLowerCase());
       return (
        <tr key={l.id} className={'hover:bg-[#161C25]/55 align-top '+(selectedIds.includes(l.id)?'bg-[#2FBF8F]/[0.04]':'')}>
         <td className="py-4 pr-3">
          <input
           type="checkbox"
           aria-label={`Select ${l.companyName}`}
           checked={selectedIds.includes(l.id)}
           onChange={()=>toggleRowSelect(l.id)}
           disabled={!canSelectForReview}
           className="accent-[#2FBF8F] cursor-pointer disabled:opacity-25"
          />
         </td>
         <td className="py-4 pr-4">
          <div className="font-semibold text-[#E5E9F0] max-w-[220px] truncate" title={l.companyName}>{l.companyName}</div>
          <a href={l.website} target="_blank" rel="noreferrer" className="text-xs text-[#2FBF8F] hover:underline flex items-center gap-1 mt-1 max-w-[220px] truncate">
           {l.website} <ExternalLink className="h-3 w-3 inline shrink-0"/>
          </a>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
           <span className="inline-block text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[#9AA4B2]">
            {l.category || 'Singing Bowls'}
           </span>
           {(()=>{
            const rec=l.email?outreachByEmail.get(l.email.toLowerCase()):undefined;
            if(rec?.status==='replied')return <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#2FBF8F]/15 text-[#2FBF8F]">Replied</span>;
            if(rec?.status==='sent')return <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#7C8DB5]/20 text-[#9EB0D6]">Mail Sent</span>;
            if(rec?.status==='failed')return <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-red-500/15 text-red-300">Bounced</span>;
            if(l.reviewed)return <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#2FBF8F]/10 text-[#2FBF8F]">Reviewed</span>;
            return <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#C9A66B]/15 text-[#C9A66B]">Pending Review</span>;
           })()}
          </div>
         </td>
         <td className="py-4 pr-4 text-xs text-[#9AA4B2] whitespace-nowrap">{l.city}, {l.state}</td>
         <td className="py-4 pr-4">
          <span className={'whitespace-nowrap inline-flex items-center shrink-0 text-xs px-2.5 py-1 rounded-full font-medium border '+(isHighRelevance ? 'bg-[#2FBF8F]/15 text-[#2FBF8F] border-[#2FBF8F]/30' : 'text-[#C9A66B] bg-[#C9A66B]/15 border-[#C9A66B]/30')}>
           {isHighRelevance ? 'High Relevance' : 'Potential Buyer'}
          </span>
          {l.reviewed && (
           <p className="flex text-[#2FBF8F] items-center gap-1 text-[11px] mt-2 font-medium whitespace-nowrap">
            <CheckCircle2 className="h-3 w-3"/>Reviewed
           </p>
          )}
         </td>
         <td className="py-4 pr-4 max-w-[260px]">
          <p className="text-xs text-[#E5E9F0] line-clamp-2 leading-relaxed">{l.classificationReason || l.buyerEvidence || 'Specialty retailer / commercial fit'}</p>
          {l.evidenceUrl && (
           <a href={l.evidenceUrl} target="_blank" rel="noreferrer" className="text-[11px] text-[#2FBF8F] hover:underline inline-flex items-center gap-1 mt-1">
            Evidence Page <ExternalLink className="h-2.5 w-2.5"/>
           </a>
          )}
         </td>
         <td className="py-4 pr-4">
          {hasEmail ? (
           <>
            <p className="max-w-[180px] truncate text-xs text-[#E5E9F0] font-mono">{l.email}</p>
            {l.phone && <p className="text-[11px] text-[#9AA4B2] mt-0.5">{l.phone}</p>}
            <p className="text-[11px] mt-1 text-[#2FBF8F]">Public contact listed</p>
           </>
          ) : (
           <div>
            {l.phone && <p className="text-xs text-[#E5E9F0]">{l.phone}</p>}
            <span className="inline-block text-[11px] px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[#9AA4B2] mt-1 whitespace-nowrap">
             Missing Contact
            </span>
           </div>
          )}
         </td>
         <td className="py-4 whitespace-nowrap">
          <button className="text-[#2FBF8F] text-xs underline mr-3" onClick={()=>setSelected(l)}>Inspect</button>
          <button className="text-xs text-[#9AA4B2] hover:text-[#E5E9F0] disabled:opacity-30 mr-2" disabled={!emailOk(l)||suppressed.includes(l.email.toLowerCase())} onClick={()=>onCompose(l)}>Compose</button>
          <button className="text-xs text-red-400/80 hover:text-red-300" onClick={()=>remove(l)}>Delete</button>
         </td>
        </tr>
       );
      })}
     </tbody>
    </table>
    {!filtered.length && (
     <p className="p-8 text-center text-sm text-[#667085]">No buyers match your filters. Run a discovery scan or adjust filters above.</p>
    )}
   </div>
   <p className="text-xs mt-5 text-[#9AA4B2]">Standard nine-column export includes only reviewed buyers with genuine contact information. Missing Contact leads remain visible in the directory for manual research but are excluded from contact-ready exports.</p>
  </Card>

  {/* Bulk review confirmation modal */}
  {bulkConfirmOpen && createPortal(
   <div role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setBulkConfirmOpen(false)}} className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
    <section role="dialog" aria-modal="true" aria-label="Confirm bulk review" className="w-full max-w-md rounded-panel border border-white/15 bg-[#161C25] p-6 shadow-2xl">
     <div className="flex justify-between items-start gap-3 mb-4">
      <div>
       <p className="text-xs text-[#2FBF8F] uppercase tracking-wide font-mono mb-1">Batch Manual Review</p>
       <h3 className="text-lg font-semibold text-[#E5E9F0]">Approve {selectedIds.length} Selected Buyer{selectedIds.length>1?'s':''}?</h3>
      </div>
      <button aria-label="Cancel" onClick={()=>setBulkConfirmOpen(false)} className="text-[#9AA4B2] hover:text-[#E5E9F0] shrink-0 mt-1"><X className="h-5 w-5"/></button>
     </div>
     <p className="text-xs text-[#9AA4B2] mb-5 leading-relaxed">
      Confirm that you have checked the websites, product relevance, and public business emails for all <strong className="text-[#E5E9F0]">{selectedIds.length}</strong> selected buyers and want to mark them ready for outreach and CSV export.
     </p>
     <div className="flex gap-3 justify-end">
      <button className="text-sm px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-[#9AA4B2] hover:text-[#E5E9F0] hover:bg-white/10" onClick={()=>setBulkConfirmOpen(false)}>Cancel</button>
      <button className="text-sm px-4 py-2 rounded-lg bg-[#2FBF8F]/15 border border-[#2FBF8F]/30 text-[#2FBF8F] hover:bg-[#2FBF8F]/25 font-medium flex items-center gap-2" onClick={confirmBulkReview}>
       <ShieldCheck className="h-4 w-4"/>Approve All ({selectedIds.length})
      </button>
     </div>
    </section>
   </div>,
   document.body
  )}

  {/* Custom review confirmation modal */}
  {reviewConfirmLead && createPortal(
   <div role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setReviewConfirmLead(null)}} className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
    <section role="dialog" aria-modal="true" aria-label="Confirm review" className="w-full max-w-md rounded-panel border border-white/15 bg-[#161C25] p-6 shadow-2xl">
     <div className="flex justify-between items-start gap-3 mb-4">
      <div>
       <p className="text-xs text-[#2FBF8F] uppercase tracking-wide font-mono mb-1">Confirm Manual Review</p>
       <h3 className="text-lg font-semibold text-[#E5E9F0] break-words">{reviewConfirmLead.companyName}</h3>
      </div>
      <button aria-label="Cancel" onClick={()=>setReviewConfirmLead(null)} className="text-[#9AA4B2] hover:text-[#E5E9F0] shrink-0 mt-1"><X className="h-5 w-5"/></button>
     </div>
     <div className="space-y-2 mb-5">
      <p className="text-xs text-[#C9A66B] flex gap-2 items-start"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5"/>Before confirming, verify the following independently:</p>
      <ul className="text-xs text-[#9AA4B2] space-y-1.5 ml-6 list-disc">
       <li>The <strong className="text-[#E5E9F0]">business website</strong> is real and accessible</li>
       <li>The <strong className="text-[#E5E9F0]">product relevance</strong> is commercially plausible</li>
       <li>The <strong className="text-[#E5E9F0]">contact email</strong> is listed publicly and not a support/noreply address</li>
       <li>You are <strong className="text-[#E5E9F0]">not fabricating</strong> purchase intent or buyer details</li>
      </ul>
     </div>
     <div className="flex gap-3 justify-end">
      <button className="text-sm px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-[#9AA4B2] hover:text-[#E5E9F0] hover:bg-white/10" onClick={()=>setReviewConfirmLead(null)}>Cancel</button>
      <button className="text-sm px-4 py-2 rounded-lg bg-[#2FBF8F]/15 border border-[#2FBF8F]/30 text-[#2FBF8F] hover:bg-[#2FBF8F]/25 font-medium flex items-center gap-2" onClick={()=>confirmReview(reviewConfirmLead)}>
       <ShieldCheck className="h-4 w-4"/>Confirm Review
      </button>
     </div>
    </section>
   </div>,
   document.body
  )}

  {selected&&createPortal(<div role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null)}} className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
   <section role="dialog" aria-modal="true" aria-label="Buyer evidence" className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-panel border border-white/15 bg-[#161C25] p-6 shadow-2xl">
    <div className="flex justify-between gap-3">
     <div>
      <p className="text-xs text-[#2FBF8F] uppercase tracking-wide font-mono">Buyer dossier</p>
      <h3 className="text-xl font-semibold mt-2 text-[#E5E9F0] break-words">{selected.companyName}</h3>
     </div>
     <button aria-label="Close buyer details" onClick={()=>setSelected(null)} className="text-[#9AA4B2] hover:text-[#E5E9F0] shrink-0"><X className="h-5 w-5"/></button>
    </div>
    <div className="space-y-4 text-sm mt-6">
     {[
      ['Product Category',selected.category],
      ['Relevance Tier',selected.buyerTier==='Strong match'?'High Relevance':'Potential Buyer'],
      ['Classification Reason',selected.classificationReason||selected.buyerEvidence||'Plausible commercial fit'],
      ['Evidence Excerpt',selected.evidenceExcerpt||'No direct product listing required for Potential Buyer'],
      ['Email',selected.email || 'None listed (Missing Contact)'],
      ['Phone',selected.phone || 'None listed'],
      ['Location',`${selected.city}, ${selected.state}`],
      ['Website',selected.website],
      ['Email Source',selected.emailSourceUrl||(selected.email?'Public business website / listing':'N/A')],
      ['Review Status',selected.reviewed?'Reviewed and approved for outreach':'Pending manual review']
     ].map(([k,v])=>(
      <div key={k} className="grid grid-cols-[140px_1fr] gap-3 border-b border-white/10 pb-3">
       <span className="text-[#9AA4B2] text-xs font-mono shrink-0">{k}</span>
       <span className="break-all text-xs text-[#E5E9F0]">{v}</span>
      </div>
     ))}
     <div className="flex flex-wrap gap-4 pt-2">
      {selected.website&&<a href={selected.website} target="_blank" rel="noreferrer" className="text-[#2FBF8F] flex items-center gap-1 text-xs underline">Official website <ExternalLink className="h-3 w-3"/></a>}
      {selected.evidenceUrl&&<a href={selected.evidenceUrl} target="_blank" rel="noreferrer" className="text-[#2FBF8F] text-xs underline flex gap-1">Evidence page <ExternalLink className="h-3 w-3"/></a>}
     </div>
    </div>
    <p className="flex gap-2 text-xs text-[#C9A66B] mt-6">
     <AlertTriangle className="h-4 w-4 shrink-0"/>Commercial contact presence does not guarantee purchase intent. Independently verify relevance before sending.
    </p>
    <div className="flex flex-wrap gap-2 justify-between mt-6 pt-5 border-t border-white/10">
     <div className="flex gap-2">
      <Button variant="danger" size="sm" icon={<Trash2 className="h-3 w-3"/>} disabled={busy} onClick={()=>remove(selected)}>Delete</Button>
      {selected.email && <Button variant="secondary" size="sm" disabled={busy||suppressed.includes(selected.email.toLowerCase())} onClick={()=>suppress(selected)}>Do not contact</Button>}
     </div>
     <Button size="sm" icon={<ShieldCheck className="h-4 w-4"/>} disabled={busy||!selected.email||suppressed.includes(selected.email.toLowerCase())} onClick={()=>review(selected)}>
      {selected.reviewed?'Undo review':'Mark reviewed'}
     </Button>
    </div>
    {selected.reviewed&&emailOk(selected)&&!suppressed.includes(selected.email.toLowerCase())&&(
     <Button className="w-full mt-4" onClick={()=>{onCompose(selected);setSelected(null)}} icon={<Mail className="h-4 w-4"/>}>Compose email</Button>
    )}
   </section>
  </div>,
  document.body
  )}
 </div>;
};
