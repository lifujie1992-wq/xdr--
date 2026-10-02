// 自动申诉：筛查（复用采集）→ 飞鸽零沟通核查 → 逐单提交（只交平台"可举报"的）
const {session, BrowserWindow} = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let USER_DATA = '';
const secure = {nodeIntegration:false, contextIsolation:true, sandbox:true};

// ---- 在店铺页面里执行的脚本（自包含，通过 executeJavaScript 注入）----
async function pageFlyge(){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  // 会话列表容器：出现即代表飞鸽已加载（空会话也会有它）
  const listEl=()=>document.querySelector('.messageList');
  const cnt=()=>document.querySelectorAll('.msgItemWrap').length;
  const buyerCnt=()=>document.querySelectorAll('.messageNotMe').length;
  const findScroller=()=>{
    let best=null;
    for(const el of document.querySelectorAll('div')){
      try{ if(el.scrollHeight>el.clientHeight+20 && (el.querySelector('.msgItemWrap')||/messageList/.test(String(el.className)))) best=el; }catch(e){}
    }
    return best||document.scrollingElement||document.documentElement;
  };
  // 等飞鸽框架加载：出现 .messageList 就算成功（买家没发过消息时里面是空的）
  for(let i=0;i<25;i++){ if(listEl()||cnt()>0) break; await sleep(1000); }
  if(!listEl()&&cnt()===0){
    // 兜底：等页面出现会话相关文案
    const body=document.body?document.body.innerText:'';
    const ok=/messageList|会话|已经到顶|暂无会话|为您推荐/.test(body);
    if(!ok) return JSON.stringify({ready:false,total:0,buyer_count:0,reason:'飞鸽页面未就绪'});
  }
  // 往上滚加载历史
  let prev=-1,stable=0;
  for(let i=0;i<25;i++){
    const sc=findScroller();
    try{ sc.scrollTop=0; sc.dispatchEvent(new Event('scroll',{bubbles:true})); }catch(e){}
    await sleep(700);
    const c=cnt();
    if(c===prev) stable++; else stable=0;
    prev=c;
    if(stable>=3) break;
  }
  const wraps=[...document.querySelectorAll('.msgItemWrap')];
  const buyer=[...document.querySelectorAll('.messageNotMe')];
  const msgs=buyer.map(w=>({txt:(w.innerText||'').replace(/\s+/g,' ').trim().slice(0,200)}));
  // 买家是否发过图片/视频/文件（有则必须人工介入）
  let buyerImgs=0;
  for(const b of buyer){
    try{
      const imgs=b.querySelectorAll('img').length;
      const vids=b.querySelectorAll('video,.video,.videoWrap,[class*=video]').length;
      const files=[...b.querySelectorAll('[class*=file],[class*=File]')].filter(e=>/文件|图片|视频|下载/.test(e.innerText||'')).length;
      buyerImgs += imgs + vids + files;
    }catch(e){}
  }
  return JSON.stringify({ready:true,total:wraps.length,buyer_count:buyer.length,buyer_imgs:buyerImgs,buyer_msgs:msgs.map(m=>m.txt).slice(0,50)});
}

async function pageFinalize(cfg){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const desc=(cfg.desc||'').slice(0,100), doSubmit=cfg.submit===true;
  const setV=(el,v)=>{const p=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
  const latestId=async()=>{try{const r=await fetch('/shopuser/accuse/list',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:0,pageSize:3})});const j=await r.json();const l=(j.data&&j.data.accuse_list)||[];return l[0]?String(l[0].id):null}catch(e){return null}};
  const btnOf=()=>[...document.querySelectorAll('button')].find(b=>{const t=(b.innerText||'').trim();return /确定举报|提交举报|确认举报/.test(t)&&!/取消/.test(t)});
  const toast=()=>[...document.querySelectorAll('.ant-message,.ant-notification,.ant-modal,[role=dialog],.auxo-message,.auxo-modal,.ant-form-item-explain-error')].map(e=>(e.innerText||'').replace(/\s+/g,' ').trim()).filter(Boolean).join(' | ').slice(0,220);
  const ta=[...document.querySelectorAll('textarea')].find(x=>(x.placeholder||'').includes('详细描述'));
  if(ta){ setV(ta,desc); await sleep(600); }
  const files=[...document.querySelectorAll('input[type=file]')].map(i=>(i.files||[]).length);
  if(!doSubmit) return JSON.stringify({filled:true,descOk:!!ta,files:files});
  const btn=btnOf();
  if(!btn) return JSON.stringify({submitted:false,verified:false,reason:'没找到提交按钮',files:files,toast:toast()});
  const binfo={text:(btn.innerText||'').trim(),disabled:!!btn.disabled};
  if(btn.disabled) return JSON.stringify({submitted:false,verified:false,reason:'提交按钮禁用',binfo:binfo,files:files,toast:toast()});
  const beforeId=await latestId();
  btn.click(); await sleep(2500);
  const t1=toast();
  const ok=[...document.querySelectorAll('button')].find(b=>{const t=(b.innerText||'').trim();return /^(确定|确认|我知道了|好的|继续举报)$/.test(t)&&!b.disabled});
  if(ok){ ok.click(); await sleep(2000); }
  const t2=toast();
  let afterId=null;
  for(let k=0;k<6;k++){ afterId=await latestId(); if(afterId&&String(afterId)!==String(beforeId)) return JSON.stringify({submitted:true,verified:true,reportId:afterId,binfo:binfo}); await sleep(2500); }
  return JSON.stringify({submitted:false,verified:false,reason:'提交未生效',beforeId:beforeId,afterId:afterId,binfo:binfo,files:files,toast:[t1,t2],tail:(document.body?document.body.innerText:'').slice(-200).replace(/\s+/g,' ')});
}

