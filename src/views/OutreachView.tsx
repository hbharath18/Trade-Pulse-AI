import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Mail,Send,Users,Eye,ShieldCheck,AlertTriangle,Sparkles,Lock,Paperclip,X} from 'lucide-react';
import {PageHero} from '../components/ui/PageHero';
import {Card} from '../components/ui/Card';
import {Button} from '../components/ui/Button';
import {request,jsonBody} from '../services/api';
import {API} from '../services/api';
import {Lead,GmailStatus,SenderSettings,OutreachRecord} from '../types';
interface Attachment{filename:string;mimeType:string;data:string;size:number}
interface Preview{to:string;subject:string;body:string}
interface SenderResponse{settings:SenderSettings;gmail:GmailStatus;templates:{subject:string;body:string}}
const defaultSubject='Wholesale Inquiry – Handcrafted Home Décor & Giftware';
const defaultBody='Hello,\n\nI hope you’re doing well.\n\nI’m reaching out on behalf of OM Enterprise, where we specialize in handcrafted home décor and gifting products, including decorative lanterns, candle holders, and decorative jars.\n\nWe would love to explore the possibility of working with your business and would be happy to share our product collection for your review.\n\nWould you be interested in exploring potential wholesale opportunities with us?\n\nLooking forward to hearing from you.';

/** Check if a template string still has unresolved {variable} tokens after merging */
function hasUnresolvedTokens(text:string):boolean {
  return /\{[a-zA-Z0-9_-]+\}/.test(text);
}

