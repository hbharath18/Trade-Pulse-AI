export type ProductCategory = 'Singing Bowls' | 'Home Decor' | 'Brass Lamps' | 'Handcrafted Accents';
export type BuyerTier = 'Strong match' | 'Potential' | 'Research' | 'Not relevant' | 'Unverified';
export interface Lead {
  id: string;
  companyName: string;
  category: ProductCategory;
  city: string;
  state: string;
  country?: string;
  email: string;
  website: string;
  phone: string;
  source?: string;
  buyerTier?: BuyerTier;
  buyerEvidence?: string;
  evidenceExcerpt?: string;
  productSignal?: string;
  evidenceUrl?: string;
  emailSourceUrl?: string;
  emailStatus?: string;
  b2bConfidence?: number; // legacy field from older scans; no longer written
  evidenceClass?: 'confirmed-seller'|'wholesale-evidence'|'retailer-mention'|'equipment-user'|'studio-retail'|'studio-use'|'mention-only'|'adjacent-retailer'|'unverified-site'|'not-relevant';
  emailSourceType?: string;
  emailDomainCheck?: string;
  emailVerification?: string;
  evidenceRank?: number;
  classificationReason?: string;
  websiteStatus?: 'checked'|'unreachable';
  websiteFailureReason?: string;
  websiteFinalUrl?: string;
  aiReasoning?: string;
  reviewed?: boolean;
  notes?: string;
  dateAdded?: string;
  outreachStatus?: string;
  contactName?: string;
  title?: string;
}
export interface GmailStatus {
  configured: boolean;
  connected: boolean;
  email: string;
  replyTrackingScope: string;
  clientType: string;
  dailyLimit: number;
  sentAttemptsToday: number;
  perBatchLimit: number;
}
export interface SenderSettings {
  senderName: string;
  businessName: string;
  postalAddress: string;
  openAiEnabled: boolean;
  openAiConfigured: boolean;
  openAiModel: string;
}
export interface ApiHealth {
  ok: boolean;
  discoveryProviders: Record<string, boolean>;
  limits: {maxLeads:number; websiteChecks:number; overtureRowsPerTile:number; overtureGrid:number};
}
export interface DiscoveryResponse {
  leads: Lead[];
  research: Lead[];
  stats: {businessesFetched:number;providerCounts?:Record<string,number>;taxonomyBreakdown?:{kind:string;count:number}[];classCounts?:Record<string,number>;cachedSites?:number;studioProspects?:number;studioChecked?:number;relevantWithWebsite:number;specialistListings:number;websitesChecked:number;websitesSucceeded:number;websitesFailed:number;failureReasons:Record<string,number>;jsRenderedSites:number;emailsFound:number;productMatches:number;outreachReady:number;strongMatches:number;potentialMatches?:number;researchCandidates:number;rejections:{unrelatedCategories:number;duplicateListings?:number;belowCategoryThreshold?:number;websiteFailures:number;missingProductEvidence:number;notRelevantAfterCrawl?:number;studioNotSeller?:number;mentionOnly?:number;missingEmails:number;invalidEmailDomains?:number;equipmentUserOverCap?:number;websitesNotChecked:number}};
  warnings: string[];
  saved: {added:number;updated:number;total:number};
  researchSaved: {added:number;updated:number;total:number};
  limits: {maxLeads:number;websiteChecks:number};
}
export interface OutreachRecord {
  id:string;lead_id:string;recipient:string;subject:string;body:string;created_at:string;day:string;
  status:'attempted'|'sent'|'failed'|'replied';error:string;reply_at:string;reply_from:string;reply_snippet:string;
  gmail_message_id:string;gmail_thread_id:string;
}
export interface SuppressionRecord {email:string;created_at:string;reason:string}
