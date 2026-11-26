import type {Lead} from '../types';
export const CSV_COLUMNS=['DATE','SR NO.','CATEGORY','PRODUCT NAME','COMPANY NAME','LOCATION','WEBSITE','EMAIL','CONTACT NO.'];
const CATEGORY_NAMES:Record<string,string>={'Singing Bowls':'Wellness & Meditation Products','Home Decor':'Home Decor','Brass Lamps':'Metal Handicrafts','Handcrafted Accents':'Handicrafts'};
export const csvCell=(input:string)=>{let t=String(input??'');if(/^[\s]*[=+@\-\t\r]/.test(t))t="'"+t;return '"'+t.replace(/"/g,'""')+'"'};
const formatSheetDate=(iso:string)=>{const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:String(iso||'');};
export function buildVerifiedCsv(leads:Lead[],today:string=new Date().toISOString().slice(0,10)):string{
 const rows=leads.map((l,i)=>[formatSheetDate(l.dateAdded||today),String(i+1),CATEGORY_NAMES[l.category]||l.category||'',l.category||'Singing Bowls',l.companyName,`${l.city||''}${l.state?', '+l.state:''}, USA`,l.website||'',l.email||'',l.phone||'']);
 return '\uFEFF'+[CSV_COLUMNS,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
}

export function buildSentOutreachCsv(
 records:Array<{lead_id:string;recipient:string;created_at:string;day?:string}>,
 leads:Lead[]
):string{
 const byId=new Map(leads.map(l=>[l.id,l]));
 const byEmail=new Map(leads.filter(l=>l.email).map(l=>[l.email.toLowerCase(),l]));
 const rows=records.map((r,i)=>{
  const lead=byId.get(r.lead_id)||byEmail.get(String(r.recipient||'').toLowerCase());
  const sentDay=(r.day||String(r.created_at||'').slice(0,10));
  const product=lead?.category||'Singing Bowls';
  const location=lead?[lead.city,lead.state,'USA'].filter(Boolean).join(', '):'';
  return [
   formatSheetDate(sentDay),
   String(i+1),
   CATEGORY_NAMES[product]||product,
   product,
   lead?.companyName||r.recipient,
   location,
   lead?.website||'',
   r.recipient||lead?.email||'',
   lead?.phone||''
  ];
 });
 return '\uFEFF'+[CSV_COLUMNS,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
}