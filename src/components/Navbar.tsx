import React from 'react';
import {Search, Radar, MailCheck, MailX} from 'lucide-react';
import {Button} from './ui/Button';
interface NavbarProps {searchTerm:string;setSearchTerm:(v:string)=>void;onOpenDiscovery:()=>void;activeTabTitle?:string;gmailConnected?:boolean}
/** Same original 80px navigation shell, emerald colors, and central search bar. */
export const Navbar:React.FC<NavbarProps> = ({searchTerm,setSearchTerm,onOpenDiscovery,activeTabTitle='Overview',gmailConnected})=>(
 <header className="sticky top-0 z-40 h-[80px] w-full border-b border-[rgba(148,163,184,0.12)] bg-[#0A0D12]/90 backdrop-blur-md px-6 sm:px-10 flex items-center justify-between gap-6">
  <div className="flex items-center gap-3 min-w-0 shrink-0"><div className="flex items-center gap-1.5 text-[14px] font-mono text-[#667085] whitespace-nowrap"><span>Exports</span><span>/</span></div><h2 className="text-xl font-bold font-display text-[#E5E9F0] tracking-tight whitespace-nowrap">{activeTabTitle}</h2></div>
  <div className="relative hidden md:block flex-1 max-w-md min-w-0"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#667085]"/><input type="search" placeholder="Search buyers, cities, emails..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} className="w-full h-10 rounded-control bg-[#10151C] border border-[rgba(148,163,184,0.12)] pl-10 pr-4 text-[14px] text-[#E5E9F0] placeholder-[#667085] focus:outline-none focus:border-[#2FBF8F] focus:ring-1 focus:ring-[#2FBF8F]/30 transition-all"/></div>
  <div className="flex items-center gap-3 shrink-0"><span className="hidden lg:inline-flex items-center gap-2 h-10 px-3.5 rounded-control bg-[#10151C] border border-[rgba(148,163,184,0.12)] text-[13px] text-[#9AA4B2]">{gmailConnected?<MailCheck className="h-4 w-4 text-[#2FBF8F]"/>:<MailX className="h-4 w-4"/>}{gmailConnected?'Gmail linked':'Gmail not linked'}</span><Button onClick={onOpenDiscovery} icon={<Radar className="h-4 w-4"/>}>New Scan</Button></div>
 </header>
);
