// Conservative UI signals; platform DOM changes may require adapter updates.
const platforms={
 '抖店':{url:'https://fxg.jinritemai.com/login/common',hosts:['fxg.jinritemai.com']},
 '拼多多':{url:'https://mms.pinduoduo.com/',hosts:['mms.pinduoduo.com']},
 '快手':{url:'https://s.kwaixiaodian.com/',hosts:['s.kwaixiaodian.com']},
 '天猫':{url:'https://myseller.taobao.com/',hosts:['myseller.taobao.com','seller.tmall.com']},
 '小红书':{url:'https://ark.xiaohongshu.com/',hosts:['ark.xiaohongshu.com']},
 '视频号':{url:'https://store.weixin.qq.com/',hosts:['store.weixin.qq.com','channels.weixin.qq.com']}
};
function authenticated(platform,snapshot,hasCookie){
 const rule=platforms[platform];if(!rule||!hasCookie||!snapshot)return false;
 let u;try{u=new URL(snapshot.url)}catch{return false}
 if(u.protocol!=='https:'||!rule.hosts.includes(u.hostname))return false;
 if(/(?:login|signin|passport|verify|captcha|register|settle)/i.test(u.pathname+u.hash))return false;
 const text=snapshot.text||'';
 if(/扫码登录|扫描二维码|请扫码|请使用.{0,15}扫码|等待.{0,8}确认|扫码成功|安全验证|身份验证|验证码登录|密码登录|选择.{0,4}店铺|选择.{0,4}主体|登录已失效/.test(text))return false;
 const identity=/退出登录|退出账号|切换账号|切换店铺|店铺信息|店铺设置|账号管理/.test(text);
 const commerce=[/商品管理|商品列表|商品中心/,/订单管理|订单查询|订单中心|全部订单/,/数据中心|数据概览|经营概况|数据罗盘|店铺数据|营销中心|售后管理/].filter(r=>r.test(text)).length;
 return identity&&commerce>=2;
}
function extractShopName(snapshot){
 const names=(snapshot.shopNames||[]).map(value=>String(value).replace(/^\s*(?:当前店铺|店铺名称|店铺名|商店名称)\s*[:：]\s*/, '').replace(/\s*复制\s*修改\s*(?:店铺二维码)?\s*$/, '').trim()).filter(value=>value.length>=2&&value.length<=80&&!/[\r\n\t]|\.\.\.|…/.test(value)&&!/[<>]/.test(value)&&!/^(?:店铺名称|店铺名|当前店铺|店铺信息|店铺设置|切换店铺|全部店铺|我的店铺|商家后台|商家中心|抖店|拼多多|快手|天猫|小红书|视频号|微信小店|加载中|未知|未命名)$/.test(value));
 const unique=[...new Set(names)];return unique.length===1?unique[0]:null;
}
function takeSnapshot(){
 const visible=e=>{const s=getComputedStyle(e);return s.visibility!=='hidden'&&s.display!=='none'&&e.getClientRects().length>0};
 const leaves=Array.from(document.querySelectorAll('body, body *')).filter(e=>e.children.length===0&&visible(e));
 const text=leaves.map(e=>e.innerText||'').join('\n').slice(0,120000);
 const shopNames=[];
 const regions='header,aside,nav,[role="banner"],[class*="header" i],[class*="sidebar" i],[class*="topbar" i],[class*="shop-info" i],[class*="shopInfo"],[class*="store-info" i]';
 const nameSelectors='[data-testid="shop-name"],[data-testid="store-name"],[class*="shop-name" i],[class*="shopName"],[class*="store-name" i],[class*="storeName"],[id="shopName"],[id="storeName"]';
 const value=e=>{
  const clone=e.cloneNode(true);
  for(const child of clone.querySelectorAll('button,[role="button"],a,input,svg,img'))child.remove();
  for(const child of [...clone.querySelectorAll('*')].reverse())if(/^(?:复制|修改|编辑|店铺二维码|查看二维码)$/.test((child.textContent||'').trim()))child.remove();
  return e.getAttribute('title')||e.getAttribute('aria-label')||clone.textContent||'';
 };
 for(const e of document.querySelectorAll(nameSelectors)){if(visible(e)&&e.closest(regions))shopNames.push(value(e))}
 // Explicit current-shop labels may also appear on a shop information page.
 for(const e of leaves){
  const label=(e.innerText||'').trim();
  const match=label.match(/^(?:当前店铺|店铺名称|店铺名|商店名称)\s*[:：]\s*(.+)$/);
  if(match)shopNames.push(match[1]);
  if(/^(?:当前店铺|店铺名称|店铺名|商店名称)\s*[:：]?$/.test(label)){
   const next=e.nextElementSibling||(e.parentElement.children.length===1?e.parentElement.nextElementSibling:null);
   if(next&&visible(next))shopNames.push(value(next));
  }
 }
 return {url:location.href,text,shopNames};
}
function pddInfoLink(){
 if(location.hostname!=='mms.pinduoduo.com')return null;
 const found=[];
 for(const link of document.querySelectorAll('a[href]')){
  if((link.innerText||'').trim()!=='店铺信息'||!link.getClientRects().length)continue;
  try{const u=new URL(link.href);if(u.protocol==='https:'&&u.hostname==='mms.pinduoduo.com'&&!u.username&&!u.password)found.push(u.href)}catch{}
 }
 const unique=[...new Set(found)];return unique.length===1?unique[0]:null;
}
const snapshotScript='('+takeSnapshot.toString()+')()';
function watchLogin({platform,windows,ses,onSuccess,onError,onProgress=()=>{},interval=1500}){
 let stopped=false,busy=false,streak=0,lastPage='',timer;const missingSince=new Map(),navigated=new Set();
 async function check(){if(stopped||busy)return;busy=true;try{
 let candidate='',identity=null;
 for(const w of windows()){
  if(w.isDestroyed()||w.webContents.isLoadingMainFrame())continue;
  const snapshot=await w.webContents.executeJavaScript(snapshotScript);
  const cookies=await ses.cookies.get({url:snapshot.url});
  if(authenticated(platform,snapshot,cookies.some(c=>c.value&&(!c.expirationDate||c.expirationDate>Date.now()/1000)))){
   const name=extractShopName(snapshot);
   if(!name){
    if(!missingSince.has(w.id))missingSince.set(w.id,Date.now());
    const elapsed=Date.now()-missingSince.get(w.id);
    onProgress(elapsed>90000?'name-unavailable':'name-pending');
    if(platform==='拼多多'&&elapsed>=4500&&!navigated.has(w.id)){
     const infoURL=await w.webContents.executeJavaScript('('+pddInfoLink.toString()+')()');
     if(infoURL&&!stopped&&!w.isDestroyed()&&infoURL!==w.webContents.getURL()){
      navigated.add(w.id);onProgress('reading-info');await w.loadURL(infoURL);
     }
    }
    continue;
   }
   identity={name};candidate=w.id+':'+snapshot.url+':'+name;break;
  }
 }
 if(candidate&&candidate===lastPage)streak++;else streak=candidate?1:0;lastPage=candidate;
 if(streak>=3&&!stopped){stopped=true;clearInterval(timer);await onSuccess(identity)}
 }catch(e){streak=0;lastPage='';if(stopped)onError(e)}finally{busy=false}}
 timer=setInterval(check,interval);check();return ()=>{stopped=true;clearInterval(timer)};
}
module.exports={platforms,authenticated,extractShopName,watchLogin,takeSnapshot,pddInfoLink};