async function cdpClick(wc,x,y){
  try{
    try{ wc.debugger.attach('1.3'); }catch(e){}
    const X=Math.round(x),Y=Math.round(y);
    await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:X,y:Y,button:'none',clickCount:0});
    await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:X,y:Y,button:'left',clickCount:1});
    await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:X,y:Y,button:'left',clickCount:1});
    return true;
  }catch(e){ return false }
}
// 搜索到那一行，返回复选框屏幕坐标 + 当前已选数
async function pageSearch(cfg){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const kind=cfg.kind==='review'?'review':'quality', order=cfg.order;
  const SCENE=kind==='review'?'异常评价':'异常售后', PICK=kind==='review'?'选择评价':'选择订单';
  const click=(t)=>{const el=[...document.querySelectorAll('div,span,button,li')].find(e=>e.children.length===0&&(e.innerText||'').trim()===t);if(el){(el.closest('button')||el).click();return true}return false};
  const setV=(el,v)=>{const p=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
  const oInput=()=>[...document.querySelectorAll('input')].find(x=>{const p=x.placeholder||'';return p.includes('编号')||p==='请输入'||p.includes('多个编号')});
  const rowOf=()=>[...document.querySelectorAll('tr')].find(r=>(r.innerText||'').includes(order));
  const selCount=()=>{const m=(document.body.innerText||'').match(/已选\s*(\d+)\s*[个条]/);return m?+m[1]:-1};
  click(SCENE);await sleep(800);click(cfg.reason);await sleep(1200);click(PICK);await sleep(1800);
  const oi=oInput(); if(oi)setV(oi,order);
  click('查询');await sleep(2200);
  let tr=rowOf(); for(let k=0;k<8&&!tr;k++){ await sleep(1000); tr=rowOf(); }
  if(!tr) return JSON.stringify({found:false,sel:selCount()});
  tr.scrollIntoView({block:'center'});await sleep(400);
  const cb=tr.querySelector('input[type=checkbox],input[type=radio]')||tr;
  const rc=cb.getBoundingClientRect();
  return JSON.stringify({found:true,sel:selCount(),rowText:(tr.innerText||'').replace(/\s+/g,' ').slice(0,120),box:{x:rc.left+Math.min(10,Math.max(4,rc.width/2)),y:rc.top+rc.height/2,w:rc.width,h:rc.height}});
}
async function pageFillSubmit(cfg){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const setV=(el,v)=>{const p=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
  const ta=[...document.querySelectorAll('textarea')].find(x=>(x.placeholder||'').includes('详细描述'));
  if(ta){ setV(ta,(cfg.desc||'').slice(0,100)); await sleep(600); }
  const b=[...document.querySelectorAll('button')].find(x=>/确定举报|提交举报/.test(x.innerText||'')&&!/取消/.test(x.innerText||''));
  if(!b) return JSON.stringify({clicked:false,err:'没找到确定举报按钮',descOk:!!ta});
  if(b.disabled) return JSON.stringify({clicked:false,err:'按钮禁用',descOk:!!ta});
  b.click(); await sleep(2600);
  const toast=[...document.querySelectorAll('.ant-message,.ant-notification,.ant-modal,[role=dialog],.auxo-message')].map(e=>(e.innerText||'').replace(/\s+/g,' ').trim()).filter(Boolean).join(' | ').slice(0,200);
  return JSON.stringify({clicked:true,descOk:!!ta,toast:toast});
}

const NET_HOOK_SRC = `(function(){
  try{
    window.__net = { http: [], ws: [] };
    const of = window.fetch;
    window.fetch = function(u,o){ try{ window.__net.http.push(String(u).split('?')[0]); }catch(e){} return of.apply(this,arguments) };
    const oo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m,u){ try{ window.__net.http.push(String(u).split('?')[0]); }catch(e){} return oo.apply(this,arguments) };
    const OW = window.WebSocket;
    if(OW){
      const NW = function(u,p){ try{ window.__net.ws.push({url:String(u)}); }catch(e){} const w = new OW(u,p);
        try{ w.addEventListener('message', function(ev){ try{ window.__net.ws.push({dir:'in', d:String(ev.data).slice(0,600)}); }catch(e){} }); }catch(e){}
        try{ const os = w.send; w.send = function(d){ try{ window.__net.ws.push({dir:'out', d:String(d).slice(0,600)}); }catch(e){} return os.apply(w, arguments) }; }catch(e){}
        return w; };
      NW.prototype = OW.prototype; NW.CONNECTING=0; NW.OPEN=1; NW.CLOSING=2; NW.CLOSED=3;
      window.WebSocket = NW;
    }
  }catch(e){}
})();`;
async function installNetHook(wc){
  try{
    try{ wc.debugger.attach('1.3'); }catch(e){}
    await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: NET_HOOK_SRC });
    return true;
  }catch(e){ return false }
}
async function pageReadNet(){ try{ return JSON.stringify(window.__net||{}) }catch(e){ return '{}' } }