export const OutreachView:React.FC<{leads:Lead[];gmail:GmailStatus;suppressed:string[];history:OutreachRecord[];initialLeadId:string;onChanged:()=>Promise<void>|void;onOpenSettings:()=>void}>=({leads,gmail,suppressed,history,initialLeadId,onChanged,onOpenSettings})=>{
 const [selected,setSelected]=useState<string[]>([]),[productFilter,setProductFilter]=useState('all'),[subject,setSubject]=useState(defaultSubject),[body,setBody]=useState(defaultBody);
 const [settings,setSettings]=useState<SenderSettings|null>(null),[preview,setPreview]=useState<Preview|null>(null),[approval,setApproval]=useState('');
 const [attachments,setAttachments]=useState<Attachment[]>([]),[confirmOpen,setConfirmOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 useEffect(()=>{request<SenderResponse>('/api/outreach/settings').then(r=>{setSettings(r.settings);setSubject(r.templates.subject);setBody(r.templates.body)}).catch(e=>setError(e.message))},[]);
 const recentlyContacted=useMemo(()=>new Set(history.filter(h=>{const age=Date.now()-Date.parse(h.created_at);return age>=0&&((h.status==='failed'&&age<86400000)||(['attempted','sent','replied'].includes(h.status)&&age<30*86400000));}).map(h=>h.recipient.toLowerCase())),[history]);
 const eligible=useMemo(()=>leads.filter(l=>l.reviewed&&l.email&&['Strong match','Potential'].includes(l.buyerTier||'')&&!suppressed.includes(l.email.toLowerCase())&&!recentlyContacted.has(l.email.toLowerCase())),[leads,suppressed,recentlyContacted]);
 const productCategories=useMemo(()=>Array.from(new Set(eligible.map(l=>(l.category||'Singing Bowls').trim()).filter(Boolean))).sort(),[eligible]);
 const visibleEligible=useMemo(()=>productFilter==='all'?eligible:eligible.filter(l=>(l.category||'Singing Bowls').trim()===productFilter),[eligible,productFilter]);
 useEffect(()=>{setSelected(prev=>prev.filter(id=>eligible.some(l=>l.id===id)))},[eligible]);
 const lastInitial=useRef('');useEffect(()=>{if(initialLeadId && initialLeadId!==lastInitial.current && eligible.some(l=>l.id===initialLeadId)){lastInitial.current=initialLeadId;setSelected([initialLeadId])}},[initialLeadId,eligible]);
 const selectedLead=leads.find(l=>l.id===selected[0]);

 // Warn if preview has unresolved tokens
 const previewHasUnresolved = preview && (hasUnresolvedTokens(preview.subject) || hasUnresolvedTokens(preview.body));

 const toggle=(id:string)=>{setPreview(null);setApproval('');setSelected(prev=>prev.includes(id)?prev.filter(x=>x!==id):prev.length<10?[...prev,id]:prev)};

 const runPreview=async()=>{
  if(!selectedLead)return;
  setBusy(true);setError('');
  try{
   const p = await request<Preview>('/api/outreach/preview',jsonBody({leadId:selectedLead.id,subjectTemplate:subject,bodyTemplate:body}));
   if(hasUnresolvedTokens(p.subject)||hasUnresolvedTokens(p.body)){
    setError('⚠ Preview contains unresolved template variables. Check that all {tokens} are supported: {companyName}, {city}, {state}, {product}, {evidence}, {website}');
   }
   setPreview(p);
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false)}
 };

 const draft=async()=>{
  if(!selected.length)return;
  setBusy(true);setError('');
  try{
   const r=await request<{subject:string;body:string;note:string}>('/api/outreach/ai-draft',jsonBody({leadIds:selected}));
   setSubject(r.subject);setBody(r.body);setPreview(null);setMessage(r.note);
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false)}
 };

 const onPickFiles=async(e:React.ChangeEvent<HTMLInputElement>)=>{
  const picked=Array.from(e.target.files||[]);
  e.target.value='';
  if(!picked.length)return;
  setError('');
  if(attachments.length+picked.length>6){setError('Maximum 6 files allowed in batch attachment pool.');return;}
  const next:Attachment[]=[...attachments];
  for(const f of picked){
   if(f.size>5*1024*1024){setError(`${f.name} exceeds 5 MB limit.`);return;}
   const dataUrl=await new Promise<string>((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result||''));r.onerror=()=>rej(new Error('Failed to read '+f.name));r.readAsDataURL(f);});
   const base64=dataUrl.split(',')[1]||'';
   next.push({filename:f.name,mimeType:f.type||'application/octet-stream',data:base64,size:f.size});
  }
  const total=next.reduce((s,a)=>s+a.size,0);
  if(total>10*1024*1024){setError('Total attachment pool size cannot exceed 10 MB.');return;}
  setAttachments(next);
 };

 const openSendConfirm=()=>{
  if(selected.length===0||approval!==`SEND ${selected.length}`)return;
  if(previewHasUnresolved){setError('Cannot send: preview contains unresolved {variable} tokens. Fix your template first.');return;}
  setConfirmOpen(true);
 };

 const send=async()=>{
  if(selected.length===0||approval!==`SEND ${selected.length}`)return;
  setConfirmOpen(false);
  setBusy(true);setError('');setMessage('');
  try{
   const r=await request<{results:Array<{recipient:string;status:string;error?:string}>;sent:number;failed:number;attemptsRemainingToday:number}>('/api/outreach/send',jsonBody({leadIds:selected,subjectTemplate:subject,bodyTemplate:body,approvalPhrase:approval,attachments:attachments.map(({filename,mimeType,data})=>({filename,mimeType,data}))}));
   setMessage(`Gmail accepted ${r.sent} message(s); ${r.failed} failed. ${r.attemptsRemainingToday} daily attempts remain. ${r.failed?r.results.filter(x=>x.error).map(x=>x.error).join(' | '):''}`)
   setApproval('');setSelected([]);setPreview(null);await onChanged();
  }catch(e){setError(e instanceof Error?e.message:String(e))}
  finally{setBusy(false)}
 };

 const canSend = gmail.connected&&!busy&&selected.length>0&&approval===`SEND ${selected.length}`&&!!settings?.senderName&&!!settings?.postalAddress;

 return <div className="space-y-10 animate-in fade-in duration-200">
  <PageHero eyebrow="Manually approved outreach" eyebrowIcon={<Mail className="h-3.5 w-3.5"/>} title="Gmail Outreach Engine" gradientWord="Outreach" description="Compose truthful, personalized supplier inquiries. Every recipient must be individually reviewed, and no email is sent without your explicit confirmation." actions={<span className="inline-flex items-center gap-2 px-3.5 h-10 rounded-full bg-[#10151C] border border-white/10 text-xs text-[#9AA4B2]"><span className={'w-2 h-2 rounded-full '+(gmail.connected?'bg-[#2FBF8F]':'bg-[#C9A66B]')}/>{gmail.connected?gmail.email:'Gmail not connected'}</span>}/>

  <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel bg-[#10151C] border border-white/10 p-4">
   <div className="flex items-center gap-2 text-sm">
    <Lock className="h-4 w-4 text-[#2FBF8F]"/>
    <span>Daily attempts: <strong>{gmail.sentAttemptsToday} / {gmail.dailyLimit}</strong> · Max {gmail.perBatchLimit} per approved batch</span>
   </div>
   <button className="text-xs underline text-[#2FBF8F]" onClick={onOpenSettings}>{gmail.connected?'Manage Gmail & sender settings':'Connect Gmail and set sender identity'}</button>
  </div>

  {error&&<p role="alert" className="rounded-xl bg-red-950/30 border border-red-500/40 text-red-200 p-4 text-sm">{error}</p>}
  {message&&<p role="status" className="rounded-xl bg-[rgba(47,191,143,.08)] border border-[#2FBF8F]/25 text-[#E5E9F0] p-4 text-sm">{message}</p>}

  {/* Step indicators */}
  <div className="flex flex-wrap gap-2 items-center text-xs text-[#667085]">
   {[
    ['1', 'Select reviewed recipients'],
    ['2', 'Preview personalized message'],
    ['3', 'Type approval phrase'],
    ['4', 'Send']
   ].map(([step,label],i,arr)=>(
    <React.Fragment key={step}>
     <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#10151C] border border-white/10">
      <span className="w-5 h-5 flex items-center justify-center rounded-full bg-[#2FBF8F]/15 text-[#2FBF8F] font-mono text-[11px]">{step}</span>
      <span className="text-[#9AA4B2]">{label}</span>
     </span>
     {i<arr.length-1&&<span className="text-[#333B48]">›</span>}
    </React.Fragment>
   ))}
  </div>

  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
   {/* Step 1: Recipient selection */}
   <Card padding="md" className="lg:col-span-5 space-y-4">
    <div className="flex items-center justify-between pb-3 border-b border-white/10">
     <h3 className="text-[16px] font-bold flex gap-2 items-center"><Users className="h-4 w-4 text-[#2FBF8F]"/>Select Buyers</h3>
     <span className="rounded-full bg-[#2FBF8F]/10 text-[#2FBF8F] text-xs px-2.5 py-1 font-mono">{selected.length} / 10</span>
    </div>
    <p className="text-xs text-[#9AA4B2]">Only relevant, reviewed, non-suppressed contacts without recent outreach appear below.</p>
    <div className="flex items-center gap-2">
     <select aria-label="Filter recipients by product" value={productFilter} onChange={e=>setProductFilter(e.target.value)} className="flex-1 h-9 rounded-control bg-[#161C25] border border-white/10 px-2.5 text-xs text-[#E5E9F0] focus:outline-none focus:border-[#2FBF8F]">
      <option value="all">All Products ({eligible.length})</option>
      {productCategories.map(cat=>(
       <option key={cat} value={cat}>{cat} ({eligible.filter(l=>(l.category||'Singing Bowls').trim()===cat).length})</option>
      ))}
     </select>
     {visibleEligible.length>0&&(
      <button type="button" onClick={()=>{setPreview(null);setApproval('');setSelected(visibleEligible.slice(0,10).map(l=>l.id));}} className="h-9 px-2.5 rounded-control bg-[#161C25] border border-white/10 hover:border-[#2FBF8F] text-[11px] text-[#2FBF8F] whitespace-nowrap">
       Select top {Math.min(10,visibleEligible.length)}
      </button>
     )}
    </div>
    <div className="max-h-[520px] overflow-y-auto space-y-2 pr-1">
     {visibleEligible.map(l=>(
      <label key={l.id} className={'flex cursor-pointer gap-3 p-3 rounded-panel border transition-all '+(selected.includes(l.id)?'bg-[#161C25] border-[#2FBF8F]':'bg-[#10151C] border-white/10 hover:border-white/20')}>
       <input type="checkbox" checked={selected.includes(l.id)} onChange={()=>toggle(l.id)} disabled={!selected.includes(l.id)&&selected.length>=10} className="mt-1 accent-[#2FBF8F]"/>
       <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold truncate">{l.companyName}</span>
        <span className="text-xs flex flex-wrap items-center gap-1.5 text-[#9AA4B2] mt-1">
         <span>{l.city} · {l.buyerTier==='Strong match'?'High Relevance':'Potential Buyer'}</span>
         <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[#9AA4B2]">{l.category||'Singing Bowls'}</span>
        </span>
        <span className="block text-[11px] truncate text-[#667085] mt-1">{l.email}</span>
       </span>
      </label>
     ))}
     {!visibleEligible.length&&<p className="text-xs text-[#9AA4B2] py-5">No reviewed prospects match this filter. Visit Buyers → Inspect → Mark reviewed after checking a business website.</p>}
    </div>
    <button type="button" onClick={()=>{setSelected([]);setPreview(null);setApproval('')}} className="text-xs text-[#9AA4B2] underline">Clear selection</button>
   </Card>

   {/* Steps 2-4: Compose, preview, approve, send */}
   <Card padding="md" className="lg:col-span-7 space-y-5">
    <div className="flex justify-between items-center pb-3 border-b border-white/10">
     <h3 className="text-[16px] font-bold flex items-center gap-2"><Mail className="h-4 w-4 text-[#2FBF8F]"/>Pitch Composer</h3>
     <Button variant="secondary" size="sm" icon={<Eye className="h-4 w-4"/>} onClick={()=>void runPreview()} disabled={!selected.length||busy}>Preview</Button>
    </div>

    <div>
     <label className="block text-[11px] font-mono uppercase text-[#9AA4B2] mb-2">Personalization tokens</label>
     <div className="flex flex-wrap gap-2">
      {['{companyName}','{city}','{state}','{product}','{evidence}','{website}'].map(t=>(
       <button key={t} onClick={()=>setBody(b=>b+' '+t)} className="rounded bg-[#161C25] text-[#2FBF8F] text-xs px-2.5 py-1.5 hover:bg-[#1D2535]">{t}</button>
      ))}
     </div>
    </div>

    <label className="block">
     <span className="block text-[11px] font-mono uppercase text-[#9AA4B2] mb-2">Subject</span>
     <input value={subject} maxLength={300} onChange={e=>{setSubject(e.target.value);setPreview(null)}} className="w-full h-11 rounded-control bg-[#161C25] border border-white/10 px-3 text-sm focus:outline-none focus:border-[#2FBF8F]"/>
    </label>

    <label className="block">
     <span className="block text-[11px] font-mono uppercase text-[#9AA4B2] mb-2">Email body — editable free template</span>
     <textarea value={body} maxLength={7000} onChange={e=>{setBody(e.target.value);setPreview(null)}} rows={8} className="w-full rounded-control bg-[#161C25] border border-white/10 p-3 text-sm leading-relaxed resize-y focus:outline-none focus:border-[#2FBF8F]"/>
    </label>

    <div className="flex items-center gap-3 flex-wrap">
     <Button variant="secondary" size="sm" onClick={()=>void draft()} icon={<Sparkles className="h-4 w-4"/>} disabled={busy||selected.length===0||!settings?.openAiEnabled}>{selected.length>1?`Generate Formal Batch AI Draft (${selected.length})`:'Generate Formal AI Draft'}</Button>
     <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-control bg-[#161C25] border border-white/10 hover:border-[#2FBF8F] text-xs text-[#E5E9F0] cursor-pointer">
      <Paperclip className="h-3.5 w-3.5 text-[#2FBF8F]"/>
      <span>Attach posters / catalog ({attachments.length}/6)</span>
      <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xlsx,.csv" onChange={e=>void onPickFiles(e)} className="hidden" disabled={busy||attachments.length>=6}/>
     </label>
     <p className="text-xs text-[#9AA4B2]">{settings?.openAiEnabled?'AI calls may be billed. Draft only, never auto-send.':'OpenAI disabled: free template works without API credits.'}</p>
    </div>

    {attachments.length>0&&(
     <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
       {attachments.map((att,idx)=>(
        <span key={idx} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#161C25] border border-white/10 text-xs text-[#E5E9F0]">
         <Paperclip className="h-3 w-3 text-[#2FBF8F]"/>
         <span className="max-w-[200px] truncate">{att.filename}</span>
         <span className="text-[#667085]">({Math.max(1,Math.round(att.size/1024))} KB)</span>
         <button type="button" aria-label={`Remove ${att.filename}`} onClick={()=>setAttachments(prev=>prev.filter((_,i)=>i!==idx))} className="text-[#9AA4B2] hover:text-red-300"><X className="h-3.5 w-3.5"/></button>
        </span>
       ))}
      </div>
      {selected.length>0&&(()=>{
       const PRESET_ORDER=['Singing Bowls','Indian Handicrafts','Home Decor','Brass Lamps','Handcrafted Accents'];
       const order=[...PRESET_ORDER];
       for(const l of leads){
        const c=(l.category||'Singing Bowls').trim();
        if(c&&!order.some(x=>x.toLowerCase()===c.toLowerCase()))order.push(c);
       }
       const getSlot=(fn:string)=>{
        const m=fn.replace(/\.[^.]+$/,'').trim().match(/^image[\s_-]*(\d+)$/i);
        return m?Number(m[1]):null;
       };
       const hasNumbered=attachments.some(a=>getSlot(a.filename)!==null);
       const selectedLeads=leads.filter(l=>selected.includes(l.id));
       const products=Array.from(new Set(selectedLeads.map(l=>(l.category||'Singing Bowls').trim())));
       return (
        <div className="rounded-lg bg-[#10151C] border border-white/10 px-3 py-2.5 text-[11px] text-[#9AA4B2] space-y-1">
         <p className="text-[#2FBF8F] font-mono uppercase text-[10px]">Order-Wise Poster Routing (Image1, Image2, Image3…)</p>
         {products.map(prod=>{
          const idx=order.findIndex(x=>x.toLowerCase()===prod.toLowerCase());
          const slot=idx>=0?idx+1:-1;
          const matched=hasNumbered
           ? attachments.filter(a=>getSlot(a.filename)===null||getSlot(a.filename)===slot)
           : attachments;
          return (
           <div key={prod} className="flex flex-wrap items-center gap-1.5">
            <span className="text-[#E5E9F0] font-medium">#{slot} {prod}:</span>
            <span>{matched.length?matched.map(m=>m.filename).join(', '):<span className="text-[#C9A66B]">Missing Image{slot}.png</span>}</span>
           </div>
          );
         })}
        </div>
       );
      })()}
     </div>
    )}

    {/* Step 2: Preview */}
    {preview&&(
     <div className="rounded-xl bg-[#0A0D12] border border-white/10 p-4 space-y-3">
      <p className="text-xs text-[#2FBF8F] uppercase font-mono">Step 2 — Personalized preview for {selectedLead?.companyName}</p>
      <div className="text-xs text-[#9AA4B2] flex flex-wrap gap-4">
       <span>To: <span className="text-[#E5E9F0]">{preview.to}</span></span>
      </div>
      <p className="font-semibold text-sm">{preview.subject}</p>
      {previewHasUnresolved&&(
       <p className="text-xs text-red-300 flex gap-2 items-center"><AlertTriangle className="h-3 w-3"/>{`Unresolved template variables detected. Fix before sending.`}</p>
      )}
      <pre className="whitespace-pre-wrap break-words text-xs font-sans text-[#E5E9F0] border-t border-white/10 pt-3">{preview.body}</pre>
     </div>
    )}

    {/* Steps 3+4: Approval and send */}
    <div className="rounded-xl bg-[#161C25] border border-white/10 p-5 space-y-5">
     <div className="flex items-start gap-2 text-xs text-[#C9A66B]">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5"/>
      <span>Every send requires real sender details, Gmail authorization, individually reviewed prospects, and your explicit approval. The message footer adds your postal address and an unsubscribe instruction.</span>
     </div>

     <div>
      <p className="text-xs text-[#9AA4B2] mb-2">
       <strong className="text-[#E5E9F0]">Step 3</strong> — Type <strong className="text-[#E5E9F0] font-mono">SEND {selected.length||'N'}</strong> to approve exactly this batch of {selected.length} recipient(s)
      </p>
      <input
       value={approval}
       onChange={e=>setApproval(e.target.value)}
       autoComplete="off"
       placeholder={selected.length?`SEND ${selected.length}`:'Select buyer(s) first'}
       className="h-11 w-full rounded-control bg-[#10151C] border border-white/15 px-3 font-mono text-sm focus:border-[#2FBF8F] focus:outline-none"
      />
     </div>

     <div>
      <p className="text-xs text-[#9AA4B2] mb-3"><strong className="text-[#E5E9F0]">Step 4</strong> — Send after final review</p>
      <Button
       className="w-full"
       icon={<Send className="h-4 w-4"/>}
       disabled={!canSend||!!previewHasUnresolved}
       onClick={openSendConfirm}
      >
       {busy?'Processing…':`Review & send ${selected.length||0} message(s)`}
      </Button>
      {!gmail.connected&&<p className="text-xs text-[#C9A66B] mt-2">Gmail is not connected. Open Settings to authorize it in your browser.</p>}
      {previewHasUnresolved&&<p className="text-xs text-red-300 mt-2">Fix unresolved template tokens before sending.</p>}
     </div>
    </div>
   </Card>
  </div>

  <Card padding="md">
   <p className="flex gap-2 items-center text-sm"><ShieldCheck className="h-4 w-4 text-[#2FBF8F]"/><strong>Sending does not prove delivery.</strong></p>
   <p className="text-xs text-[#9AA4B2] mt-2">No tracking pixels, hidden bulk emails, automatic follow-ups, or fabricated business claims. Replies are checked only on your request. Honor unsubscribe requests promptly.</p>
  </Card>
  {confirmOpen&&createPortal(
   <div role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setConfirmOpen(false)}} className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
    <section role="dialog" aria-modal="true" aria-label="Final send confirmation" className="w-full max-w-md rounded-panel border border-white/15 bg-[#161C25] p-6 shadow-2xl space-y-5">
     <div className="flex items-start justify-between gap-3">
      <div>
       <p className="text-xs text-[#2FBF8F] uppercase tracking-wide font-mono mb-1">Final Confirmation</p>
       <h3 className="text-lg font-semibold text-[#E5E9F0]">Send {selected.length} Personalized Email{selected.length>1?'s':''}?</h3>
      </div>
      <button aria-label="Close" onClick={()=>setConfirmOpen(false)} className="text-[#9AA4B2] hover:text-[#E5E9F0]"><X className="h-5 w-5"/></button>
     </div>
     <div className="rounded-xl bg-[#10151C] border border-white/10 p-3.5 text-xs text-[#9AA4B2] space-y-1.5">
      <p>Sender account: <span className="text-[#E5E9F0] font-mono">{gmail.email}</span></p>
      <p>Recipients: <span className="text-[#E5E9F0] font-semibold">{selected.length} individually reviewed buyer(s)</span></p>
      {attachments.length>0&&<p>Attachments: <span className="text-[#2FBF8F]">{attachments.map(a=>a.filename).join(', ')}</span></p>}
     </div>
     <p className="text-xs text-[#C9A66B] flex gap-2 items-start"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5"/>You have reviewed every recipient, email address, and claim. Once dispatched via Gmail, this action cannot be undone.</p>
     <div className="flex justify-end gap-3 pt-1">
      <Button variant="secondary" size="sm" onClick={()=>setConfirmOpen(false)}>Cancel</Button>
      <Button size="sm" icon={<Send className="h-4 w-4"/>} onClick={()=>void send()}>Confirm & Send ({selected.length})</Button>
     </div>
    </section>
   </div>,
   document.body
  )}
 </div>;
 
};
