/** All stateful operations are owned by the local API. Never store OAuth tokens in the browser. */
export const API = (import.meta as ImportMeta & { env: { VITE_API_URL?: string } }).env.VITE_API_URL || 'http://localhost:4100';
export async function request<T>(path:string,options:RequestInit={}):Promise<T>{
  const r=await fetch(API+path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},cache:'no-store'});
  let d:any;
  try {d=await r.json()}catch{throw new Error(`API unavailable or invalid response (HTTP ${r.status}). Check your backend terminal.`)}
  if(!r.ok)throw new Error(typeof d?.error==='string'?d.error:`API request failed (${r.status})`);
  return d as T;
}
export const jsonBody=(data:unknown):RequestInit=>({method:'POST',body:JSON.stringify(data)});