async function pageHookFetch(){ try{ window.__cap=[]; const of=window.fetch; window.fetch=function(u,o){ try{ const m=((o&&o.method)||'GET').toUpperCase(); if(m==='POST') window.__cap.push({u:String(u).split('?')[0],b:String((o&&o.body)||'').slice(0,2000)}); }catch(e){} return of.apply(this,arguments) }; const oo=XMLHttpRequest.prototype.open,ox=XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.open=function(m,u){ this.__u=u; this.__m=m; return oo.apply(this,arguments) }; XMLHttpRequest.prototype.send=function(b){ try{ if(String(this.__m).toUpperCase()==='POST') window.__cap.push({u:String(this.__u).split('?')[0],b:String(b||'').slice(0,2000)}); }catch(e){} return ox.apply(this,arguments) }; return true }catch(e){ return false } }
async function pageReadCap(){ try{ return JSON.stringify(window.__cap||[]) }catch(e){ return '[]' } }
// ===== 接口版：预检 + 提交（在页面上下文执行，避开风控与 UI） =====
const SCENE_CODES = {
  quality: { scene: 'report_type_unusual_after_sale', sub: 'report_reason_return_wrong_reason' }
};
// 中差评：全部已实测的原因代码（按常用度排序，逐个试）
const REVIEW_CODES = [
  { scene: 'report_type_unusual_comment', sub: 'report_reason_fake_negative_comment',          label: '评价等级为差评内容为好评' },
  { scene: 'report_type_unusual_comment', sub: 'report_reason_evaluate_product_other_shop',    label: '评价内容非交易商品或内容无意义' },
  { scene: 'report_type_unusual_comment', sub: 'report_reason_wrong_size',                     label: '消费者买错型号' },
  { scene: 'report_type_unusual_comment', sub: 'report_reason_low_politics_guns',              label: '评价内容中包含辱骂或不当词汇' },
  { scene: 'report_type_unusual_comment', sub: 'report_reason_negative_comment_compensation',  label: '利用中差评骗赔' },
  { scene: 'report_type_unusual_comment', sub: 'report_reason_business_evil_compete',          label: '同行恶意竞争' }
];
async function pageReviewCheck(cfg){
  try{
    const r = await fetch('/shopuser/accuse/comment_list', {method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({size:5, page:1, scene_type:cfg.scene, sub_scene_type:cfg.sub, accuse_id:null, sku_order_id:String(cfg.order)})});
    const j = await r.json();
    const c = ((j.data||{}).comments||[])[0] || null;
    if(!c) return JSON.stringify({found:false});
    const st = (c.status&&c.status.text)||'';
    const hover = ((((c.status_ext||{}).placeholder||[])[0]||{}).hover)||'';
    return JSON.stringify({found:true, can_select:!!c.can_select, status:String(st).replace(/<%[^%]*%>/g,''), hover:hover, comment_id:String(c.comment_id||''), rank:c.rank||'', content:String(c.content||'').slice(0,60), product_name:c.product_name||'', product_id:c.product_id?String(c.product_id):''});
  }catch(e){ return JSON.stringify({error:String(e&&e.message||e)}) }
}
async function pageReviewApply(cfg){
  try{
    const body = { scene_type: cfg.scene, sub_scene_type: cfg.sub, report_desc: cfg.desc||'',
      is_chat_granted: true, sku_order_id: String(cfg.order), comment_id: String(cfg.cid||''),
      proof_infos: cfg.proofs||[], come_from: '' };
    const r = await fetch('/shopuser/accuse/apply', {method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
    const t = await r.text();
    return JSON.stringify({reqBody: body, resp: t.slice(0,600)});
  }catch(e){ return JSON.stringify({error:String(e&&e.message||e)}) }
}
async function pagePreCheckApply(cfg){
  try{
    const r = await fetch('/shopuser/accuse/apply_pre_check_v2', {method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({order_ids:[String(cfg.order)], scene_type:cfg.scene, sub_scene_type:cfg.sub, accuse_id:null})});
    const t = await r.text();
    return t;
  }catch(e){ return JSON.stringify({error:String(e&&e.message||e)}) }
}
async function pageApplyNow(cfg){
  try{
    const body = { scene_type: cfg.scene, sub_scene_type: cfg.sub, report_desc: cfg.desc||'',
      is_chat_granted: true, order_ids: [String(cfg.order)], proof_infos: cfg.proofs||[], come_from: '' };
    const r = await fetch('/shopuser/accuse/apply', {method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
    const t = await r.text();
    return JSON.stringify({reqBody: body, resp: t.slice(0,600)});
  }catch(e){ return JSON.stringify({error:String(e&&e.message||e)}) }
}
async function pagePick(cfg){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const kind=cfg.kind==='review'?'review':'quality', order=cfg.order;
  const SCENE=kind==='review'?'异常评价':'异常售后', PICK=kind==='review'?'选择评价':'选择订单';
  const click=(t)=>{const el=[...document.querySelectorAll('div,span,button,li')].find(e=>e.children.length===0&&(e.innerText||'').trim()===t);if(el){(el.closest('button')||el).click();return true}return false};
  const setV=(el,v)=>{const p=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
  const oInput=()=>[...document.querySelectorAll('input')].find(x=>{const p=x.placeholder||'';return p.includes('编号')||p==='请输入'||p.includes('多个编号')});
  const rowOf=()=>[...document.querySelectorAll('tr')].find(r=>(r.innerText||'').includes(order));
  const selCount=()=>{const m=(document.body.innerText||'').match(/已选\s*(\d+)\s*[个条]/);return m?+m[1]:-1};
  click(SCENE);await sleep(700);
  click(cfg.reason);await sleep(1100);
  click(PICK);await sleep(1600);
  const oi=oInput(); if(oi)setV(oi,order);
  click('查询');await sleep(2300);
  let tr=rowOf(); for(let k=0;k<8&&!tr;k++){ await sleep(1000); tr=rowOf(); }
  if(!tr) return JSON.stringify({picked:false,why:'未查到'});
  const rt=tr.innerText||'';
  if(/无需举报/.test(rt)) return JSON.stringify({picked:false,why:'无需举报'});
  if(/不可举报/.test(rt)) return JSON.stringify({picked:false,why:'不可举报'});
  const cb=tr.querySelector('input[type=checkbox],input[type=radio]');
  if(cb) cb.click(); await sleep(700);
  if(selCount()<=0 && cb){ cb.click(); await sleep(600); }
  if(selCount()<=0) return JSON.stringify({picked:false,why:'勾选失败'});
  const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='确定');
  if(b) b.click(); await sleep(1600);
  return JSON.stringify({picked:true,files:document.querySelectorAll('input[type=file]').length});
}
async function pageLatestId(){ try{ const r=await fetch('/shopuser/accuse/list',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:0,pageSize:3})}); const j=await r.json(); const l=(j.data&&j.data.accuse_list)||[]; return l[0]?String(l[0].id):null; }catch(e){ return null } }
async function pageSelCount(){ const m=(document.body.innerText||'').match(/已选\s*(\d+)\s*[个条]/); return m?+m[1]:-1; }
async function pagePickConfirm(){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const b=[...document.querySelectorAll('button')].find(x=>{const t=(x.innerText||'').trim();return /^确定$/.test(t)});
  if(b){ b.click(); await sleep(1500); return true }
  return false;
}
async function pageFillDesc(cfg){
  const p=window.HTMLTextAreaElement.prototype;
  const ta=[...document.querySelectorAll('textarea')].find(x=>(x.placeholder||'').includes('详细描述'));
  if(!ta) return false;
  Object.getOwnPropertyDescriptor(p,'value').set.call(ta,(cfg.desc||'').slice(0,100));
  ta.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
}
async function pageSubmitClick(){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const b=[...document.querySelectorAll('button')].find(x=>{const t=(x.innerText||'').trim();return /确定举报|提交举报/.test(t)&&!/取消/.test(t)});
  if(!b) return JSON.stringify({clicked:false,err:'没找到确定举报按钮'});
  if(b.disabled) return JSON.stringify({clicked:false,err:'按钮禁用'});
  b.click(); await sleep(2500);
  const t=[...document.querySelectorAll('.ant-message,.ant-notification,.ant-modal,[role=dialog],.auxo-message')].map(e=>(e.innerText||'').replace(/\s+/g,' ').trim()).filter(Boolean).join(' | ').slice(0,200);
  return JSON.stringify({clicked:true,toast:t});
}

async function pageSubmit(cfg){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const kind=cfg.kind==='review'?'review':'quality', order=cfg.order, desc=(cfg.desc||'').slice(0,100), doSubmit=cfg.submit===true;
  const SCENE=kind==='review'?'异常评价':'异常售后', PICK=kind==='review'?'选择评价':'选择订单';
  const DEF=kind==='review'?['评价等级为差评内容为好评','评价内容非交易商品或内容无意义']:['消费者选择品质退货与事实不符'];
  const REASONS=(cfg.reason&&cfg.reason.trim())?[cfg.reason]:DEF;
  const click=(t)=>{const el=[...document.querySelectorAll('div,span,button,li')].find(e=>e.children.length===0&&(e.innerText||'').trim()===t);if(el){(el.closest('button')||el).click();return true}return false};
  const setV=(el,v)=>{const pr=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(pr,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
  const oInput=()=>[...document.querySelectorAll('input')].find(x=>{const p=x.placeholder||'';return p.includes('编号')||p==='请输入'||p.includes('多个编号')});
  const rowOf=()=>[...document.querySelectorAll('tr')].find(r=>(r.innerText||'').includes(order));
  const ready=async()=>{ for(let i=0;i<12;i++){ if([...document.querySelectorAll('div,span,button,li')].some(e=>(e.innerText||'').trim()===SCENE)) return true; await sleep(700);} return false; };
  const latestId=async()=>{ try{ const r=await fetch('/shopuser/accuse/list',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:0,pageSize:3})}); const j=await r.json(); const l=(j.data&&j.data.accuse_list)||[]; return l[0]?String(l[0].id):null; }catch(e){ return null } };
  const log=[];
  for(let attempt=0; attempt<2; attempt++){
    await ready();
    click(SCENE);await sleep(800);
    let chosen=null,picked=false,lastSkip='不可举报',sawRow=false;
    for(const reason of REASONS){
      click(reason);await sleep(1200);click(PICK);await sleep(1700);
      const oi=oInput();if(oi)setV(oi,order);
      click('查询');await sleep(2300);
      let tr=rowOf();
      for(let k=0;k<8&&!tr;k++){ await sleep(1000); tr=rowOf(); }
      if(!tr){log.push([reason,'未找到']);click('取消');await sleep(700);continue}
      sawRow=true;
      const rt=tr.innerText||'';
      if(/无需举报/.test(rt)){log.push([reason,'无需举报']);lastSkip='无需举报';click('取消');await sleep(700);continue}
      if(/不可举报/.test(rt)){log.push([reason,'不可举报']);lastSkip='不可举报';click('取消');await sleep(700);continue}
      const selCount=()=>{const m=(document.body.innerText||'').match(/已选\s*(\d+)\s*[个条]/);return m?+m[1]:-1};
      const cb=tr.querySelector('input[type=checkbox],input[type=radio]');
      if(cb&&!cb.checked){cb.click();await sleep(500);}
      if(selCount()<=0&&cb){const w=cb.closest('label')||cb.parentElement;if(w){w.click();await sleep(500);}}
      if(selCount()<=0){tr.click();await sleep(500);}
      if(selCount()<=0){log.push([reason,'勾选失败']);click('取消');await sleep(600);continue;}
      click('确定');await sleep(1500);chosen=reason;picked=true;break;
    }
    if(!picked)return JSON.stringify({submitted:false,skipped: sawRow?lastSkip:'未查到',log});
    const ta=[...document.querySelectorAll('textarea')].find(x=>(x.placeholder||'').includes('详细描述'));
    if(ta){setV(ta,desc);await sleep(500);}
    const descOk=!!ta;
    if(!doSubmit)return JSON.stringify({submitted:false,reason:chosen,filled:true,log});
    const beforeId=await latestId();
    click('确定举报');await sleep(3000);
    let afterId=null,ok=false;
    for(let k=0;k<8;k++){ afterId=await latestId(); if(afterId&&String(afterId)!==String(beforeId)){ok=true;break;} await sleep(3000); }
    if(ok) return JSON.stringify({submitted:true,reason:chosen,verified:true,reportId:afterId,attempt:attempt+1});
    log.push(['attempt'+(attempt+1),'未核实,desc'+(descOk?'ok':'MISSING'),(document.body?document.body.innerText:'').slice(-120).replace(/\s+/g,' ')]);
  }
  return JSON.stringify({submitted:false,verified:false,reason:'提交未生效',log});
}

