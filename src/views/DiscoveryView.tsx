import React,{useEffect,useRef,useState} from 'react';
import {Radar,MapPin,Play,Globe2,ShieldCheck,AlertCircle,Search,CheckCircle2} from 'lucide-react';
import {PageHero} from '../components/ui/PageHero';
import {Card} from '../components/ui/Card';
import {Button} from '../components/ui/Button';
import {request,jsonBody} from '../services/api';
import {ApiHealth,DiscoveryResponse,ProductCategory} from '../types';
const CITIES:Record<string,string[]>={
 Alabama:['Birmingham','Huntsville','Mobile','Montgomery'],
 Alaska:['Anchorage','Juneau','Fairbanks','Sitka'],
 Arizona:['Sedona','Phoenix','Scottsdale','Tucson','Flagstaff'],
 Arkansas:['Little Rock','Fayetteville','Hot Springs','Bentonville'],
 California:['Los Angeles','San Francisco','San Diego','Sacramento','Santa Monica','Berkeley','Santa Cruz','Ojai'],
 Colorado:['Denver','Boulder','Colorado Springs','Fort Collins','Aspen'],
 Connecticut:['Hartford','New Haven','Stamford','Mystic'],
 Delaware:['Wilmington','Dover','Newark','Rehoboth Beach'],
 Florida:['Miami','Orlando','Tampa','St. Petersburg','Fort Lauderdale','Sarasota'],
 Georgia:['Atlanta','Savannah','Athens','Augusta'],
 Hawaii:['Honolulu','Hilo','Kailua','Lahaina'],
 Idaho:['Boise','Coeur d\'Alene','Sun Valley','Idaho Falls'],
 Illinois:['Chicago','Evanston','Naperville','Oak Park','Springfield'],
 Indiana:['Indianapolis','Bloomington','Fort Wayne','South Bend'],
 Iowa:['Des Moines','Iowa City','Cedar Rapids','Davenport'],
 Kansas:['Wichita','Overland Park','Lawrence','Kansas City'],
 Kentucky:['Louisville','Lexington','Bowling Green','Covington'],
 Louisiana:['New Orleans','Baton Rouge','Lafayette','Shreveport'],
 Maine:['Portland','Bar Harbor','Bangor','Camden'],
 Maryland:['Baltimore','Annapolis','Silver Spring','Frederick'],
 Massachusetts:['Boston','Cambridge','Northampton','Salem','Provincetown'],
 Michigan:['Detroit','Ann Arbor','Grand Rapids','Traverse City'],
 Minnesota:['Minneapolis','Saint Paul','Duluth','Rochester'],
 Mississippi:['Jackson','Oxford','Biloxi','Hattiesburg'],
 Missouri:['Kansas City','St. Louis','Columbia','Springfield'],
 Montana:['Bozeman','Missoula','Billings','Helena'],
 Nebraska:['Omaha','Lincoln','Bellevue','Kearney'],
 Nevada:['Las Vegas','Reno','Henderson','Carson City'],
 'New Hampshire':['Portsmouth','Manchester','Concord','Hanover'],
 'New Jersey':['Jersey City','Newark','Princeton','Montclair','Asbury Park'],
 'New Mexico':['Santa Fe','Albuquerque','Taos','Las Cruces'],
 'New York':['New York','Brooklyn','Manhattan','Buffalo','Albany','Ithaca','Woodstock'],
 'North Carolina':['Asheville','Charlotte','Raleigh','Durham','Wilmington'],
 'North Dakota':['Fargo','Bismarck','Grand Forks','Minot'],
 Ohio:['Columbus','Cleveland','Cincinnati','Yellow Springs'],
 Oklahoma:['Oklahoma City','Tulsa','Norman','Stillwater'],
 Oregon:['Portland','Eugene','Bend','Ashland','Salem'],
 Pennsylvania:['Philadelphia','Pittsburgh','Lancaster','New Hope','Harrisburg'],
 'Rhode Island':['Providence','Newport','Warwick','Bristol'],
 'South Carolina':['Charleston','Columbia','Greenville','Myrtle Beach'],
 'South Dakota':['Sioux Falls','Rapid City','Deadwood','Brookings'],
 Tennessee:['Nashville','Memphis','Knoxville','Chattanooga'],
 Texas:['Houston','Austin','Dallas','San Antonio','Fort Worth','El Paso'],
 Utah:['Salt Lake City','Park City','Moab','Provo'],
 Vermont:['Burlington','Brattleboro','Montpelier','Stowe'],
 Virginia:['Richmond','Virginia Beach','Charlottesville','Alexandria'],
 Washington:['Seattle','Bellevue','Tacoma','Olympia','Bellingham'],
 'West Virginia':['Charleston','Morgantown','Huntington','Shepherdstown'],
 Wisconsin:['Milwaukee','Madison','Green Bay','Bayfield'],
 Wyoming:['Jackson','Cheyenne','Laramie','Cody']
};
const PRESET_PRODUCTS=['Singing Bowls','Indian Handicrafts','Home Decor','Brass Lamps','Handcrafted Accents'];
const STATES=['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'];
const input='w-full rounded-control bg-[#161C25] border border-[rgba(148,163,184,0.18)] px-3 h-11 text-sm text-[#E5E9F0] focus:outline-none focus:border-[#2FBF8F]';
const lbl='block text-[11px] uppercase tracking-eyebrow font-mono font-semibold text-[#9AA4B2] mb-2';
type Progress={running:boolean;stage:string;stageDetail:string;updatedAt:string;listingsFetched:number;websitesChecked:number;websitesTotal:number;relevantWithWebsite?:number;categoryProspects?:number;websitesSucceeded?:number;websitesFailed?:number;failureReasons?:Record<string,number>;emailsFound?:number;productMatches?:number;strongMatches?:number;potentialMatches?:number;saved?:number;outreachCandidates?:number;tilesDone?:number;tilesTotal?:number;cachedSites?:number;providerCounts?:Record<string,number>;error?:string};
export const DiscoveryView:React.FC<{health:ApiHealth|null;onComplete:()=>Promise<void>|void}>=({health,onComplete})=>{
 const [category,setCategory]=useState<string>('Singing Bowls'),[state,setState]=useState('Texas'),[city,setCity]=useState('Houston'),[target,setTarget]=useState(String(health?.limits.maxLeads||1800));
 const initialTarget=useRef(false);useEffect(()=>{if(health?.limits.maxLeads&&!initialTarget.current){initialTarget.current=true;setTarget(String(health.limits.maxLeads))}},[health?.limits.maxLeads]);
 const [scanBusy,setScanBusy]=useState(false),[scan,setScan]=useState<DiscoveryResponse|null>(null),[error,setError]=useState('');
 const [progress,setProgress]=useState<Progress|null>(null);
 useEffect(()=>{let active=true;const update=async()=>{try{const p=await request<Progress>('/api/discovery/status');if(active){setProgress(p);setScanBusy(Boolean(p.running));}}catch{}};void update();const timer=window.setInterval(()=>{if(scanBusy)void update()},800);return()=>{active=false;window.clearInterval(timer)}},[scanBusy]);
 const run=async()=>{
  setScanBusy(true);setError('');setScan(null);setProgress({running:true,stage:'starting',stageDetail:'Starting scan',updatedAt:'',listingsFetched:0,websitesChecked:0,websitesTotal:0});
  try{const r=await request<DiscoveryResponse>('/api/discover',jsonBody({category:category.trim(),city:city.trim(),state,maxLeads:Math.max(1,Math.min(5000,Number(target)||1800))}));setScan(r);await onComplete()}
  catch(e){setError(e instanceof Error?e.message:String(e))}finally{setScanBusy(false);try{setProgress(await request<Progress>('/api/discovery/status'))}catch{}}
 };
 const websiteStage=Boolean(progress?.websitesTotal && (progress.stage==='inspecting'||progress.stage==='saving'||progress.stage==='complete'));
 const overtureStage=progress?.stage==='overture'&&Boolean(progress?.tilesTotal);
 const isComplete = !scanBusy && (progress?.stage==='complete' || Boolean(scan));
 const fraction = isComplete ? 1 : websiteStage ? (progress?.websitesChecked||0)/(progress?.websitesTotal||1) : overtureStage ? (progress?.tilesDone||0)/(progress?.tilesTotal||1) : null;
 const known = isComplete || fraction !== null;
 const percent = isComplete ? 100 : (known ? Math.min(99, Math.max(1, Math.round(100*(fraction||0)))) : 0);
 const reasonText=(r?:Record<string,number>)=>Object.entries(r||{}).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k.replace(/_/g,' ')}: ${v}`).join(' · ');
 return <div className="space-y-10 animate-in fade-in duration-200">
  <PageHero eyebrow="Business API discovery" eyebrowIcon={<Radar className="h-3.5 w-3.5"/>} title="US Buyer Discovery Engine" gradientWord="Discovery" description="Search live open business listings. Only first-party product-selling evidence qualifies a strong buyer match; unrelated yoga studios are excluded." actions={<span className="inline-flex h-10 items-center gap-2 px-3.5 rounded-full bg-[#10151C] border border-white/10 text-[#9AA4B2] text-sm"><span className="h-2 w-2 bg-[#2FBF8F] rounded-full"/> Open-data sources</span>}/>
  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
   <Card padding="md" className="lg:col-span-5 space-y-5">
    <div className="flex items-center gap-2 border-b border-white/10 pb-4"><MapPin className="h-5 w-5 text-[#2FBF8F]"/><h3 className="text-[17px] font-semibold">Search Configuration</h3></div>
    <div>
     <label>
      <span className={lbl}>Product (select or add new product)</span>
      <select
       aria-label="Product category"
       className={input}
       value={PRESET_PRODUCTS.includes(category) ? category : '__custom__'}
       onChange={e=>{
        const val=e.target.value;
        setCategory(val==='__custom__'?'':val);
       }}
      >
       {PRESET_PRODUCTS.map(v=><option key={v} value={v}>{v}</option>)}
       <option value="__custom__">+ Add new product (type custom)…</option>
      </select>
     </label>
     {!PRESET_PRODUCTS.includes(category)&&(
      <input
       aria-label="Custom product name"
       className={`${input} mt-2`}
       value={category}
       maxLength={80}
       autoFocus
       onChange={e=>setCategory(e.target.value)}
       placeholder="Type product name (e.g., Copper Drinkware, Handloom Rugs, Incense)"
      />
     )}
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
  <label>
    <span className={lbl}>State</span>
    <select
      className={input}
      value={state}
      onChange={e => {
        setState(e.target.value);
        setCity(CITIES[e.target.value]?.[0] || '');
      }}
    >
      {STATES.map(v => <option key={v} value={v}>{v}</option>)}
    </select>
  </label>

  <div className="relative">
    <label>
      <span className={lbl}>City (select or type any US city)</span>
      <select
        aria-label="Preset cities for state"
        className={input}
        value={(CITIES[state] || []).includes(city) ? city : '__custom__'}
        onChange={e => {
          const val = e.target.value;
          setCity(val === '__custom__' ? '' : val);
        }}
      >
        {(CITIES[state] || []).map(v => (
          <option key={v} value={v}>{v}</option>
        ))}
        <option value="__custom__">Other city (type custom)…</option>
      </select>
    </label>
    {!(CITIES[state] || []).includes(city) && (
      <input
        aria-label="Custom US city name"
        className={`${input} mt-2`}
        value={city}
        maxLength={80}
        autoFocus
        onChange={e => setCity(e.target.value)}
        placeholder="Type any US city name (e.g., Plano, Sedona)"
      />
    )}
  </div>
</div>
    <label><span className={lbl}>Maximum outreach candidates (1–5,000)</span><input className={input} type="number" min="1" max="5000" value={target} onChange={e=>setTarget(e.target.value)}/></label>
    <div className="rounded-xl border border-[rgba(47,191,143,0.17)] bg-[rgba(47,191,143,0.05)] p-4"><p className="text-sm text-[#E5E9F0] flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#2FBF8F]"/> Buyers vs. research leads</p><p className="text-xs text-[#9AA4B2] mt-2">Strong matches require actual product-sale evidence. Adjacent retail listings with missing proof are saved separately for research. Up to {health?.limits.websiteChecks||900} business websites checked per scan. High limits increase bandwidth and scan time.</p></div>
    <Button className="w-full" onClick={()=>void run()} disabled={scanBusy||!city.trim()||!category.trim()} icon={scanBusy?<Radar className="h-4 w-4 animate-pulse"/>:<Play className="h-4 w-4"/>}>{scanBusy?'Scanning business data & websites…':'Run Discovery Scan'}</Button>
    <p className="text-xs text-[#667085]">Only manually reviewed, product-relevant business contacts may be emailed. Provider quotas and missing website evidence can reduce results.</p>
   </Card>
   <div className="lg:col-span-7 space-y-6">
    <Card padding="md"><div className="flex items-center gap-2 mb-5"><Globe2 className="h-5 w-5 text-[#2FBF8F]"/><h3 className="text-[17px] font-semibold">Live Data Providers</h3></div><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">{[['Overture Maps','overture'],['Geoapify','geoapify'],['OpenStreetMap / Overpass','overpass'],['TomTom Places','tomtom']].map(([label,id])=><div key={id} className="rounded-xl bg-[#161C25] border border-white/[.05] p-4 flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-xs font-medium">{label}</p><p className="text-[11px] mt-1 text-[#667085]">{health?.discoveryProviders[id]?'Enabled':'Disabled / no key'}</p></div><span className={'shrink-0 h-2 w-2 rounded-full '+(health?.discoveryProviders[id]?'bg-[#2FBF8F]':'bg-[#667085]')}/></div>)}</div><p className="text-xs text-[#9AA4B2] mt-5">Overture uses public open data. Add optional keys in <code>server/.env</code>. Overture is the default. Optional providers require their own keys or usage limits.</p></Card>
    <Card padding="md" className="min-h-[225px]"><div className="flex items-center gap-2 mb-5"><Search className="h-5 w-5 text-[#2FBF8F]"/><h3 className="text-[17px] font-semibold">Extraction Stream</h3></div>
     {error&&<div role="alert" className="p-3 border border-red-500/40 rounded-xl text-sm text-red-200">{error}</div>}
     {(scanBusy||scan||progress?.stage==='complete')&&<div className="mb-5" aria-label="Discovery scan progress">
       <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[#9AA4B2]">{scanBusy?(progress?.stageDetail||'Querying providers…'):'Scan complete'}</span>
        <span className="font-mono text-xs text-[#2FBF8F]">{known ? `${percent}%` : 'Indeterminate (querying...)'}</span>
       </div>
       <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={known?percent:undefined} className="h-[7px] bg-[#161C25] rounded-full overflow-hidden">
        <div className={'h-full bg-[#2FBF8F] rounded-full transition-all duration-500 '+(!known&&scanBusy?'animate-pulse opacity-30':'')} style={{width:known?`${percent}%`:'100%'}}/>
       </div>
       {(scanBusy || progress?.stage === 'complete') &&<p className="text-xs text-[#9AA4B2] mt-2">{progress?.websitesTotal?`Websites checked: ${progress.websitesChecked} / ${progress.websitesTotal}`:`Listings fetched: ${progress?.listingsFetched||0}`}</p>}
       {(scanBusy || progress?.stage === 'complete') &&<div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">{[['Businesses fetched',progress?.listingsFetched],['Websites checked',progress?.websitesChecked],['Websites read',progress?.websitesSucceeded],['Website failures',progress?.websitesFailed],['Emails found',progress?.emailsFound],['High Relevance',progress?.strongMatches],['Potential Buyers',progress?.potentialMatches||progress?.productMatches],['Qualified this scan',progress?.outreachCandidates]].map(([k,v])=><div key={String(k)} className="rounded-lg bg-[#161C25] px-3 py-2"><p className="text-sm font-mono text-[#E5E9F0]">{v??'—'}</p><p className="text-[11px] text-[#9AA4B2]">{k}</p></div>)}</div>}
       {(scanBusy || progress?.stage === 'complete') &&reasonText(progress?.failureReasons)&&<p className="text-xs text-[#C9A66B] mt-2">Website failures by reason: {reasonText(progress?.failureReasons)}</p>}
     </div>}
     {scan&&<><div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[['Businesses fetched',scan.stats.businessesFetched],['Websites checked',scan.stats.websitesChecked],['High Relevance',scan.stats.strongMatches],['Potential Buyers',scan.stats.potentialMatches||scan.stats.productMatches]].map(([k,v])=><div key={String(k)} className="rounded-xl bg-[#161C25] p-3"><p className="text-xl font-mono text-[#E5E9F0]">{v}</p><p className="text-xs text-[#9AA4B2]">{k}</p></div>)}</div>
       <p className="text-xs text-[#9AA4B2] mt-4">{scan.stats.websitesSucceeded} websites read · {scan.stats.websitesFailed} failed · {scan.stats.strongMatches} High Relevance buyers · {scan.stats.potentialMatches||scan.stats.productMatches} Potential Buyers · {scan.stats.emailsFound} public emails found · {scan.saved.added + scan.saved.updated} buyer records saved</p>
       {reasonText(scan.stats.failureReasons)&&<p className="text-xs text-[#C9A66B] mt-2">Website failures by reason: {reasonText(scan.stats.failureReasons)}</p>}
       {scan.stats.providerCounts&&<p className="text-xs text-[#9AA4B2] mt-2">Listings by provider: {Object.entries(scan.stats.providerCounts).map(([k,v])=>`${k} ${v}`).join(' · ')}{scan.stats.cachedSites?` · ${scan.stats.cachedSites} site checks reused from recent scans`:''}</p>}
       {scan.stats.classCounts&&<p className="text-xs text-[#9AA4B2] mt-2">Classification classes: {Object.entries(scan.stats.classCounts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k.replace(/-/g,' ')} ${v}`).join(' · ')}</p>}
       {scan.stats.rejections&&<div className="grid grid-cols-2 gap-2 text-xs text-[#9AA4B2] mt-4"><span>Unrelated businesses dropped: {scan.stats.rejections.unrelatedCategories}</span><span>Duplicate listings merged: {scan.stats.rejections.duplicateListings??0}</span><span>Website could not be read: {scan.stats.rejections.websiteFailures}</span><span>Site read, not relevant: {scan.stats.rejections.notRelevantAfterCrawl??0}</span><span>Websites not checked (cap): {scan.stats.rejections.websitesNotChecked}</span></div>}
       {scan.warnings?.length>0&&<div className="mt-3 space-y-1">{scan.warnings.map((w,i)=><p key={i} className="text-xs text-[#C9A66B] break-words"><AlertCircle className="h-3 w-3 inline mr-1"/>{w}</p>)}</div>}
       <p className="text-xs text-[#2FBF8F] mt-3 flex items-center gap-1"><CheckCircle2 className="h-4 w-4"/> Scan finished. View all High Relevance and Potential Buyers in the Buyers tab.</p></>}
     {!scan&&!scanBusy&&!error&&progress?.stage!=='complete'&&<p className="text-sm text-[#667085]">Scan results appear here. No mock records.</p>}
    </Card>
   </div>
  </div>
 </div>;
};
