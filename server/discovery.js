import crypto from 'node:crypto';
import {enrichBusinessLeads,summarizeResults} from './email-enrichment.js';
import {scoreBuyer,isBlockedEmail} from './lead-quality.js';
export {scoreBuyer} from './lead-quality.js';

const STATE_ABBR={Alabama:'AL',Alaska:'AK',Arizona:'AZ',Arkansas:'AR',California:'CA',Colorado:'CO',Connecticut:'CT',Delaware:'DE',Florida:'FL',Georgia:'GA',Hawaii:'HI',Idaho:'ID',Illinois:'IL',Indiana:'IN',Iowa:'IA',Kansas:'KS',Kentucky:'KY',Louisiana:'LA',Maine:'ME',Maryland:'MD',Massachusetts:'MA',Michigan:'MI',Minnesota:'MN',Mississippi:'MS',Missouri:'MO',Montana:'MT',Nebraska:'NE',Nevada:'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND',Ohio:'OH',Oklahoma:'OK',Oregon:'OR',Pennsylvania:'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD',Tennessee:'TN',Texas:'TX',Utah:'UT',Vermont:'VT',Virginia:'VA',Washington:'WA','West Virginia':'WV',Wisconsin:'WI',Wyoming:'WY'};
const STATE_CODES=new Map(Object.entries(STATE_ABBR).flatMap(([n,c])=>[[n.toLowerCase(),c],[c.toLowerCase(),c]]));
// Approximate search windows for preset metros; SQL also strictly matches city AND state.
const CITY_CENTERS={
 'houston,tx':[29.76,-95.37],'austin,tx':[30.27,-97.74],'dallas,tx':[32.78,-96.80],'san antonio,tx':[29.42,-98.49],'fort worth,tx':[32.75,-97.33],
 'los angeles,ca':[34.05,-118.24],'san francisco,ca':[37.77,-122.42],'san diego,ca':[32.72,-117.16],'sacramento,ca':[38.58,-121.49],'santa monica,ca':[34.02,-118.49],
 'new york,ny':[40.71,-74.01],'brooklyn,ny':[40.68,-73.94],'manhattan,ny':[40.78,-73.97],'buffalo,ny':[42.89,-78.88],'albany,ny':[42.65,-73.75],
 'sedona,az':[34.87,-111.76],'phoenix,az':[33.45,-112.07],'scottsdale,az':[33.49,-111.93],'tucson,az':[32.22,-110.97],'flagstaff,az':[35.20,-111.65],
 'denver,co':[39.74,-104.99],'boulder,co':[40.02,-105.27],'colorado springs,co':[38.83,-104.82],'fort collins,co':[40.59,-105.08],
 'miami,fl':[25.76,-80.19],'orlando,fl':[28.54,-81.38],'tampa,fl':[27.95,-82.46],'fort lauderdale,fl':[26.12,-80.14],'st. petersburg,fl':[27.77,-82.64],
 'portland,or':[45.52,-122.68],'seattle,wa':[47.61,-122.33],'chicago,il':[41.88,-87.63],'boston,ma':[42.36,-71.06],
 'las vegas,nv':[36.17,-115.14],'nashville,tn':[36.16,-86.78],'atlanta,ga':[33.75,-84.39],'new orleans,la':[29.95,-90.07]
};
const geocache=new Map();
const envInt=(name,defaultValue,min=1,max=20000)=>Math.max(min,Math.min(max,Number.parseInt(process.env[name]||defaultValue,10)||defaultValue));
const envIntZ=(name,def,max=20000)=>{const raw=process.env[name];if(raw===undefined||raw==='')return def;const n=Number.parseInt(raw,10);return Number.isFinite(n)?Math.max(0,Math.min(max,n)):def;};
const quote=s=>"'"+String(s).replace(/'/g,"''")+"'";
const first=a=>Array.isArray(a)?String(a[0]||''):String(a||'');
export function normalizeUrl(s){if(!s)return '';try{const u=new URL(/^https?:\/\//i.test(s)?s:'https://'+s);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:''}catch{return ''}}
export function locationMatches(row,city,state) {
 const c=String(row.city||'').trim().toLowerCase(),want=String(city).trim().toLowerCase();
 const s=String(row.state||'').trim().toLowerCase(),code=STATE_CODES.get(String(state).trim().toLowerCase());
 return c===want&&(!s||s===String(state).toLowerCase()||s===code?.toLowerCase()||s==='us-'+code?.toLowerCase());
}
export function normalizeCandidate(raw,source,city,state,product='Singing Bowls') {
 const companyName=String(raw.companyName||raw.name||'').trim();
 const website=normalizeUrl(first(raw.websites||raw.website));
 const email=first(raw.emails||raw.email).trim().toLowerCase();
 const category=String(raw.category||raw.kind||'').trim();
 return {companyName,website,email:isBlockedEmail(email)?'':email,phone:first(raw.phones||raw.phone).trim(),city:String(raw.city||raw.locality||city||'').trim(),state:String(raw.state||raw.region||state||'').trim(),address:String(raw.address||raw.formatted||'').trim(),kind:category,source,sourceId:String(raw.id||raw.place_id||''),score:scoreBuyer({companyName,kind:category},product)};
}
const timedFetch=(url,ms=16000,opts={})=>fetch(url,{...opts,signal:AbortSignal.timeout(ms)}).then(async r=>{if(!r.ok)throw Error(`HTTP ${r.status} from ${new URL(url).hostname}`);return r.json()});
function bboxFromCenter(lat,lng,cityName=''){
 const radius=String(cityName).trim().toLowerCase()==='houston'?0.38:0.22;
 const cosLat=Math.max(0.25,Math.cos((lat*Math.PI)/180));
 const lngRadius=radius/cosLat;
 return {south:lat-radius,north:lat+radius,west:lng-lngRadius,east:lng+lngRadius};
}
export async function geocode(city,state) {
 const cleanCity=String(city||'').trim();
 const cleanState=String(state||'').trim();
 const code=STATE_CODES.get(cleanState.toLowerCase());
 if(!code)throw Object.assign(Error('Unknown US state'),{status:400});
 if(!cleanCity)throw Object.assign(Error('City is required'),{status:400});
 const key=cleanCity.toLowerCase()+','+code.toLowerCase();
 if(geocache.has(key))return geocache.get(key);
 const providerErrors=[];

 // 1. Primary nationwide geocoder: Geoapify (do not restrict type=city, as US boroughs/towns like Juneau AK use county/administrative)
 if(process.env.GEOAPIFY_API_KEY){
  try{
   const p=new URLSearchParams({
    text:`${cleanCity}, ${code}, United States`,
    filter:'countrycode:us',
    format:'json',
    limit:'5',
    apiKey:process.env.GEOAPIFY_API_KEY
   });
   const g=await timedFetch('https://api.geoapify.com/v1/geocode/search?'+p,13000);
   const results=Array.isArray(g?.results)?g.results:[];
   const match=results.find(r=>String(r.state_code||'').toUpperCase()===code)||results[0];
   if(match?.bbox&&Array.isArray(match.bbox)&&match.bbox.length===4){
    const [west,south,east,north]=match.bbox.map(Number);
    const bbox=(east-west<0.08||north-south<0.08)
     ?bboxFromCenter((south+north)/2,(west+east)/2,cleanCity)
     :{west,south,east,north};
    geocache.set(key,bbox);
    return bbox;
   }
   if(match&&Number.isFinite(Number(match.lat))&&Number.isFinite(Number(match.lon))){
    const bbox=bboxFromCenter(Number(match.lat),Number(match.lon),cleanCity);
    geocache.set(key,bbox);
    return bbox;
   }
   providerErrors.push(`Geoapify returned no match for "${cleanCity}, ${code}"`);
  }catch(e){
   providerErrors.push(`Geoapify: ${e.message}`);
  }
 }

 // 2. Preset metro fallback
 const center=CITY_CENTERS[key];
 if(center){
  const bbox=bboxFromCenter(center[0],center[1],cleanCity);
  geocache.set(key,bbox);
  return bbox;
 }

 // 3. Free open-data fallback: Photon (Komoot OSM geocoder, no strict Nominatim 403 block)
 try{
  const pu=new URL('https://photon.komoot.io/api/');
  pu.search=new URLSearchParams({q:`${cleanCity}, ${cleanState}, USA`,limit:'8',lang:'en'}).toString();
  const pg=await timedFetch(pu.href,12000,{headers:{'Accept':'application/json','User-Agent':process.env.NOMINATIM_USER_AGENT||'TradePulseAI/1.0'}});
  const features=Array.isArray(pg?.features)?pg.features:[];
  const stateMatches=features.filter(f=>{
   const props=f?.properties||{};
   const cc=String(props.countrycode||'').toUpperCase();
   const st=String(props.state||'').toLowerCase();
   return (cc==='US'||!cc)&&(st===cleanState.toLowerCase()||STATE_CODES.get(st)===code);
  });
  const pool=stateMatches.length?stateMatches:features;
  const hit=pool.find(f=>['city','town','village','municipality','borough','county','district','locality'].includes(String(f?.properties?.osm_value||f?.properties?.type||'').toLowerCase()))||pool[0];
  if(hit?.properties?.extent&&Array.isArray(hit.properties.extent)&&hit.properties.extent.length===4){
   const [west,north,east,south]=hit.properties.extent.map(Number);
   const bbox=(east-west<0.08||north-south<0.08)
    ?bboxFromCenter((south+north)/2,(west+east)/2,cleanCity)
    :{west,south,east,north};
   geocache.set(key,bbox);
   return bbox;
  }
  if(hit?.geometry?.coordinates&&hit.geometry.coordinates.length>=2){
   const [lng,lat]=hit.geometry.coordinates.map(Number);
   const bbox=bboxFromCenter(lat,lng,cleanCity);
   geocache.set(key,bbox);
   return bbox;
  }
 }catch(e){
  providerErrors.push(`Photon: ${e.message}`);
 }

 // 4. Secondary open-data fallback: Nominatim
 try{
  const u=new URL('https://nominatim.openstreetmap.org/search');
  u.search=new URLSearchParams({city:cleanCity,state:cleanState,country:'United States',format:'jsonv2',limit:'1',countrycodes:'us'}).toString();
  const g=await timedFetch(u.href,14000,{headers:{'Accept':'application/json','Accept-Language':'en-US,en','User-Agent':process.env.NOMINATIM_USER_AGENT||'TradePulseAI/1.0 (https://github.com/tradepulse-ai)'}});
  const f=Array.isArray(g)?g[0]:null;
  if(f?.boundingbox){
   const [south,north,west,east]=f.boundingbox.map(Number);
   const bbox={south,north,west,east};
   geocache.set(key,bbox);
   return bbox;
  }
 }catch(e){
  providerErrors.push(`Nominatim: ${e.message}`);
 }

 const detail=providerErrors.length?` (${providerErrors.join('; ')})`:'';
 throw Object.assign(Error(`Could not geocode ${cleanCity}, ${code}${detail}. Verify the city spelling or check GEOAPIFY_API_KEY.`),{status:422});
}
function splitBbox(bbox,grid){const out=[];for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){const dy=(bbox.north-bbox.south)/grid,dx=(bbox.east-bbox.west)/grid;out.push({south:bbox.south+y*dy,north:bbox.south+(y+1)*dy,west:bbox.west+x*dx,east:bbox.west+(x+1)*dx});}return out;}
// Overture places carry taxonomy.primary, taxonomy.hierarchy (general -> specific) and taxonomy.alternates (schema v2, 2026-09+).
// All three are matched (snake_case -> spaces) so a gift shop whose PRIMARY is generic but whose hierarchy/alternates mention
// spiritual / religious / craft categories is still found. Studio terms are only added when studio prospects are enabled.
import os from 'node:os';
import path from 'node:path';

function sqlCategoryFilter(product){
 const studios=envIntZ('MAX_STUDIO_CHECKS_PER_SCAN',100,1000)>0;
 const customWords=String(product||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>=3 && !['and','for','the','with','from'].includes(w));
 const terms=product==='Singing Bowls'?
  ['singing bowl','sound bowl','himalayan','tibetan','nepal','sound healing','metaphysical','new age','crystal','incense','gift','handicraft','artisan','spiritual','meditation supplies','ethnic','import','wholesale','distribut','religious goods',...(studios?['yoga','meditation','sound bath','sound therapy','reiki','breathwork']:[])]:
  [...new Set([...customWords,'home decor','handicraft','artisan','gift','brass','metalware','home furnishings','import','wholesale'])];
 const primaryKind="replace(lower(coalesce(taxonomy.primary,'')),'_',' ')";
 const altKind="replace(lower(coalesce(array_to_string(taxonomy.hierarchy,' '),'')||' '||coalesce(array_to_string(taxonomy.alternates,' '),'')),'_',' ')";
 const name="lower(coalesce(names.primary,''))";
 const includePart='('+terms.map(t=>`${primaryKind} LIKE '%${t}%' OR ${name} LIKE '%${t}%' OR ${altKind} LIKE '%${t}%'`).join(' OR ')+')';
 const excludeTerms=['restaurant','food','cafe','diner','bistro','bakery','seafood','meat','produce','beverage','liquor','wine','beer','dentist','dental','school','academy','university','college','church','synagogue','mosque','security','contractor','plumb','roofing','pest','salon','barber','clinic','hospital','auto'];
 const excludePart='('+excludeTerms.map(t=>`${primaryKind} NOT LIKE '%${t}%' AND ${name} NOT LIKE '%${t}%'`).join(' AND ')+')';
 return `(${includePart} AND ${excludePart})`;
}
const SQL_PRIORITY=`CASE WHEN lower(names.primary) LIKE '%singing bowl%' OR lower(names.primary) LIKE '%sound bowl%' THEN 0 WHEN lower(names.primary) LIKE '%tibetan%' OR lower(names.primary) LIKE '%himalayan%' OR lower(names.primary) LIKE '%nepal%' OR lower(names.primary) LIKE '%metaphysical%' THEN 1 WHEN lower(names.primary) LIKE '%crystal%' OR lower(names.primary) LIKE '%new age%' OR lower(names.primary) LIKE '%spiritual%' OR lower(names.primary) LIKE '%import%' OR lower(names.primary) LIKE '%wholesale%' THEN 2 WHEN lower(names.primary) LIKE '%yoga%' OR lower(names.primary) LIKE '%wellness%' OR lower(names.primary) LIKE '%reiki%' OR lower(names.primary) LIKE '%breathwork%' THEN 4 ELSE 3 END`;
export async function overtureCandidates({city,state,bbox,category,onProgress=()=>{}}) {
 if(process.env.ENABLE_OVERTURE==='false')return {records:[],warning:'Overture disabled by ENABLE_OVERTURE=false'};
 let DuckDBInstance;try{({DuckDBInstance}=await import('@duckdb/node-api'));}catch{return {records:[],warning:'DuckDB not installed. Run npm install in server/.'};}
 const release=process.env.OVERTURE_RELEASE||'2026-11-18.0';if(!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(release))throw Error('Invalid OVERTURE_RELEASE');
 const code=STATE_CODES.get(state.toLowerCase());
 const grid=envInt('OVERTURE_GRID',1,1,4),rowLimit=envInt('OVERTURE_ROWS_PER_TILE',1500,100,5000);
 const memLimitMB=envInt('OVERTURE_MEMORY_MB',2048,512,6144);
 const unlocalized=process.env.OVERTURE_INCLUDE_UNLOCALIZED==='true';
 const localityOk=`lower(addresses[1].locality)=${quote(city.toLowerCase())}`+(unlocalized?' OR addresses[1].locality IS NULL':'');
 const regionOk=`lower(addresses[1].region) IN (${quote('us-'+code.toLowerCase())},${quote(code.toLowerCase())},${quote(state.toLowerCase())})`+(unlocalized?' OR addresses[1].region IS NULL':'');
 const instance=await DuckDBInstance.create(':memory:');const conn=await instance.connect(),records=[],seenIds=new Set(),truncated=[];
 try{
  const localSource=process.env.OVERTURE_LOCAL_PARQUET; // test/offline override only
  const tempDir=quote(path.join(os.tmpdir(),'tradepulse-duckdb'));
  const pragmas=[
   `SET memory_limit='${memLimitMB}MB'`,
   `SET temp_directory=${tempDir}`,
   `SET preserve_insertion_order=false`,
   `SET enable_external_file_cache=false`,
   `SET threads=2`
  ];
  if(!localSource){
   pragmas.push("INSTALL httpfs","LOAD httpfs","SET s3_region='us-west-2'","SET http_keep_alive=false");
  }
  await conn.run(pragmas.join('; ')+';');
  const source=localSource?quote(localSource):`'s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*'`;
  let done=0;const tiles=splitBbox(bbox,grid);
  for(const tile of tiles){
   const sql=`SELECT id,names.primary AS name,taxonomy.primary AS kind,addresses[1].freeform AS address,addresses[1].locality AS city,addresses[1].region AS state,websites[1] AS website,phones[1] AS phone,emails[1] AS email,${SQL_PRIORITY} AS prio FROM read_parquet(${source},hive_partitioning=1) WHERE bbox.xmin<=${tile.east} AND bbox.xmax>=${tile.west} AND bbox.ymin<=${tile.north} AND bbox.ymax>=${tile.south} AND names.primary IS NOT NULL AND websites IS NOT NULL AND operating_status IS DISTINCT FROM 'permanently_closed' AND (${localityOk}) AND (${regionOk}) AND ${sqlCategoryFilter(category)} LIMIT ${rowLimit}`;
   const rows=(await conn.runAndReadAll(sql)).getRowObjects();
   rows.sort((a,b)=>(a.prio!=null?Number(a.prio):3)-(b.prio!=null?Number(b.prio):3)||String(a.name||'').localeCompare(String(b.name||'')));
   if(rows.length>=rowLimit)truncated.push(done+1);
   for(const row of rows){if(row.id&&seenIds.has(row.id))continue;if(row.id)seenIds.add(row.id);records.push(normalizeCandidate(row,'Overture Maps',city,state,category));}
   onProgress({stage:'overture',stageDetail:`Overture tile ${++done}/${tiles.length}`,listingsFetched:records.length,tilesDone:done,tilesTotal:tiles.length});
  }
  return {records,warning:truncated.length?`tile(s) ${truncated.join(', ')} reached OVERTURE_ROWS_PER_TILE=${rowLimit}. Raise OVERTURE_ROWS_PER_TILE or OVERTURE_GRID if needed.`:''};
 }finally{try{conn.closeSync?.()}catch{}try{instance.closeSync?.()}catch{}}
}
export async function geoapifyCandidates({city,state,bbox,category,onProgress=()=>{}}) {
 if(!process.env.GEOAPIFY_API_KEY)return {records:[],warning:''};
 // Geoapify categories are hierarchical and validated server-side; override with GEOAPIFY_CATEGORIES if the provider's list changes.
 const categories=process.env.GEOAPIFY_CATEGORIES||(category==='Singing Bowls'?'commercial.gift_and_souvenir,commercial.antiques,commercial.jewelry,commercial.books,commercial.houseware_and_hardware':'commercial.gift_and_souvenir,commercial.antiques,commercial.furniture_and_interior');
 const warnings=[];
 const pages=envInt('GEOAPIFY_PAGES_PER_SCAN',3,1,5),records=[];
 for(let page=0;page<pages;page++){
  const params=new URLSearchParams({categories,filter:`rect:${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,limit:'300',offset:String(page*300),apiKey:process.env.GEOAPIFY_API_KEY});
  let data;try{data=await timedFetch('https://api.geoapify.com/v2/places?'+params,20000);}catch(e){
   if(/HTTP 400/.test(e.message)&&categories!=='commercial.gift_and_souvenir'){warnings.push('Geoapify rejected the category list; retried with commercial.gift_and_souvenir only (set GEOAPIFY_CATEGORIES).');params.set('categories','commercial.gift_and_souvenir');data=await timedFetch('https://api.geoapify.com/v2/places?'+params,20000);}
   else throw e;}
  if(page>0)await new Promise(r=>setTimeout(r,1100)); // stay well inside free-tier rate limits
  const features=data.features||[];
  records.push(...features.map(f=>{const p=f.properties||{},raw=p.datasource?.raw||{};return normalizeCandidate({name:p.name,website:p.website||p.contact?.website||raw.website||raw['contact:website'],email:p.contact?.email||raw.email||raw['contact:email'],phone:p.contact?.phone||raw.phone||raw['contact:phone'],address:p.formatted,city:p.city||raw['addr:city']||city,state:p.state_code||state,category:(p.categories||[]).join(' '),id:p.place_id},'Geoapify / OpenStreetMap',city,state,category)}));
  onProgress({stage:'geoapify',stageDetail:`Geoapify page ${page+1}/${pages}`,geoapifyFetched:records.length});
  if(features.length<300)break;
 }
 return {records,warning:warnings.join(' ')};
}
let lastOverpass=0;
const OVERPASS_ENDPOINTS=[
 'https://overpass-api.de/api/interpreter',
 'https://overpass.kumi.systems/api/interpreter'
];
export async function overpassCandidates({city,state,bbox,category}) {
 if(process.env.ENABLE_OVERPASS!=='true')return {records:[],warning:''};
 if(Date.now()-lastOverpass<60000)return {records:[],warning:'Overpass rate limit: wait at least 60 seconds between scans.'};
 lastOverpass=Date.now();
 const s=Number(bbox.south).toFixed(4),w=Number(bbox.west).toFixed(4),n=Number(bbox.north).toFixed(4),e=Number(bbox.east).toFixed(4);
 const query=`[out:json][timeout:25];(node["shop"~"^(gift|craft|jewelry|art|interior_decoration|religion|antiques|esoteric|houseware|books)$"](${s},${w},${n},${e});way["shop"~"^(gift|craft|jewelry|art|interior_decoration|religion|antiques|esoteric|houseware|books)$"](${s},${w},${n},${e}););out center 500;`;
 const body=new URLSearchParams({data:query}).toString();
 const endpoints=process.env.OVERPASS_URL?[process.env.OVERPASS_URL]:OVERPASS_ENDPOINTS;
 let json=null,lastErr=null;
 for(const endpoint of endpoints){
  try{
   const res=await fetch(endpoint,{
    method:'POST',
    signal:AbortSignal.timeout(30000),
    headers:{
     'Accept':'application/json',
     'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8',
     'User-Agent':process.env.NOMINATIM_USER_AGENT||'TradePulseAI/1.0 (business-research)'
    },
    body
   });
   if(!res.ok){
    const errText=(await res.text().catch(()=>'')).slice(0,180).replace(/\s+/g,' ');
    throw Error(`Overpass HTTP ${res.status}${errText?`: ${errText}`:''}`);
   }
   json=await res.json();
   break;
  }catch(err){
   lastErr=err;
   if(!/HTTP (?:406|429|502|503|504)|timeout|fetch failed/i.test(String(err?.message||'')))throw err;
  }
 }
 if(!json)throw lastErr||Error('Overpass request failed');
 return {records:(json.elements||[]).map(x=>{const t=x.tags||{};return normalizeCandidate({id:x.type+'/'+x.id,name:t.name,website:t.website||t['contact:website'],email:t.email||t['contact:email'],phone:t.phone||t['contact:phone'],city:t['addr:city']||city,state:t['addr:state']||state,kind: t.shop==='gift'?'gift_shop':t.shop==='craft'?'handicraft_store':t.shop==='art'?'art_gallery':t.shop||t.amenity||t.craft},'OpenStreetMap / Overpass',city,state,category)}),warning:''};
}
export async function tomtomCandidates({city,state,bbox,category,onProgress=()=>{}}) {
 if(!process.env.TOMTOM_API_KEY)return {records:[],warning:''};
 const queries=category==='Singing Bowls'
  ?['singing bowl','metaphysical store','crystal shop','tibetan gift','handicraft store','gift shop','sound healing','spiritual store']
  :[...new Set([String(category||'').trim().toLowerCase(),'handicraft store','home decor','gift shop','brassware','artisan shop'].filter(Boolean))];
 const records=[],seen=new Set();
 for(let i=0;i<queries.length;i++){
  const q=queries[i];
  const u=new URL(`https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json`);
  u.search=new URLSearchParams({
   key:process.env.TOMTOM_API_KEY,
   countrySet:'US',
   topLeft:`${bbox.north},${bbox.west}`,
   btmRight:`${bbox.south},${bbox.east}`,
   limit:'100'
  }).toString();
  const data=await timedFetch(u.href,15000);
  for(const item of (data.results||[])){
   if(!item.id||seen.has(item.id))continue;
   seen.add(item.id);
   const poi=item.poi||{},addr=item.address||{};
   records.push(normalizeCandidate({
    id:item.id,
    name:poi.name,
    website:poi.url,
    phone:poi.phone,
    address:addr.freeformAddress,
    city:addr.municipality||city,
    state:addr.countrySubdivision||state,
    category:(poi.categories||[]).join(' ')
   },'TomTom Places',city,state,category));
  }
  onProgress({stage:'tomtom',stageDetail:`TomTom query ${i+1}/${queries.length}`,tomtomFetched:records.length});
  await new Promise(r=>setTimeout(r,220));
 }
 return {records,warning:''};
}
function qualify(records,city,state){
 const byDomain=new Map(),minScore=1; // pools (retail vs studio) and thresholds are applied in discoverBuyers
 for(const row of records){
  if(!row.companyName||!row.website||!locationMatches(row,city,state)||row.score<minScore)continue;
  let domain;try{domain=new URL(row.website).hostname.toLowerCase().replace(/^www\./,'')}catch{continue}
  if(/(?:^|\.)(?:facebook|instagram|tiktok|linkedin|google|youtube)\.com$/.test(domain))continue;
  const old=byDomain.get(domain);if(!old){byDomain.set(domain,row);continue;}
  const preferred=row.score>old.score?row:old,alternate=preferred===row?old:row;
  byDomain.set(domain,{...preferred,email:preferred.email||alternate.email,phone:preferred.phone||alternate.phone,address:preferred.address||alternate.address});
 }
 return [...byDomain.values()].sort((a,b)=>b.score-a.score||a.companyName.localeCompare(b.companyName));
}
export function makeLead(r,category){
 const domain=new URL(r.website).hostname.toLowerCase().replace(/^www\./,'');
 const seller=['confirmed-seller','wholesale-evidence'].includes(r.evidenceClass);
 return {
  id:'lead-real-'+crypto.createHash('sha256').update(domain).digest('hex').slice(0,24),
  companyName:r.companyName,contactName:'',title:'',source:r.source,category,
  persona:seller?'Retailers / suppliers':r.evidenceClass==='equipment-user'?'Potential equipment purchaser (service business)':r.evidenceClass==='adjacent-retailer'?'Specialty / adjacent retailer':'Research prospect',city:r.city,state:r.state,country:'United States',
  phone:r.phone||'',email:r.email||'',website:r.website,buyerTier:(r.evidenceClass==='adjacent-retailer'&&r.buyerTier==='Research')?'Potential':r.buyerTier,buyerEvidence:r.buyerEvidence||'',
  evidenceClass:r.evidenceClass||'unverified-site',evidenceRank:r.evidenceRank||0,classificationReason:r.classificationReason||r.buyerEvidence||'',
  evidenceExcerpt:r.evidenceExcerpt||'',evidenceUrl:r.evidenceUrl||'',productSignal:r.productSignal||'none',
  websiteStatus:r.websiteVerified?'checked':'unreachable',websiteFailureReason:r.failureReason||'',websiteFinalUrl:r.finalUrl||'',
  emailSourceUrl:r.emailSourceUrl||'',emailSourceType:r.emailSourceType||'',emailDomainCheck:r.emailDomainCheck||'unchecked',emailVerification:r.email?(r.emailVerification||'Listed publicly; mailbox not verified'):'',emailStatus:r.email?'Public / unverified':'Missing',
  aiClassification:'Not run',reviewed:false,
  outreachStatus:'Not Contacted',callStatus:'Pending',isDuplicate:false,
  notes:`${r.source}; ${r.kind||''}; ${r.address||''}; Email deliverability and purchasing intent are not verified.${r.websiteVerified?'':` Website not checked: ${r.failureReason||'unknown'}.`}`,
  dateAdded:new Date().toISOString().slice(0,10)
 };
}
/** Each progress event is a truthful snapshot; percentage is not fabricated. */
function dedupeByFinalDomain(rows){
 const map=new Map();
 for(const r of rows){
  let key;try{key=new URL(r.finalUrl||r.website).hostname.toLowerCase().replace(/^www\./,'')}catch{key=r.website}
  const old=map.get(key);
  if(!old){map.set(key,r);continue;}
  const better=(r.evidenceRank||0)>(old.evidenceRank||0)||((r.evidenceRank||0)===(old.evidenceRank||0)&&(r.score||0)>(old.score||0))?r:old,other=better===r?old:r;
  map.set(key,{...better,email:better.email||other.email,phone:better.phone||other.phone});
 }
 return [...map.values()];
}
const byEvidence=(a,b)=>(b.evidenceRank||0)-(a.evidenceRank||0)||(b.score||0)-(a.score||0)||a.companyName.localeCompare(b.companyName);
export async function discoverBuyers({category='Singing Bowls',city='Houston',state='Texas',persona=[],maxLeads}={},providers={},onProgress=()=>{}) {
 if(!city||!state||!category)throw Object.assign(Error('City, state and product required'),{status:400});
 if(!STATE_CODES.has(state.toLowerCase()))throw Object.assign(Error('Unknown US state'),{status:400});
 const limit=Math.min(5000,Math.max(1,Number(maxLeads)||envInt('MAX_LEADS_PER_SCAN',1800,1,5000)));
 const researchLimit=envInt('MAX_RESEARCH_PER_SCAN',2000,1,10000);
 const inspectLimit=Math.min(envInt('MAX_WEBSITES_PER_SCAN',400,1,2500),limit);
 onProgress({stage:'geocoding',stageDetail:`Finding ${city}, ${state}`,listingsFetched:0,websitesChecked:0,websitesTotal:0});
 const bbox=await(providers.geocode||geocode)(city,state);
 const warnings=[],all=[],providerCounts={};
 for(const [label,fn] of [['Overture',providers.overture||overtureCandidates],['Geoapify',providers.geoapify||geoapifyCandidates],['Overpass',providers.overpass||overpassCandidates],['TomTom',providers.tomtom||tomtomCandidates]]){
  onProgress({stage:label.toLowerCase(),stageDetail:`Querying ${label}`,listingsFetched:all.length});
  try{
   const result=await fn({category,city,state,persona,bbox,onProgress});all.push(...(result.records||[]));providerCounts[label]=(result.records||[]).length;
   if(result.warning)warnings.push(`${label}: ${result.warning}`);
   onProgress({stage:label.toLowerCase(),stageDetail:`${label} finished`,listingsFetched:all.length});
  }catch(e){warnings.push(`${label}: ${e.message}`);}
 }
 onProgress({stage:'screening',stageDetail:'Deduplicating and rejecting unrelated business categories',listingsFetched:all.length});
 const candidates=qualify(all,city,state);
 const scoredRows=all.filter(r=>r.companyName&&r.website&&locationMatches(r,city,state)&&r.score>=1).length;
 const duplicateListings=Math.max(0,scoredRows-candidates.length);
 // Two pools. RETAIL/specialist listings (score >= 50) are always inspected first, best category first. STUDIO / practitioner listings
 // (score < 50: yoga, sound-bath, meditation) are low-priority research prospects: they only use leftover capacity, capped separately.
 const retailMin=envInt('MIN_LISTING_SCORE',50,1,100),studioCap=envIntZ('MAX_STUDIO_CHECKS_PER_SCAN',100,1000);
 const retailPool=candidates.filter(r=>r.score>=50&&r.score>=retailMin),studioPool=candidates.filter(r=>r.score<50);
 const retailSel=retailPool.slice(0,inspectLimit),studioSel=studioPool.slice(0,Math.min(studioCap,Math.max(0,inspectLimit-retailSel.length)));
 const selected=[...retailSel,...studioSel];
 const belowThreshold=candidates.length-retailPool.length-studioPool.length;
 // Reuse recent site checks (repeat scans, recovery after an interrupted scan). Transient failures are never cached.
 const cache=providers.cache,cached=[],toCrawl=[];
 for(const lead of selected){
  const hit=cache?.get?.(lead.website,category);
  if(hit)cached.push({...hit,companyName:lead.companyName,kind:lead.kind,score:lead.score,source:lead.source,city:lead.city,state:lead.state,address:lead.address,phone:lead.phone||hit.phone||'',website:lead.website,sourceId:lead.sourceId,fromCache:true});
  else toCrawl.push(lead);
 }
 const cachedSummary=summarizeResults(cached);
 onProgress({stage:'inspecting',stageDetail:cached.length?`Reusing ${cached.length} recent site checks; crawling ${toCrawl.length}`:'Checking first-party websites for real product evidence',listingsFetched:all.length,providerCounts,categoryProspects:candidates.length,relevantWithWebsite:candidates.length,cachedSites:cached.length,websitesChecked:cached.length,websitesTotal:selected.length,...cachedSummary,websitesChecked:cached.length});
 const n=x=>Number(x)||0;
 const merge=v=>({websitesChecked:n(v.websitesChecked)+cachedSummary.websitesChecked,websitesTotal:selected.length,websitesSucceeded:n(v.websitesSucceeded)+cachedSummary.websitesSucceeded,websitesFailed:n(v.websitesFailed)+cachedSummary.websitesFailed,failureReasons:Object.entries(cachedSummary.failureReasons).reduce((m,[k,c])=>({...m,[k]:(m[k]||0)+c}),{...(v.failureReasons||{})}),jsRenderedSites:n(v.jsRenderedSites)+cachedSummary.jsRenderedSites,emailsFound:n(v.emailsFound)+cachedSummary.emailsFound,emailsRejected:n(v.emailsRejected)+cachedSummary.emailsRejected,productMatches:n(v.productMatches)+cachedSummary.productMatches,strongMatches:n(v.strongMatches)+cachedSummary.strongMatches,outreachCandidates:n(v.outreachCandidates)+cachedSummary.outreachCandidates,cachedSites:cached.length});
 const crawled=toCrawl.length?await(providers.enrich||enrichBusinessLeads)(toCrawl,{product:category,concurrency:envInt('WEBSITE_CONCURRENCY',14,1,24),inspectOptions:{minAdjacentScore:envInt('MIN_ADJACENT_SCORE',70,1,100)},onProgress:values=>{const m=merge(values);onProgress({stage:'inspecting',stageDetail:`Checked ${m.websitesChecked}/${selected.length} websites`,providerCounts,categoryProspects:candidates.length,...m});}}):[];
 if(cache?.set)for(const r of crawled)try{cache.set(r.website,category,r);}catch{}
 const enrichedRaw=[...cached,...crawled];
 const enriched=dedupeByFinalDomain(enrichedRaw);
 const includeAdjacent=process.env.INCLUDE_ADJACENT_BUYERS!=='false';
 const productMatches=enriched.filter(r=>r.websiteVerified&&(['Strong match','Potential'].includes(r.buyerTier)||(includeAdjacent&&r.evidenceClass==='adjacent-retailer')));
 const eligible=productMatches.filter(r=>r.email&&!isBlockedEmail(r.email)).sort(byEvidence);
 const maxEquipment=envIntZ('MAX_EQUIPMENT_USER_LEADS',100,5000);let equipmentKept=0,equipmentOverCap=0;
 const leads=[];
 for(const r of eligible){
  if(leads.length>=limit)break;
  if(r.evidenceClass==='equipment-user'){if(equipmentKept>=maxEquipment){equipmentOverCap++;continue;}equipmentKept++;}
  leads.push(makeLead(r,category));
 }
 const readyIds=new Set(leads.map(r=>r.id));
 const research=enriched.filter(r=>!readyIds.has(makeLead(r,category).id)&&(r.websiteVerified?['Potential','Research','Strong match'].includes(r.buyerTier):(r.score||0)>=70))
  .sort(byEvidence).slice(0,researchLimit).map(r=>makeLead(r,category));
 const classCounts={};for(const r of enriched){const k=r.websiteVerified?(r.evidenceClass||'not-relevant'):'unverified-site';classCounts[k]=(classCounts[k]||0)+1;}
 const kindCounts={};for(const r of all){const k=r.kind||'(none)';kindCounts[k]=(kindCounts[k]||0)+1;}
 const taxonomyBreakdown=Object.entries(kindCounts).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([kind,count])=>({kind,count}));
 const failures=enriched.filter(r=>!r.websiteVerified),failureReasons={};
 for(const r of failures){const k=r.failureReason||'unknown';failureReasons[k]=(failureReasons[k]||0)+1;}
 const failedWebsite=failures.length;
 const noProductEvidence=enriched.filter(r=>r.websiteVerified&&['Research','Not relevant','Unverified'].includes(r.buyerTier)).length;
 const missingEmail=productMatches.filter(r=>!r.email||isBlockedEmail(r.email)).length;
 const skippedWebsites=Math.max(0,retailPool.length-retailSel.length)+Math.max(0,studioPool.length-studioSel.length);
 const emailsFound=enriched.filter(r=>r.email&&!isBlockedEmail(r.email)).length;
 const jsRenderedSites=enriched.filter(r=>r.websiteVerified&&r.rendering==='js_shell').length;
 if(!all.length)warnings.push('No businesses returned; check provider/network status or try a different city.');
 if(skippedWebsites)warnings.push(`${skippedWebsites} relevant listing websites were not checked in this scan; increase MAX_WEBSITES_PER_SCAN if your computer/network can handle more.`);
 if(failedWebsite){const top=Object.entries(failureReasons).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k,v])=>`${k}: ${v}`).join(', ');warnings.push(`${failedWebsite} of ${enriched.length} websites could not be read (${top}).`);}
 if(jsRenderedSites)warnings.push(`${jsRenderedSites} websites are JavaScript-rendered; their product pages cannot be read without a browser and are marked unverified.`);
 onProgress({stage:'complete',stageDetail:'Scan finished',listingsFetched:all.length,providerCounts,cachedSites:cached.length,categoryProspects:candidates.length,websitesChecked:enriched.length,websitesTotal:enriched.length,websitesSucceeded:enriched.length-failedWebsite,websitesFailed:failedWebsite,failureReasons,productMatches:productMatches.length,strongMatches:leads.filter(r=>r.buyerTier==='Strong match').length,potentialMatches:leads.filter(r=>r.buyerTier==='Potential').length,emailsFound,outreachCandidates:leads.filter(r=>r.email&&!isBlockedEmail(r.email)).length,totalBuyers:leads.length,saved:leads.length,qualified:leads.length,research:research.length});
 return {leads,research,stats:{businessesFetched:all.length,providerCounts,taxonomyBreakdown,classCounts,cachedSites:cached.length,studioProspects:studioPool.length,studioChecked:studioSel.length,relevantWithWebsite:candidates.length,specialistListings:candidates.filter(r=>r.score>=90).length,websitesChecked:enriched.length,websitesSucceeded:enriched.length-failedWebsite,websitesFailed:failedWebsite,failureReasons,jsRenderedSites,emailsFound,productMatches:productMatches.length,outreachReady:leads.filter(r=>r.email&&!isBlockedEmail(r.email)).length,strongMatches:leads.filter(r=>r.buyerTier==='Strong match').length,potentialMatches:leads.filter(r=>r.buyerTier==='Potential').length,researchCandidates:research.length,rejections:{unrelatedCategories:Math.max(0,all.length-scoredRows),duplicateListings,belowCategoryThreshold:belowThreshold,websiteFailures:failedWebsite,missingProductEvidence:noProductEvidence,notRelevantAfterCrawl:classCounts['not-relevant']||0,studioNotSeller:classCounts['studio-retail']||0,mentionOnly:classCounts['mention-only']||0,missingEmails:missingEmail,invalidEmailDomains:enriched.reduce((n,r)=>n+(r.rejectedEmailCount||0),0),equipmentUserOverCap:equipmentOverCap,websitesNotChecked:skippedWebsites}},warnings,source:'Overture + optional Geoapify / Overpass',limits:{maxLeads:limit,websiteChecks:inspectLimit,maxResearch:researchLimit}};
}