async function pageHasReport(cfg){
  const oid=String(cfg.order||'');
  for(let pg=0;pg<8;pg++){
    const r=await fetch('/shopuser/accuse/list',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:pg,pageSize:20})});
    const j=await r.json(); const l=(j.data&&j.data.accuse_list)||[]; if(!l.length) break;
    for(const it of l){
      let d={}; try{ const r2=await fetch('/shopuser/accuse/detail',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:it.id})}); d=(await r2.json()).data||{}; }catch(e){}
      const os=(d.order_list||[]).map(o=>String(o.order_id||o.id));
      if(d.abnormal_comment&&d.abnormal_comment.sku_order_id) os.push(String(d.abnormal_comment.sku_order_id));
      if(os.includes(oid)) return it.id;
    }
  }
  return null;
}
async function pageSyncReports(cfg){
  const out=[]; const cutoffMs=Date.now()-(cfg&&cfg.days?cfg.days:30)*86400000;
  for(let pg=0;pg<cfg.pages;pg++){
    const r=await fetch('/shopuser/accuse/list',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:pg,pageSize:20})});
    const j=await r.json(); const l=(j.data&&j.data.accuse_list)||[]; if(!l.length) break;
    let stop=false;
    for(const it of l){
      const t=Date.parse((it.create_time||'').replace(/\//g,'-'));
      if(t && t<cutoffMs){ stop=true; continue; }
      let d={};
      try{ const r2=await fetch('/shopuser/accuse/detail',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:it.id})}); d=(await r2.json()).data||{}; }catch(e){}
      const orders=(d.order_list||[]).map(o=>String(o.order_id||o.id)).filter(Boolean);
      const ac=d.abnormal_comment;
      if(ac&&ac.sku_order_id) orders.push(String(ac.sku_order_id));
      let ex={}; try{ ex=JSON.parse(d.extra||'{}')||{}; }catch(e){}
      if(ex.order_id) orders.push(String(ex.order_id));
      out.push({id:it.id,scene:it.scene_type_name,sub:it.sub_scene_type_name,auditStatus:it.audit_status,auditTime:it.audit_time,created:it.create_time,orders:[...new Set(orders)],resultMsg:d.result_msg||''});
    }
    if(stop) break;
  }
  return JSON.stringify(out);
}

