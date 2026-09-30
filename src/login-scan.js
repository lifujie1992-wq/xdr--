const {BrowserWindow,session}=require('electron');
const {authenticated,extractShopName,takeSnapshot}=require('./login');
const {pageIssue}=require('./login-health');
// Prefer the platform merchant home so a valid session is recognized even when
// the stored URL points at a deep login page. Fall back to the saved URL.
const HOMES={'抖店':'https://fxg.jinritemai.com/ffa/mshop/homepage/index','拼多多':'https://mms.pinduoduo.com/home/'};
const LABELS={checking:'检测中',authenticated:'登录正常',needs_login:'登录已失效',needs_verification:'需要平台验证',unknown:'未能确认',error:'检测失败',cancelled:'已取消'};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function createLoginScan({store,loginHealth,onChange=()=>{},concurrency=2,loadTimeoutMs=40000,settleMs=15000}){
 let state={running:false,total:0,completed:0,startedAt:null,finishedAt:null,durationMs:null,runId:null,cancelled:false,concurrency,results:{}};
 const windows=new Set();let cancelled=false;
 const snapshot=()=>({...state,shops:store.items.map(s=>({id:s.id,name:s.name,platform:s.platform,group:s.group}))});
 function publish(){try{onChange(snapshot())}catch{}}
 function remember(id,status,observedAt){if(status==='authenticated'||status==='needs_login'||status==='needs_verification')loginHealth?.record(id,status,observedAt)}
 async function inspect(shop){
  const ses=session.fromPartition('persist:shop-'+shop.id);
  ses.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));ses.setPermissionCheckHandler(()=>false);
  const w=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  windows.add(w);const wc=w.webContents;
  wc.setWindowOpenHandler(()=>({action:'deny'}));
  wc.on('will-navigate',(e,url)=>{if(!url.startsWith('https://'))e.preventDefault()});
  const guard=setTimeout(()=>{if(!w.isDestroyed())w.destroy()},loadTimeoutMs);
  const target=HOMES[shop.platform]||shop.url;
  try{
   await wc.loadURL(target).catch(()=>{});
   const deadline=Date.now()+settleMs;let issueStreak=0,lastIssue=null,lastSnapshot=null;
   while(Date.now()<deadline){
    if(cancelled)throw Object.assign(Error('已取消'),{cancelled:true});
    if(w.isDestroyed())throw Error('检测窗口已关闭');
    if(wc.isLoadingMainFrame()){await delay(250);continue}
    let s;try{s=await wc.executeJavaScript('('+takeSnapshot.toString()+')()')}catch{await delay(300);continue}
    lastSnapshot=s;
    const issue=pageIssue(s.url,s.text);
    if(issue){
     issueStreak=issue===lastIssue?issueStreak+1:1;lastIssue=issue;
     if(issueStreak>=2)return {status:issue,detectedName:extractShopName(s)||'',url:s.url};
    }else{
     issueStreak=0;lastIssue=null;
     const cookies=await ses.cookies.get({url:s.url});
     const hasCookie=cookies.some(c=>c.value&&(!c.expirationDate||c.expirationDate>Date.now()/1000));
     if(authenticated(shop.platform,s,hasCookie))return {status:'authenticated',detectedName:extractShopName(s)||'',url:s.url};
    }
    await delay(400);
   }
   if(lastSnapshot){const issue=pageIssue(lastSnapshot.url,lastSnapshot.text);if(issue)return {status:issue,detectedName:extractShopName(lastSnapshot)||'',url:lastSnapshot.url}}
   return {status:'unknown',detectedName:lastSnapshot?extractShopName(lastSnapshot)||'':'',url:w.isDestroyed()?'':wc.getURL()};
  }finally{clearTimeout(guard);windows.delete(w);if(!w.isDestroyed())w.destroy()}
 }
 async function runShop(shop){
  const began=Date.now();
  try{
   const r=await inspect(shop);
   state.results[shop.id]={status:r.status,message:LABELS[r.status],detectedName:r.detectedName,url:r.url,checkedAt:new Date().toISOString(),durationMs:Date.now()-began};
   remember(shop.id,r.status,began);
  }catch(e){
   const status=e?.cancelled?'cancelled':'error';
   state.results[shop.id]={status,message:e?.cancelled?LABELS.cancelled:(e.message||LABELS.error),detectedName:'',url:'',checkedAt:new Date().toISOString(),durationMs:Date.now()-began};
  }
  state.completed++;publish();
 }
 async function start(){
  if(state.running)return snapshot();
  cancelled=false;const shops=store.items.map(s=>({...s}));
  state={running:true,total:shops.length,completed:0,startedAt:new Date().toISOString(),finishedAt:null,durationMs:null,runId:Date.now().toString(),cancelled:false,concurrency:Math.min(concurrency,Math.max(shops.length,1)),results:{}};
  publish();
  let cursor=0;const started=Date.now();
  const worker=async()=>{while(cursor<shops.length&&!cancelled){const shop=shops[cursor++];state.results[shop.id]={status:'checking',message:LABELS.checking,checkedAt:null,detectedName:'',url:''};publish();await runShop(shop)}};
  await Promise.all(Array.from({length:state.concurrency},worker));
  state.running=false;state.cancelled=cancelled;state.finishedAt=new Date().toISOString();state.durationMs=Date.now()-started;publish();return snapshot();
 }
 function cancel(){cancelled=true;const at=new Date().toISOString();for(const s of store.items)if(!state.results[s.id])state.results[s.id]={status:'cancelled',message:LABELS.cancelled,checkedAt:at,detectedName:'',url:'',durationMs:0};for(const w of windows)if(!w.isDestroyed())w.destroy();publish();return snapshot()}
 function close(){cancelled=true;for(const w of windows)if(!w.isDestroyed())w.destroy();windows.clear()}
 return {snapshot,start,cancel,close};
}
module.exports={createLoginScan,LABELS};
