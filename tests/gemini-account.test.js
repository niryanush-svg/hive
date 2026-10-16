// /u/<n>/ Gemini tabs must stay inside their own Google account. Needs NODE_PATH → jsdom (see README).
const fs=require("fs"),vm=require("vm");const {JSDOM}=require("jsdom");
const SRC=fs.readFileSync(process.argv[2],"utf8");
const s=SRC.indexOf("const GEMINI_CONVO_RE"), e=SRC.indexOf("// v3.3.6 FIX (field bug #3)");
const code=SRC.slice(s,e)+"\n;globalThis.__x={ensureGeminiConversation,geminiOpenSidebarConvoFn,GEMINI_CONVO_RE,GEMINI_ZERO_RE,setLast:v=>{GEMINI_LAST_CONVO=v},getLast:()=>GEMINI_LAST_CONVO};";
async function run(startUrl, sidebarHtml, clickNavigates, last){
  const dom=new JSDOM("<body>"+sidebarHtml+"</body>",{url:startUrl||"https://gemini.google.com/app"});
  let url=startUrl; const updates=[];
  const chrome={tabs:{get:async()=>({id:1,url}),update:async(id,o)=>{updates.push(o.url);url=o.url;}}};
  const ctx=vm.createContext({chrome,console:{log(){}} ,setTimeout:(f)=>setTimeout(f,0),Promise,
    runInTab:async(id,fn)=>{ const c=vm.createContext({document:dom.window.document,window:dom.window,Node:dom.window.Node});
      const r=vm.runInContext("("+fn.toString()+")()",c); if(clickNavigates&&r.ok) url=clickNavigates; return r; }});
  vm.runInContext(code,ctx); ctx.__x.setLast(last||null);
  const out=await ctx.__x.ensureGeminiConversation({id:1,url:startUrl});
  return {start:startUrl,updates,finalUrl:out.url,last:ctx.__x.getLast()};
}
(async()=>{
 const sb='<a href="/app/abc123">c</a>', sbu='<a href="/u/1/app/abc123">c</a>', sbItem='<div data-test-id="conversation">x</div>', sbBad='<a href="/app/">x</a>';
 for (const [u,h,c,l] of [
  ["https://gemini.google.com/app",sb,null,null],
  ["https://gemini.google.com/u/1/app",sbu,null,null],
  ["https://gemini.google.com/u/1/app",sb,null,null],
  ["https://gemini.google.com/u/1/app",sbu,"https://gemini.google.com/u/1/app/abc123",null],
  ["https://gemini.google.com/app/abc",sb,null,null],
  ["https://gemini.google.com/u/1/app/abc",sb,null,null],
  ["https://gemini.google.com/gems/view",sb,null,null],
  [undefined,sb,null,null],
  ["https://gemini.google.com/app",sbItem,null,null],
  ["https://gemini.google.com/app",sbBad,null,null],
  ["https://gemini.google.com/app","",null,null],
  ["https://gemini.google.com/u/1/app?hl=en",sbu,null,"https://gemini.google.com/app/zzz"],
  ["https://gemini.google.com/u/1",sbu,null,null],
 ]) console.log(JSON.stringify(await run(u,h,c,l)));
})();