async function pageCheck(cfg){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const order=cfg.order, reason=cfg.reason;
  const kind=cfg.kind==='review'?'review':'quality';
  const SCENE=kind==='review'?'异常评价':'异常售后', PICK=kind==='review'?'选择评价':'选择订单';
  const click=(t)=>{const el=[...document.querySelectorAll('div,span,button,li')].find(e=>e.children.length===0&&(e.innerText||'').trim()===t);if(el){(el.closest('button')||el).click();return true}return false};
  const setV=(el,v)=>{const p=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
  const oInput=()=>[...document.querySelectorAll('input')].find(x=>{const p=x.placeholder||'';return p.includes('编号')||p==='请输入'||p.includes('多个编号')});
  const rowOf=()=>[...document.querySelectorAll('tr')].find(r=>(r.innerText||'').includes(order));
  const okS=click(SCENE);await sleep(800);
  const okR=click(reason);await sleep(1200);
  const okP=click(PICK);await sleep(1800);
  const oi=oInput(); const okI=!!oi; if(oi)setV(oi,order);
  const okQ=click('查询');await sleep(2200);
  let tr=rowOf(); for(let k=0;k<8&&!tr;k++){ await sleep(1000); tr=rowOf(); }
  const diag={step:'预检',order:order,reason:reason,OK场景:okS,OK原因:okR,OK选择器:okP,OK输入:okI,查询:okQ,找到行:!!tr,行文本:tr?(tr.innerText||'').replace(/\s+/g,' ').slice(0,200):''};
  if(!tr){ click('取消'); await sleep(400); return JSON.stringify({eligible:false,why:'未查到',diag}) }
  const rt=tr.innerText||'';
  click('取消'); await sleep(400);
  if(/无需举报/.test(rt)) return JSON.stringify({eligible:false,why:'无需举报',diag});
  if(/不可举报/.test(rt)) return JSON.stringify({eligible:false,why:'不可举报',diag});
  return JSON.stringify({eligible:true,reason:reason,diag});
}


const APPEAL_PACK_DIR = () => path.join(baseDir(),'appeal-pack');
const _safe = s => String(s||'').replace(/[\\/:*?"<>|\s]/g,'_');


// ===== LLM 判断评价原因（DeepSeek）=====
const LLM_CFG_FILE = () => path.join(baseDir(),'llm.json');
let _llmCfg = null;
function llmCfg(){ if(_llmCfg) return _llmCfg; try{ _llmCfg=JSON.parse(fs.readFileSync(LLM_CFG_FILE(),'utf8')); }catch(e){ _llmCfg=null } return _llmCfg }
const LLM_SYS = () => `你是一名资深抖音小店运营，负责判断中差评是否值得申诉举报。

【举报机会只有一次，必须严谨：宁可交人工，也不要瞎报】

平台允许的举报原因（只能从这 6 个里选）：
1. report_reason_fake_negative_comment — 评价等级为差评内容为好评（内容是夸赞/满意，星级却是 1~3 星）
2. report_reason_evaluate_product_other_shop — 评价内容非交易商品或内容无意义。适用：
   · 纯乱码、纯数字、纯符号、与商品完全无关的内容
   · 抱怨的对象**与本店商品、本店服务无关**（快递员态度、驿站服务、天气、平台规则、其他店铺等），本店商品和服务本身没有问题
   · **纯主观审美或个人偏好**（上身不好看、不合适、不喜欢、颜色不好看、没想象中好看等），且没有指出任何具体商品缺陷
   · **笼统的主观中差评**（不值、一般般、不满意、没有想象中好、踩坑了 等），只是表达不满情绪但没有指出本店商品或服务的任何具体缺陷
3. report_reason_wrong_size — 消费者买错型号（明确是自己尺码买错/穿不下/码大码小，不是在说商品质量问题）
4. report_reason_low_politics_guns — 评价内容中包含辱骂或不当词汇
5. report_reason_negative_comment_compensation — 利用中差评骗赔（威胁索赔、要钱）
6. report_reason_business_evil_compete — 同行恶意竞争

请像专业运营一样，根据【星级 + 评价内容 + 飞鸽聊天记录（含买家是否发过图片）】判断，给出以下结论之一：

- verdict="report"：确实满足上面某个举报原因 → 给出 reason 代码
- verdict="real_problem"：买家指出了**本店商品或本店服务的具体缺陷**（质量差、色差、起球、缩水、开线、有异味、实物与描述不符、穿着有问题、该发货而物流一直不动等）→ 不该举报，交人工处理
- verdict="quality_claim"：**买家在飞鸽聊天中提出了明确的商品质量问题**（例如说质量差、有瑕疵、破损、开线、掉色，或发来问题图片视频），需要卖家准备质量证明材料应对 → 交人工
- verdict="uncertain"：信息不足或拿不准（例如**评价内容为空**——平台对空内容多不受理——或一句话看不出指向）→ 交人工

判断要点：
- 买家**只是无效沟通**（问发货时间、催物流、问尺码、闲聊等），**没有涉及商品质量问题** → 不影响举报，按评价内容正常判断（该报就报）
- 只有买家**在聊天中发来了问题图片、且图片能证明商品质量有问题** → quality_claim
- 买家在聊天里只用文字说了质量问题（没有图片）→ real_problem
- 只要买家**在评价里指出了本店商品/服务的具体缺陷** → real_problem
- 只要抱怨的是**跟本店商品/服务无关的第三方**、**纯主观审美偏好**、或**笼统的中差评情绪** → report（原因 2）
- 分不清是"主观感受"还是"具体缺陷" → uncertain（交人工）

严格只输出 JSON，不要任何解释：
{"verdict":"report|real_problem|quality_claim|uncertain","reason":"<6个代码之一或null>","confidence":0到1,"why":"一句话说明理由"}`;

async function llmClassifyReview(rank, content, chat, hasImg){
  const cfg=llmCfg(); if(!cfg||!cfg.key) return {verdict:'uncertain',reason:null,confidence:0,why:'未配置大模型'};
  for(let attempt=0; attempt<2; attempt++){
    try{
      const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(), 25000);
      const r=await fetch(cfg.base_url+'/chat/completions',{ method:'POST', signal:ctrl.signal,
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+cfg.key},
        body: JSON.stringify({ model:cfg.model, max_tokens:2500,
          messages:[{role:'system',content:LLM_SYS()},{role:'user',content:'星级：'+(rank||'中评')+'\n评价内容：'+(String(content||'').trim()||'（空）')+'\n飞鸽聊天记录：'+(chat&&chat.length?chat.join(' | ').slice(0,800):'（买家全程没有任何发言）')+'\n买家是否发过图片/视频：'+(hasImg?'是':'否')}] }) });
      clearTimeout(timer);
      const j=await r.json();
      let txt=((j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content)||'').trim();
      const m=txt.match(/\{[\s\S]*\}/); if(m) txt=m[0];
      if(!txt) throw new Error('空响应');
      const o=JSON.parse(txt);
      const valid=['report_reason_fake_negative_comment','report_reason_evaluate_product_other_shop','report_reason_wrong_size','report_reason_low_politics_guns','report_reason_negative_comment_compensation','report_reason_business_evil_compete'];
      if(o.reason && valid.indexOf(o.reason)<0) o.reason=null;
      const V=['report','real_problem','quality_claim','uncertain'];
      let v=V.indexOf(o.verdict)>=0?o.verdict:(o.reason?'report':'uncertain');
      return {verdict:v, reason:o.reason||null, confidence:Number(o.confidence)||0, why:String(o.why||'').slice(0,80)};
    }catch(e){ if(attempt===1) return {verdict:'uncertain',reason:null,confidence:0,why:'大模型调用失败:'+String(e.message||e).slice(0,40)}; }
  }
  return {verdict:'uncertain',reason:null,confidence:0,why:'大模型无结果'};
}

// ===== 评价原因：按内容自动判断（拿不准返回 null → 交人工）=====
const REVIEW_REASON_MAP = [
  { re: /尺码|码数|偏大|偏小|买大|买小|号大|号小|穿不上|不合身|买错/, sub: 'report_reason_wrong_size', label: '消费者买错型号' },
  { re: /好评|满意|喜欢|不错|很好|很棒|点赞|五星|回购|物美价廉|值得|推荐/, sub: 'report_reason_fake_negative_comment', label: '评价等级为差评内容为好评' },
  { re: /广告|微信|加我|代购|引流|私聊|留下|联系我/, sub: 'report_reason_evaluate_product_other_shop', label: '评价内容包含广告信息' },
  { re: /同行|恶意竞争|抢生意|隔壁/, sub: 'report_reason_business_evil_compete', label: '同行恶意竞争' },
  { re: /骗赔|敲诈|威胁|索赔|赔偿|要钱/, sub: 'report_reason_negative_comment_compensation', label: '利用中差评骗赔' },
  { re: /骂|傻|垃圾|骗子|狗|滚|去死|恶心|有病/, sub: 'report_reason_low_politics_guns', label: '评价内容中包含辱骂或不当词汇' }
];
function pickReviewReason(content){
  const t = String(content||'').trim();
  if(!t) return null;                       // 内容为空：拿不准（平台对空内容多不受理）→ 人工
  for(const m of REVIEW_REASON_MAP){ if(m.re.test(t)) return m; }
  return null;                              // 匹配不上 → 拿不准 → 人工
}
// ===== 举报文案：按实际情况生成 =====
const BAD_WORDS = /测试|抓包|请忽略|test|debug|demo|样例|试验/i;
function sanitizeDesc(t){ return String(t||'').replace(BAD_WORDS,'').replace(/\s{2,}/g,' ').trim().slice(0,100); }
function buildQualityDesc(o){
  const r=String(o.reason||'').replace('（商品品质原因）','').replace('(商品品质原因)','');
  const d=String(o.desc||'');
  const m=(o.msgCount>0)?('经核查飞鸽聊天记录，买家自下单至今共 '+o.msgCount+' 条消息'):'经核查飞鸽聊天记录，买家自下单至今未与客服有过任何沟通（0 条消息）';
  return ('售后原因选“'+r+'”，但售后说明写的是“'+d+'”，属个人主观/非品质原因，与所选品质退货原因不符；'+m+'，未反馈商品质量问题。恳请核实并剔除该订单的商品品质退货率考核。');
}
function buildReviewDesc(o){
  const mc = Number(o.msgCount||0), imgs = Number(o.imgCount||0);
  const rank = o.rank || '中差评';
  const content = String(o.content||'').trim();
  const cpart = content ? ('评价内容为“'+content.slice(0,40)+'”') : '评价内容为空';
  const mpart = (mc>0)
    ? ('经核查飞鸽聊天记录，买家自下单至评价期间仅与客服有 '+mc+' 条沟通'+((imgs>0)?('（含图片 '+imgs+' 张）'):'')+'，均未反馈商品质量问题')
    : '经核查飞鸽聊天记录，买家自下单至评价期间未与客服有过任何沟通（0 条消息）';
  return ('买家给出'+rank+'，'+cpart+'，未上传商品问题图片或视频；'+mpart+'，未反馈任何商品或服务问题。'+
          '该评价缺乏事实依据，属于异常评价，申请剔除该评价，不参与店铺体验分统计。');
}

const REVIEW_DESC_OLD='买家仅勾选中评星级，评价无文字、无图片，飞鸽全程无沟通，没有提出任何商品或服务问题，属于无意义无效评价，申请剔除该评价，不参与店铺体验分统计。';
async function shot(wc, file){
  try{ const img=await wc.capturePage(); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,img.toPNG()); return file; }catch(e){ return null; }
}
async function setFileInputs(wc, files){
  try{
    if(!files||!files.length) return 0;
    try{ wc.debugger.attach('1.3'); }catch(e){}
    const doc=await wc.debugger.sendCommand('DOM.getDocument',{depth:1});
    const root=await wc.debugger.sendCommand('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[type=file]'});
    if(!root||!root.nodeId) return 0;
    await wc.debugger.sendCommand('DOM.setFileInputFiles',{files:files,nodeId:root.nodeId});
    // 关键：补发事件，否则页面 React 不知道有图，提交按钮可能仍禁用
    try{ await wc.executeJavaScript('(function(){const a=[...document.querySelectorAll(\'input[type=file]\')];a.forEach(i=>{i.dispatchEvent(new Event(\'input\',{bubbles:true}));i.dispatchEvent(new Event(\'change\',{bubbles:true}));i.dispatchEvent(new Event(\'blur\',{bubbles:true}));});return a.map(i=>(i.files||[]).length);})()',true); }catch(e){}
    return files.length;
  }catch(e){ return 0 }
}

