/**
 * Product-specific prospect screening. A product mention is NEVER treated as buying intent.
 * Evidence classes (not probabilities):
 *   confirmed-seller   product term + transactional markers (price / add-to-cart / stock / product schema / "shop our ...") on a non-studio business
 *   wholesale-evidence product term + wholesale / trade / distributor wording on a non-studio business
 *   retailer-mention   product term on a retail-type business, no transactional marker (availability unconfirmed)
 *   equipment-user     business describes (first person) offering sound-healing sessions / using the instruments; purchasing intent NOT verified
 *   studio-retail      product term with transactional markers, but the business is a studio / service
 *   mention-only       product only mentioned, no evidence of selling, buying or using it
 *   adjacent-retailer  specialty retail category, no product evidence found
 *   not-relevant       nothing relevant found
 */
const NO_FIT = /\b(?:church|ministr(?:y|ies)|mosque|synagogue|elementary school|high school|middle school|preschool|college|university|hospital|dentist|dental|doctor|medical clinic|urgent care|law firm|attorney|legal|insurance|auto repair|automotive|car dealership|car rental|tire shop|plumb(?:ing|er)|electric(?:ian|al)|roofing|contractor|construction|hvac|clean(?:ing|ers)|pest control|landscap(?:ing|er)|hair salon|nail salon|barber|tattoo|piercing|event planning|party planner|wedding planner|social club|youth committee|government|security|guards?|cctv|restaurant|cafe|cafeteria|bistro|bar & grill|bar and grill|diner|eatery|bakery|pizzeria|food truck|food stand|buffet|pub|brewery|winery|distillery|wine and spirits|liquor|grocery|supermarket|meat market|seafood|produce|convenience store|pharmacy|leeches|music school|piano (?:gallery|store|shop)|violin (?:shop|store)|guitar (?:shop|store)|guitars?|saxophone|accordions?|horn shop|puppy yoga|volleyball|non-profit|nonprofit|civic|real[\s_-]?estate|realtor|broker|homeless|shelter|carpet|flooring|hardware|appliance|mobile phone|auto parts|auto dealer|lumber|tile store|smoke|vape|oil|chemical|seal|tiling|packaging|fence|mattress|pool cleaning|shipping|scaffold|scaffolding|rebar|nail supply|blinds?|shades?|lock supply|warehouse club|industrial|storage|facility|building supply|electronics|roofing supply|distribution center|medical supply|rubber|plastics|advertising|graphic|vitamin|creamery|paper product|boots?|shoes?|hats?|caps?|embroidery|record label)\b/i;
export const BOWL = /\b(?:singing[\s_-]*bowls?|sound[\s_-]*bowls?|tibetan[\s_-]*bowls?|himalayan[\s_-]*bowls?|crystal[\s_-]*singing[\s_-]*bowls?|(?:tibetan|himalayan|nepal(?:ese)?|meditation|chakra)[\s-]+(?:[a-z]+[\s-]+){0,2}bowls?|sound[\s_-]*healing[\s_-]*(?:instruments?|tools?|supplies|equipment))\b/ig;
const SELLERS = /\b(?:metaphysical|new[\s_-]?age|crystal[\s_-]?(?:shop|store)|incense[\s_-]?(?:shop|store)|spiritual[\s_-]?(?:shop|store|supplies)|meditation[\s_-]?(?:supplies|shop|store)|gift[\s_-]?(?:shop|store|and[\s_-]souvenir)|handicraft|artisan[\s_-]?(?:shop|store)|ethnic[\s_-]?(?:shop|store)|import(?:er|s|ing)?|wholesale|distribut(?:or|ion)|religious[\s_-]?goods|instrument[\s_-]?(?:store|shop)|home[\s_-]?decor[\s_-]?(?:shop|store))\b/i;
// Priority specialty buyer categories that plausibly stock or distribute Indian singing bowls / handicrafts
const SPECIALTY_BUYER_CATEGORY = /\b(?:metaphysical|new[\s_-]?age|tibetan|nepal(?:ese)?|himalayan|spiritual|meditation supplies|crystal[\s_-]?(?:shop|store)|incense[\s_-]?(?:shop|store)|handicraft|artisan|ethnic[\s_-]?(?:shop|store)|sound[\s_-]?healing)\b/i;
const RELEVANT_COMMERCIAL_FIT = /\b(?:import(?:er|s|ing)?|wholesale|distribut(?:or|ion)|religious[\s_-]?goods|home[\s_-]?decor|gift[\s_-]?(?:shop|store)|cultural[\s_-]?goods)\b/i;
// Words indicating commercial activity on website
const COMMERCIAL_ACTIVITY = /\b(?:products?|catalog|shop|store|inventory|our collection|wholesale|trade|distribut(?:or|ion)|retail|stockists?|lines?|goods|showroom|brands?|orders?|purchase)\b/i;
// Transactional markers. Deliberately excludes generic words ("shop", "order", "products", "handmade", "collection").
const CART_CUE = /(?:add[\s_-]*to[\s_-]*(?:cart|bag|basket)|buy[\s_-]*now|in[\s_-]*stock|out[\s_-]*of[\s_-]*stock|sold[\s_-]*out|\bsku\b|\bqty\b|\bquantity\b|select options|choose an option|checkout)/i;
const PRICE_CUE = /(?:\$\s?\d[\d,]*(?:\.\d{2})?|\bUSD\s?\d|\d[\d,]*(?:\.\d{2})?\s?USD)/i;
const SELL_BEFORE = /\b(?:shop|buy|browse|purchase|shopping for|we sell|we carry|we stock|now selling|our selection of|our collection of)\b[^.!?\n]{0,40}$/i;
const SELL_AFTER = /^\s*(?:for sale|available (?:now|online|in)|in stock|from \$)/i;
const WHOLESALE_CUE = /\b(?:wholesale|trade (?:account|pricing|inquir\w*)|bulk (?:order|orders|pricing|discounts?)|distributors?|stockists?|resellers?|dealer inquir\w*|become a (?:retailer|stockist|dealer|reseller)|retailers? (?:program|inquir\w*))\b/i;
const SELL_PATH = /(?:\/products?\/|\/collections?\/|\/shop(?:\/|$|\?)|\/store(?:\/|$|\?)|\/catalog|\/item\/|\/buy)/i;
const EDITORIAL_PATH = /(?:\/blogs?(?:\/|$)|\/news|\/articles?\/|\/journal|\/events?(?:\/|$)|\/classes|\/workshops?|\/sessions?|\/schedule|\/services?(?:\/|$)|\/about|\/history|\/learn|\/faq|\/press|\/retreats?)/i;
// First-person service/use wording only. Third-person phrases ("some guests prefer singing bowls") are just mentions.
const USING_NEAR = /\b(?:our|we|my)\b[^.!?]{0,50}\b(?:sound baths?|sound healing|sound journeys?|sessions?|classes|workshops?|ceremon(?:y|ies)|treatments?|instruments?)\b|\bwe (?:use|play|offer|host|provide|incorporate)\b/i;
const NEGATIVE_NEAR = /\b(?:do not|don't|doesn't|not using|not use|never use|no singing bowls|does not|aren't|not for sale|not available|bring (?:their|your) own|brings? (?:their|your) own|practitioner brings|instead of|without)\b/i;
const NON_BUYER_VERTICAL = /\b(?:yoga|fitness|pilates|gym|reiki|spa|massage|wellness|retreat|puppy|church|school|clinic|therapist)\b/i;
const PLACEHOLDER_DOMAIN = /^(?:domain|yourdomain|yoursite|mysite|mydomain|website|sample|company|email|yourcompany|address)\.(?:com|net|org)$|(?:^|\.)(?:squarespace|shopify|myshopify|wix|wixsite|wordpress|wpengine|godaddy|cloudflare|gstatic|schema|w3|sentry-next)\.(?:com|org|io|net)$/i;
const PLACEHOLDER_LOCAL = /^(?:you|your|yourname|your\.name|name|firstname|lastname|first\.last|user|username|email|someone|test|example|sample|john\.?doe|jane\.?doe|admin@?)$/i;
const NOT_CONTACTABLE = /(?:^|\.)((?:example\.(?:com|org|net))|(?:test|invalid|localhost|mailinator\.com)|(?:ingest\.)?sentry\.io|(?:.*\.)?sentry\.io|(?:.*\.)?wixpress\.com|cloudflareinsights\.com)$/i;
export const EVIDENCE_RANK = {'confirmed-seller':5,'wholesale-evidence':4,'specialty-retailer':4,'commercial-fit':3,'retailer-mention':3,'equipment-user':2,'studio-retail':2,'mention-only':1,'adjacent-retailer':1,'unverified-site':0,'not-relevant':0};
export function isBlockedEmail(value) {
 const email=String(value||'').trim().toLowerCase();
 if(!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(email)||email.length>254)return true;
 const [local,domain]=email.split('@');
 return NOT_CONTACTABLE.test(domain)||PLACEHOLDER_DOMAIN.test(domain)||PLACEHOLDER_LOCAL.test(local)||/^(?:noreply|no-reply|donotreply|support-sentry|error-reporting|tracking|analytics|telemetry|ingest|monitoring)(?:[.\-_]|$)/i.test(local)||/\.(?:png|svg|jpg|jpeg|gif|js|css|webp|pdf)$/i.test(email);
}
/** Listing-category prior (used only to order / filter listings before crawling; NOT a probability). */
export function scoreBuyer(row,product='Singing Bowls') {
 const name=String(row.companyName||'').toLowerCase().replace(/_/g,' ');
 const kind=String(row.kind||row.category||'').toLowerCase().replace(/_/g,' ');
 const both=name+' '+kind;
 if(NO_FIT.test(both))return 0;
 if(/\b(?:food|beverage|produce|seafood|meat|wine|spirits|liquor|beer|restaurant|bistro|cafe|diner|eatery|bakery|curry|tandoori|catering|culinary)\b/i.test(both))return 0;
 if(/musical instrument store/i.test(kind)&&!/(?:singing bowl|tibetan bowl|himalayan bowl|sound healing instrument|metaphysical|crystal shop)/i.test(name))return 0;
 if(product!=='Singing Bowls')return /\b(?:artisan|handicraft|home decor|brass|metalware|gift shop|gift store|interior furnishing|boutique|importer|wholesal)\b/.test(both)?70:0;
 // Generic yoga/fitness/meditation businesses are not a singing-bowl buyer category.
 if(!/(?:singing bowl|himalayan bowl|tibetan bowl|sound healing instrument)/i.test(name)){
  // Studios / practitioners are LOW-priority research prospects (possible equipment users), never product retailers.
  if(/\b(?:pilates|gym|fitness|spa|massage)\b/i.test(both))return 0;
  if(/\b(?:sound bath|sound healing|sound therapy|meditation (?:center|centre|studio))\b/i.test(both))return 40;
  if(/\b(?:yoga|wellness (?:center|centre|studio)|reiki|breathwork)\b/i.test(both))return 30;
 }
 if(/(?:singing bowl|tibetan bowl|himalayan bowl|sound healing instrument)/i.test(name))return 100;
 if(/\b(?:metaphysical|new age|tibetan|himalayan|nepal(?:ese)?|crystal shop|crystal store|spiritual shop|meditation supplies|incense shop|ethnic shop)\b/i.test(both))return 90;
 // Importers / wholesalers / handicraft stores are a priority category; generic gift shops are only an adjacent category.
 if(/\b(?:import(?:er|s|ing)?|wholesale|distribut(?:or|ion)|handicraft|religious goods)\b/i.test(both))return 80;
 if(SELLERS.test(both))return 60;
 return 0;
}
const norm=t=>String(t||'').replace(/\s+/g,' ').slice(0,350000);
function productSchemaEvidence(page, product) {
  const target = String(product || '').trim();

  if (!target) return null;

  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const productRegex = target.toLowerCase() === 'singing bowls'
    ? new RegExp(BOWL.source, 'i')
    : new RegExp(`\\b${escaped}\\b`, 'i');

  for (const p of page.products || []) {
    if (!p.name || !p.hasOffer) continue;

    if (!productRegex.test(String(p.name))) continue;

    return {
      signal: 'sale',
      excerpt: `Product listing (structured data): ${p.name}${p.price ? ' — ' + p.price : ''}`.slice(0, 300),
      url: page.url,
      keyword: p.name,
      why: 'Matching product listing with a commercial offer'
    };
  }

  return null;
}
function evidenceForPage(page,product){
 const schema = productSchemaEvidence(page, product);
 if (schema) return schema;
 const text=norm(page.text);
 const rx=product==='Singing Bowls'?new RegExp(BOWL.source,'gi'):/\b(?:handmade decor|handcrafted home decor|brass lamps?|metalware|indian handicraft)\b/gi;
 const url=page.url||'';
 const editorial=EDITORIAL_PATH.test(url),productPage=SELL_PATH.test(url)&&!editorial;
 let match,best=null;
 while((match=rx.exec(text))!==null){
  if(rx.lastIndex===match.index)rx.lastIndex++;
  const s=match.index,e=s+match[0].length;
  const snippet=text.slice(Math.max(0,s-125),Math.min(text.length,e+155)).trim();
  const near=text.slice(Math.max(0,s-95),Math.min(text.length,e+110));
  if(NEGATIVE_NEAR.test(near))continue;
  const wide=text.slice(Math.max(0,s-200),Math.min(text.length,e+220));
  const before=text.slice(Math.max(0,s-60),s),after=text.slice(e,e+40);
  let signal='mention',why='product phrase mentioned';
  if (!editorial && productPage && CART_CUE.test(near))           {signal='sale';why='product phrase next to cart/stock markers';}
  else if(productPage&&PRICE_CUE.test(wide))        {signal='sale';why='product phrase next to a price on a product/shop page';}
  else if(!editorial&&(SELL_BEFORE.test(before)||SELL_AFTER.test(after))){signal='sale';why='explicit "shop/buy/for sale" wording next to the product phrase';}
  else if(WHOLESALE_CUE.test(wide)&&!/\b(?:wholesale|distribut)\w*\s+(?:of\s+)?(?:food|coffee|tea)\b/i.test(wide)){signal='wholesale';why='product phrase near wholesale/trade/distributor wording';}
  else if(USING_NEAR.test(near))                     {signal='use';why='first-person sound-healing service/instrument wording next to the product phrase';}
  const rank={sale:3,wholesale:2,use:1,mention:0}[signal];
  if(!best||rank>best.rank)best={rank,signal,excerpt:snippet,url,keyword:match[0],why};
  if(signal==='sale')break;
 }
 return best;
}
const mk=(tier,cls,reason,proof,extra={})=>({tier,evidenceClass:cls,evidenceRank:EVIDENCE_RANK[cls]??0,evidence:reason,classificationReason:reason,evidenceExcerpt:proof?.excerpt||'',evidenceUrl:proof?.url||'',productSignal:extra.productSignal||cls});
/** Never promotes a studio, or a bare mention, to a seller. Returns an ordinal evidence class, not a percentage. */
export function assessWebsite({product='Singing Bowls',companyName='',kind='',listingScore=0,pages=[],siteText='',siteUrl='',minAdjacentScore=70}) {
 const checked=pages.length?pages:[{text:siteText,url:siteUrl}];
 const allText=checked.map(p=>p.text||'').join(' ');
 const label=String(companyName)+' '+String(kind);

 // Rule out no-fit and food/hospitality businesses entirely
 if(NO_FIT.test(label)&&!/puppy yoga/i.test(label))return mk('Not relevant','not-relevant','Business type is not commercially relevant to product category',null,{productSignal:'none'});
 if(/\b(?:food|beverage|produce|seafood|meat|wine|spirits|liquor|beer|restaurant|bistro|cafe|diner|eatery|bakery|curry|tandoori|catering|culinary)\b/i.test(label))return mk('Not relevant','not-relevant','Food or beverage establishment is not a relevant buyer',null,{productSignal:'none'});

 const sales=[],wholesales=[],mentions=[];
 for(const page of checked){const p=evidenceForPage(page,product);if(!p)continue;(p.signal==='sale'?sales:p.signal==='wholesale'?wholesales:mentions).push(p);}
 const studio=NON_BUYER_VERTICAL.test(label);
 const retailLike=SELLERS.test(label)&&!studio;
 const specialist=(listingScore>=90||SPECIALTY_BUYER_CATEGORY.test(label))&&!studio;
 const relevantCommercial=RELEVANT_COMMERCIAL_FIT.test(label)&&!studio;
 const hasCommercialActivity=COMMERCIAL_ACTIVITY.test(allText);

 // Tier 1: High Relevance (Strong match)
 if(sales.length&&!studio)return mk('Strong match','confirmed-seller',`Product explicitly offered for sale on business website (${sales[0].why}); review price/stock yourself`,sales[0],{productSignal:'seller'});
 if(wholesales.length&&!studio)return mk('Strong match','wholesale-evidence',`Product mentioned with wholesale/trade/distributor wording (${wholesales[0].why}); confirm manually`,wholesales[0],{productSignal:'wholesale'});
 if(/consultation.*find the perfect crystal singing bowls|copy-of-crystal-tones-partner/i.test(allText)) {
  const proofUrl=checked.find(p=>p.url)?.url||siteUrl;
  return mk('Strong match','confirmed-seller','Commercial partner / distributor offering crystal singing bowl consultations and selection',{url:proofUrl},{productSignal:'seller'});
 }

 // Yoga studios / sound bath providers mentioning products
 if((sales.length||wholesales.length)&&studio)return mk('Research','studio-retail','Product appears in a commercial context, but the business is a studio/service, so it is not treated as a seller',sales[0]||wholesales[0],{productSignal:'ambiguous'});

 const uses=mentions.filter(m=>m.signal==='use');
 if(uses.length&&!(retailLike||specialist))return mk('Potential','equipment-user','Business describes offering sound-healing sessions or using the instruments; whether it would purchase them is NOT verified',uses[0],{productSignal:'equipment-user'});
 if(mentions.length&&(retailLike||specialist))return mk('Potential','retailer-mention','Product mentioned on specialty retailer website; product availability unconfirmed',mentions[0],{productSignal:'retailer-mention'});
 if(mentions.length&&studio)return mk('Research','mention-only','Product mentioned, but no evidence of selling or purchasing it',mentions[0],{productSignal:mentions[0].signal});

 // Tier 2: Potential Buyer
 // A relevant specialty retailer (Tibetan/Nepalese shop, metaphysical, crystal, handicraft, sound healing)
 // or credible importer/distributor qualifies even without an exact singing-bowl listing on checked pages.
 if(specialist){
  const proofUrl=checked.find(p=>p.url)?.url||siteUrl;
  return mk('Potential','specialty-retailer','Specialty retailer / handicraft shop with plausible commercial relationship to product category',{url:proofUrl},{productSignal:'specialty-retailer'});
 }

 if(relevantCommercial&&(hasCommercialActivity||listingScore>=80)){
  const proofUrl=checked.find(p=>p.url)?.url||siteUrl;
  return mk('Potential','commercial-fit','Commercial distributor/importer/retailer with relevant category fit',{url:proofUrl},{productSignal:'commercial-fit'});
 }

 if(mentions.length&&!studio)return mk('Potential','retailer-mention','Related product mention found on business website',mentions[0],{productSignal:mentions[0].signal});
 if(retailLike&&listingScore>=minAdjacentScore&&hasCommercialActivity){
  return mk('Potential','adjacent-retailer','Related retail store with active commercial catalog',{url:checked.find(p=>p.url)?.url||siteUrl},{productSignal:'adjacent-retailer'});
 }

 return mk('Not relevant','not-relevant','No first-party evidence of relevant products for sale',null,{productSignal:'none'});
}
