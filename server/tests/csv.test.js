import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
// Compile the app's real src/services/csv.ts in-memory (uses the root project's TypeScript; no extra flags or build needed).
const require=createRequire(import.meta.url);
const ts=require('typescript');
const src=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'../../src/services/csv.ts'),'utf8');
const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {buildVerifiedCsv,CSV_COLUMNS,csvCell}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));

test('CSV has exactly the nine required columns in order, a BOM, CRLF rows and one row per lead',()=>{
 assert.deepEqual(CSV_COLUMNS,['DATE','SR NO.','CATEGORY','PRODUCT NAME','COMPANY NAME','LOCATION','WEBSITE','EMAIL','CONTACT NO.']);
 const csv=buildVerifiedCsv([{id:'1',companyName:'Quartz Shop',category:'Singing Bowls',city:'Denver',state:'CO',website:'https://q.com',email:'a@q.com',phone:'',dateAdded:'2026-11-22'}],'2026-11-22');
 assert.ok(csv.startsWith('\uFEFF'));
 const lines=csv.slice(1).split('\r\n');assert.equal(lines.length,2);
 assert.equal(lines[0],CSV_COLUMNS.map(c=>`"${c}"`).join(','));
 assert.equal(lines[1],'"22-11-2026","1","Wellness & Meditation Products","Singing Bowls","Quartz Shop","Denver, CO, USA","https://q.com","a@q.com",""');
 assert.equal(lines[1].split('","').length,9);
});
test('CSV: empty phone stays empty, quotes are escaped, spreadsheet formulas are neutralised',()=>{
 assert.equal(csvCell('He said "hi"'),'"He said ""hi"""');
 for(const bad of ['=HYPERLINK("x")','+1+1','@SUM(A1)','-2+3'])assert.ok(csvCell(bad).startsWith('"\''),bad);
 const csv=buildVerifiedCsv([{id:'1',companyName:'=cmd|calc',category:'Singing Bowls',city:'',state:'',website:'',email:'',phone:''}],'2026-11-22');
 assert.match(csv,/"'=cmd\|calc"/);
});