function baseDir(){
  if(USER_DATA) return USER_DATA;
  try{ const e=require('electron'), p=e&&e.app&&e.app.getPath&&e.app.getPath('userData'); if(p){ USER_DATA=p; return p; } }catch(err){}
  return path.join(process.env.HOME||'', 'Library','Application Support','shopdesk');
}
function skipFile(){ return path.join(baseDir(),'appeal-reports','skipped.json'); }
function loadSkips(){ try{ return JSON.parse(fs.readFileSync(skipFile(),'utf8'))||{}; }catch(e){ return {}; } }
function saveSkip(order,reason,shop){
  try{ const m=loadSkips(); if(!m[order]){ m[order]={reason:reason,shop:shop||'',at:new Date().toISOString()}; fs.writeFileSync(skipFile(),JSON.stringify(m,null,2)); fs.chmodSync(skipFile(),0o600); } }catch(e){}
}
function runPage(wc, fn, ...args){
  return wc.executeJavaScript('('+fn.toString()+')('+args.map(a=>JSON.stringify(a)).join(',')+')', true);
}

function createAppeal({store, jobs, app}){
  try{ USER_DATA = app.getPath('userData'); }catch(e){}
  try{ process.nextTick(()=>{ USER_DATA = app.getPath('userData'); }); }catch(e){}
  let state = {id:null, running:false, log:[], startedAt:null, finishedAt:null, summary:null, reportFile:null};

  function persist(){
    if(!state.id) return;
    try{
      const dir = path.join(app.getPath('userData'),'appeal-reports'); fs.mkdirSync(dir,{recursive:true});
      const file = path.join(dir, 'appeal-'+String(state.startedAt).slice(0,10)+'-'+state.id+'.json');
      fs.writeFileSync(file, JSON.stringify(state,null,2)); fs.chmodSync(file,0o600);
      state.reportFile = file;
    }catch(e){}
  }

  const dataDir = () => path.join(app.getPath('userData'),'business-data');
  const reportsDir = () => path.join(app.getPath('userData'),'appeal-reports');
  const readJson = f => { try{ return JSON.parse(fs.readFileSync(f,'utf8')) }catch(e){ return null } };
  function handledOrders(recheck){
    const m=new Set();
    // 1) 平台确认已有举报记录的订单（results.json）
    try{ const rf=readJson(path.join(reportsDir(),'results.json')); if(rf&&rf.map) for(const oid of Object.keys(rf.map)) m.add(oid); }catch(e){}
    // 2) 跳过类（不可举报/无需举报）；recheck=true 时不排除，重新去平台核一遍
    if(!recheck){ try{ const sk=loadSkips(); for(const o of Object.keys(sk)) m.add(o); }catch(e){}
      // 平台一个订单只能举报一次：只要历史日志里出现过"已提交"，就永久跳过
      try{ for(const f of fs.readdirSync(reportsDir()).filter(x=>x.endsWith('.json')&&x!=='results.json'&&x!=='skipped.json')){ const rep=readJson(path.join(reportsDir(),f)); for(const e of (rep&&rep.log)||[]){ if(!e.order||e.result!=='已提交') continue; const dd=e.detail||{};
          const real = (dd.applyResp&&dd.applyResp.data&&dd.applyResp.data.id) || dd.reportId;   // 拿不到举报ID的视为未成功
          if(real) m.add(e.order); } } }catch(e){} }
    return m;
  }
  function unionWorklist(prefix){
    const map=new Map();
    try{ const files=fs.readdirSync(dataDir()).filter(f=>f.startsWith('appeal-worklist-'+prefix+'-')&&f.endsWith('.json')).sort();
      for(const f of files){ for(const r of (readJson(path.join(dataDir(),f))||[])){ if(!r.order_id) continue; const old=map.get(r.order_id); if(old){ map.set(r.order_id,Object.assign({},old,r)); } else map.set(r.order_id,r); } }
    }catch(e){}
    return [...map.values()];
  }

  async function screen(kinds,recheck){
    // 1) 触发增量筛查（只拉新增，更新 worklist 文件）
    for(const kind of kinds){
      const key = kind==='quality' ? 'builtin:quality_returns' : 'builtin:negative_reviews';
      let job; try{ job = jobs.start(key); }catch(e){ continue; }
      for(;;){ await sleep(2000); const s = jobs.get(job.id); if(!s || s.status!=='running') break; }
    }
    // 2) 处理对象 = 近30天全部未处理候选（积压 + 新增），已提交/不可举报的排除
    const done = handledOrders(recheck);
    const d0=new Date(Date.now()-30*86400000), minDate=d0.getFullYear()+'-'+String(d0.getMonth()+1).padStart(2,'0')+'-'+String(d0.getDate()).padStart(2,'0');
    const out=[];
    for(const [kind,prefix,argName] of [['quality','quality_returns','quality'],['review','negative_reviews','reviews']]){
      if(!kinds.includes(argName)) continue;
      for(const r of unionWorklist(prefix)){ const dd=r.apply_date||r.comment_date||''; if(dd && dd<minDate) continue; if(done.has(r.order_id)) continue; out.push({...r, kind}); }
    }
    return out;
  }

  async function processShop(shopId, shopName, items, submit, log){
    const ses = session.fromPartition('persist:shop-'+shopId);
    const mk=()=>{const w=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{...secure,session:ses,backgroundThrottling:false}});w.webContents.setWindowOpenHandler(()=>({action:'deny'}));return w;};
    const wA=mk(), wB=mk();
    try{
      const rA=wA.webContents, rB=wB.webContents;
      const reportUrl='https://fxg.jinritemai.com/ffa/govern-report/report-create';
      let pageReady=false, netHooked=false;
      for(const c of items){
       try{
        const flygeUrl = c.flyge_url || ('https://im.jinritemai.com/pc_seller_v2/main/workspace?fromOrder=' + c.order_id);
        // ① 飞鸽核查（先拿聊天记录，供"像运营一样判断"用）
        if(pageReady!==true){ await rA.loadURL(reportUrl).catch(()=>{}); await sleep(2500); pageReady=true; }
        if(!netHooked){ try{ await rB.loadURL('about:blank'); }catch(e){} await installNetHook(rB); netHooked=true; }
        await rB.loadURL(flygeUrl).catch(()=>{});
        let f=null;
        for(let i=0;i<20;i++){ await sleep(1500); try{ f=JSON.parse(await runPage(rB,pageFlyge)||'{}'); }catch(e){ f=null; } if(f&&f.ready) break; }
        if(!f||!f.ready){ log({shop:shopName,order:c.order_id,kind:c.kind,result:'跳过',reason:'飞鸽未加载'}); continue; }
        let net=null; try{ net=JSON.parse(await runPage(rB,pageReadNet)||'{}'); }catch(e){}
        // 说明：有沟通不等于不能举报；只有「聊天里有图片 + 能证明商品质量问题」才交人工

        // ② 判断（中差评：大模型综合内容+星级+聊天记录；品退：平台接口预检）
        const isRev = (c.kind==='review');
        let code=null, cid='', status='', tried=[], revLLM={}, revContent='', revRank='';
        const LABELS={'report_reason_fake_negative_comment':'评价等级为差评内容为好评','report_reason_evaluate_product_other_shop':'评价内容非交易商品或内容无意义','report_reason_wrong_size':'消费者买错型号','report_reason_low_politics_guns':'评价内容中包含辱骂或不当词汇','report_reason_negative_comment_compensation':'利用中差评骗赔','report_reason_business_evil_compete':'同行恶意竞争'};
        if(isRev){
          try{ revLLM=await llmClassifyReview(c.level||'中评', c.content, f.buyer_msgs||[]); }catch(e){ revLLM={verdict:'uncertain'}; }
          if(revLLM.verdict==='quality_claim'){
            saveSkip(c.order_id,'需卖家提供质量证明',shopName);
            log({shop:shopName,order:c.order_id,kind:c.kind,result:'跳过',reason:'需卖家提供质量证明',detail:{llm:revLLM,imgs:f.buyer_imgs,msgs:f.buyer_count}});
            continue;
          }
          if(revLLM.verdict==='real_problem'){
            saveSkip(c.order_id,'需人工介入·买家反馈真实问题',shopName);
            log({shop:shopName,order:c.order_id,kind:c.kind,result:'跳过',reason:'需人工介入·买家反馈真实问题',detail:{llm:revLLM,content:String(c.content||'').slice(0,60)}});
            continue;
          }
          if(revLLM.verdict!=='report'||!revLLM.reason){
            const fb=pickReviewReason(c.content);                       // 大模型拿不准时用关键词兜底
            if(!fb){
              saveSkip(c.order_id,'需人工介入·判断不确定',shopName);
              log({shop:shopName,order:c.order_id,kind:c.kind,result:'跳过',reason:'需人工介入·判断不确定',detail:{llm:revLLM,content:String(c.content||'').slice(0,60)}});
              continue;
            }
            revLLM.reason=fb.sub; revLLM.verdict='report'; revLLM.why=(revLLM.why||'')+'（关键词兜底）';
          }
          const cd={scene:'report_type_unusual_comment',sub:revLLM.reason,label:LABELS[revLLM.reason]||''};
          let ck={}; try{ ck=JSON.parse(await runPage(rA,pageReviewCheck,{order:c.order_id,scene:cd.scene,sub:cd.sub})||'{}'); }catch(e){ ck={}; }
          tried.push({sub:cd.sub,label:cd.label,status:ck.status||'',hover:ck.hover||'',can:ck.can_select});
          if(!ck.can_select){
            saveSkip(c.order_id,'需人工介入·平台判定'+((ck.status)||'不可举报'),shopName);
            log({shop:shopName,order:c.order_id,kind:c.kind,result:'跳过',reason:'需人工介入·平台判定'+((ck.status)||'不可举报'),detail:{llm:revLLM,tried:tried,hover:ck.hover||''}});
            continue;
          }
          code=cd; cid=ck.comment_id||''; status='可举报';
          revContent=String(ck.content||c.content||'').slice(0,60); revRank=ck.rank||'';
        } else {
          const cd=SCENE_CODES.quality;
          let pre={}; try{ pre=JSON.parse(await runPage(rA,pagePreCheckApply,{order:c.order_id,scene:cd.scene,sub:cd.sub})||'{}'); }catch(e){ pre={error:String(e&&e.message||e)}; }
          let st=''; try{ const dd=(pre&&pre.data)||{}; st=String((dd.sku_orders_check_res||{})[c.order_id]||(dd.orders_check_res||{})[c.order_id]||''); }catch(e){}
          tried.push({sub:cd.sub,status:st,code:pre&&pre.code});
          if(/审核中|已举报/.test(st)){ saveSkip(c.order_id,'已举报过',shopName); log({shop:shopName,order:c.order_id,kind:c.kind,result:'跳过',reason:'已举报过('+st+')'}); continue; }
          if(st==='无需举报'){ saveSkip(c.order_id,'无需举报',shopName); log({shop:shopName,order:c.order_id,kind:c.kind,result:'跳过',reason:'无需举报'}); continue; }
          if(st==='不可举报'){ saveSkip(c.order_id,'不可举报',shopName); log({shop:shopName,order:c.order_id,kind:c.kind,result:'跳过',reason:'不可举报',detail:{tried:tried}}); continue; }
          if(!(pre && pre.code===0 && !pre.error)){ log({shop:shopName,order:c.order_id,kind:c.kind,result:'跳过',reason:'预检失败',detail:{tried:tried}}); continue; }
          code=cd; status=st||'可举报';
        }
        // ③ 截图打包（全在窗口B，提前存盘；不碰窗口A）
        const dir=path.join(APPEAL_PACK_DIR(),_safe(shopName),_safe(c.order_id));
        const shots=[]; const isReview=c.kind==='review';
        try{ const p=await shot(rB,path.join(dir,isReview?'①飞鸽聊天记录.png':'①飞鸽聊天记录.png')); if(p)shots.push(p); }catch(e){}
        if(c.after_sale_id){ try{ await rB.loadURL('https://fxg.jinritemai.com/ffa/maftersale/aftersale/detail-v3?aftersale_id='+c.after_sale_id).catch(()=>{}); await sleep(5000); const p=await shot(rB,path.join(dir,'②售后单详情.png')); if(p)shots.push(p); }catch(e){} }
        try{ await rB.loadURL('https://fxg.jinritemai.com/ffa/order/detail?order_id='+c.order_id).catch(()=>{}); await sleep(5500); const p=await shot(rB,path.join(dir,'③订单详情.png')); if(p)shots.push(p); }catch(e){}

        // ④ 接口提交（不再点页面）
        if(!submit){ log({shop:shopName,order:c.order_id,kind:c.kind,result:'跳过',reason:'演练模式(未提交)',detail:{content:String(revContent||c.content||'').slice(0,60),label:(code&&code.label)||'',llm:revLLM,shots:shots.length,status:status}}); continue; }
        let ap={}; try{ ap=JSON.parse(await runPage(rA, (c.kind==='review'?pageReviewApply:pageApplyNow), {order:c.order_id,scene:code.scene,sub:code.sub,cid:cid,desc:sanitizeDesc(c.kind==='review'?buildReviewDesc({rank:revRank,content:revContent,msgCount:(f&&f.buyer_count)||0,imgCount:(f&&f.buyer_imgs)||0}):buildQualityDesc({reason:c.reason,desc:c.description,msgCount:(f&&f.buyer_count)||0})),proofs:[]})||'{}'); }catch(e){ ap={error:String(e&&e.message||e)}; }
        let resp={}; try{ resp=JSON.parse(ap.resp||'{}'); }catch(e){ resp={}; }
        const ok = !!(resp && resp.code===0 && resp.data && resp.data.id);   // 必须拿到举报ID才算成功
        let r={ submitted:!!ok, verified:!!ok, applyResp:resp, reqBody:ap.reqBody, shots:shots.length, status:status, reasonLabel:(code&&code.label)||'', llm:revLLM };
        if(!ok) r.reason = (resp&&(resp.msg||resp.message))||ap.error||'提交失败';
        if(!r.submitted && (r.skipped==='不可举报'||r.skipped==='无需举报')) saveSkip(c.order_id,r.skipped,shopName);
        if(!r.submitted && /^买家有沟通/.test(String(r.skipped||''))) saveSkip(c.order_id,'买家有沟通',shopName);
        // 提交未生效：再回平台查一次该单是否已有举报记录（多半是"已报过"被静默拒绝）
        if(!r.submitted && String(r.reason||'').indexOf('提交未生效')>=0){
          try{ const has=await orderHasReport(rB,c.order_id); if(has){ r.alreadyReported=has; saveSkip(c.order_id,'已举报过',shopName); } }catch(e){}
        }
        if(!r.submitted && (r.why==='不可举报'||r.why==='无需举报')) saveSkip(c.order_id,r.why,shopName);
        log({shop:shopName,order:c.order_id,kind:c.kind,result: r.submitted?'已提交':(r.skipped?'跳过':'未提交'),reason: r.submitted?'':(r.skipped||r.reason||r.error||''),detail:r});
       }catch(err){ log({shop:shopName,order:c.order_id,kind:c.kind,result:'未提交',reason:'异常:'+String(err&&err.message||err)}); }
      }
    } finally { if(!wA.isDestroyed()) wA.destroy(); if(!wB.isDestroyed()) wB.destroy(); }
  }

  async function flow(kinds, submit, shopIds, maxPerShop, recheck, log){
    try{
      if(!state.skipSync){ try{ log({step:'同步平台举报记录'}); const sr=await syncResults({days:30,pages:6}); log({step:'同步完成', 订单:sr&&sr.count}); }catch(e){} } else { log({step:'跳过同步（skipSync）'}); }
      log({step:'开始筛查', kinds});
      try{ const _sp=skipFile(); let _raw=null,_err=null; try{ _raw=fs.readFileSync(_sp,'utf8'); }catch(e){ _err=String(e.message||e); } let _parsed=null; try{ _parsed=JSON.parse(_raw).constructor.name+':'+Object.keys(JSON.parse(_raw)).length; }catch(e){ _parsed='parse失败:'+String(e.message||e); } log({step:'排除名单诊断', skipFile:_sp, cwd:process.cwd(), 读到字节:_raw?_raw.length:0, err:_err, 解析:_parsed, loadSkips条数:Object.keys(loadSkips()).length}); }catch(e){ log({step:'诊断异常',err:String(e.message||e)}); }
      const cands = await screen(kinds, recheck);
      const target = shopIds ? cands.filter(c=>shopIds.includes(c.shop_id)) : cands;
      log({step:'筛查完成', 候选: target.length, 每店上限: maxPerShop, 重核: !!recheck});
      const groups = new Map();
      for(const c of target){ if(!groups.has(c.shop_id)) groups.set(c.shop_id,{name:c.shop,items:[]}); groups.get(c.shop_id).items.push(c); }
      const shopList=[...groups]; let cursor=0; const CONC=2;
      const worker=async()=>{ while(cursor<shopList.length){ const [shopId,g]=shopList[cursor++]; const items=maxPerShop>0?g.items.slice(0,maxPerShop):g.items; log({step:'处理店铺', shop:g.name, count:items.length, 共:g.items.length}); await processShop(shopId, g.name, items, submit, log); } };
      await Promise.all(Array.from({length:Math.min(CONC,shopList.length)},worker));
    }catch(e){ log({step:'异常', error:String(e.message||e)}); }
    state.running=false; state.finishedAt=new Date().toISOString();
    state.summary = {candidates: (state.log.find(x=>x.step==='筛查完成')||{})['候选']||0,
      submitted: state.log.filter(x=>x.result==='已提交').length,
      skipped: state.log.filter(x=>x.result==='跳过').length,
      failed: state.log.filter(x=>x.result==='未提交'||x.error).length};
    try{
      const dir = path.join(app.getPath('userData'),'appeal-reports'); fs.mkdirSync(dir,{recursive:true});
      const file = path.join(dir, 'appeal-'+state.startedAt.slice(0,10)+'-'+state.id+'.json');
      fs.writeFileSync(file, JSON.stringify(state,null,2)); fs.chmodSync(file,0o600);
      state.reportFile = file;
    }catch(e){}
    persist();
  }

  function run({kinds=['quality','reviews'], submit=true, shopIds=null, maxPerShop=0, recheck=false, skipSync=false}={}){
    if(state.running) return {error:'已有自动申诉任务在运行', id:state.id};
    const _skip=!!skipSync;
    state = {id:String(Date.now()), running:true, log:[], startedAt:new Date().toISOString(), finishedAt:null, summary:null, reportFile:null, skipSync:_skip};
    const log = e => { state.log.push({at:new Date().toISOString(), ...e}); persist(); };
    flow(kinds, submit, shopIds, maxPerShop, recheck, log);   // 后台执行，不阻塞
    return {id:state.id, started:true};
  }

  async function orderHasReport(wc, order){
    try{ return await runPage(wc, pageHasReport, {order:order}); }catch(e){ return null; }
  }

  async function syncResults({shopIds=null, days=30, pages=12}={}){
    const shops=store.items.filter(s=>s.platform==='抖店'&&(!shopIds||shopIds.includes(s.id)));
    const map={}; let shopsOk=0;
    for(const shop of shops){
      const ses=session.fromPartition('persist:shop-'+shop.id);
      const w=new BrowserWindow({show:false,width:1024,height:800,webPreferences:{...secure,session:ses,backgroundThrottling:false}});
      try{
        await w.loadURL('https://fxg.jinritemai.com/ffa/govern-report/report-list').catch(()=>{});
        await sleep(4000);
        const arr=JSON.parse(await runPage(w.webContents,pageSyncReports,{days,pages})||'[]');
        shopsOk++;
        for(const r of arr){ for(const oid of (r.orders||[])) if(oid) map[oid]={reportId:r.id,auditStatus:r.auditStatus,resultMsg:r.resultMsg,auditTime:r.auditTime,scene:r.scene,sub:r.sub,created:r.created,shop:shop.name}; }
      }catch(e){}
      finally{ if(!w.isDestroyed()) w.destroy(); }
    }
    try{
      const dir=path.join(app.getPath('userData'),'appeal-reports'); fs.mkdirSync(dir,{recursive:true});
      const f=path.join(dir,'results.json');
      let prev={}; try{ prev=JSON.parse(fs.readFileSync(f,'utf8')).map||{}; }catch(e){}
      const merged={...prev,...map};
      const scenes={}; for(const v of Object.values(merged)){ const k=v.scene||'?'; scenes[k]=(scenes[k]||0)+1; }
      fs.writeFileSync(f, JSON.stringify({updatedAt:new Date().toISOString(),shopsOk,count:Object.keys(merged).length,thisRun:Object.keys(map).length,scenes,map:merged},null,2)); fs.chmodSync(f,0o600);
      return {file:f, shopsOk, count:Object.keys(merged).length, thisRun:Object.keys(map).length, scenes};
    }catch(e){ return {error:String(e.message||e)} }
  }

  const snapshot = () => JSON.parse(JSON.stringify(state));
  return {run, snapshot, syncResults};
}

module.exports = {createAppeal};
