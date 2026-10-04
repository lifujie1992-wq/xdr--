// 申诉工单本地网页服务：工单明细 + 运营看板 + 老板看板 + 复盘
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>申诉工作台</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f8ff;color:#0f172a;font:14px "PingFang SC","Microsoft YaHei",system-ui,-apple-system,sans-serif}
header{background:#fff;border-bottom:1px solid #e2e8f0;padding:12px 22px;display:flex;align-items:center;gap:18px;flex-wrap:wrap;position:sticky;top:0;z-index:5}
h1{font-size:16px;margin:0}
.tabs{display:flex;gap:4px}
.tabs button{border:0;background:#eef2f7;color:#475569;padding:7px 14px;border-radius:8px;font-size:13px}
.tabs button.on{background:#2563eb;color:#fff}
.tools{margin-left:auto;display:flex;gap:8px;align-items:center}
a.btn{font:inherit;border:1px solid #e2e8f0;border-radius:8px;padding:7px 12px;background:#fff;color:#334155;text-decoration:none;font-size:13px}
input,select,button{font:inherit;border:1px solid #e2e8f0;border-radius:8px;padding:7px 10px;background:#fff;color:#334155}
button{cursor:pointer;border:1px solid #e2e8f0}button.primary{background:#2563eb;color:#fff;border:0}
main{padding:16px 22px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}
table.list{table-layout:fixed}
table.list th,table.list td{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle}
table.list col.c1{width:210px}table.list col.c4{width:220px}table.list col.c2{width:112px}
table.list col.c5{width:auto}table.list col.c9{width:78px}table.list col.c10{width:300px}
table.list td.shopcell b{font-size:13px}
table.list td .sub{color:#94a3b8;font-size:11px}
.kindbd{display:inline-block;font-size:10px;padding:2px 7px;border-radius:5px;white-space:nowrap}
.kd-q{background:#e8f0ff;color:#2456c8}
.kd-r{background:#fff0e8;color:#c2662b}
.fbar{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:12px}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.chip{background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;border-radius:16px;padding:5px 12px;font-size:12px;cursor:pointer}
.chip i{font-style:normal;opacity:.6;margin-left:4px}
.chip.on{background:#2563eb;color:#fff;border-color:#2563eb;font-weight:600}
.chip.on i{opacity:.9}
.chip:hover{border-color:#93c5fd}
.frow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.frow select,.frow input{padding:8px 10px;font-size:12px}
.frow input#fq{flex:1;min-width:180px}
.seg{display:flex;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
.seg button{background:#fff;border:0;padding:8px 14px;font-size:12px;color:#64748b;border-right:1px solid #e2e8f0}
.seg button:last-child{border-right:0}
.seg button.on{background:#eff6ff;color:#1d4ed8;font-weight:600}
.fmeta{display:flex;gap:10px;align-items:center;margin-top:10px;font-size:12px;color:#64748b}
.fmeta .lnk{color:#2563eb;cursor:pointer;text-decoration:none}
.fmeta .grow{flex:1}
table.list td.why{font-size:12px;line-height:1.5;white-space:normal;color:#475569}
table.list td.tags .badge{margin:1px 2px 1px 0;font-size:10px;padding:2px 6px}
.tag{white-space:nowrap;display:inline-block}
.pager{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:12px;flex-wrap:wrap}
.pager button{padding:6px 12px;font-size:12px;background:#fff;border:1px solid #e2e8f0}
.pager button:hover{background:#eff6ff;border-color:#93c5fd}
/* 主状态：已举报=黄 举报成功=绿 未举报=红 */
.st{display:inline-block;white-space:nowrap;font-size:12px;font-weight:600;padding:4px 10px;border-radius:6px;min-width:64px;text-align:center}
.st-doing{background:#fff8e1;color:#9a7b00;border:1px solid #f2dfa0}
.st-ok{background:#e9f7f0;color:#1f7a55;border:1px solid #b6e2cf}
.st-no{background:#fdecea;color:#c0392b;border:1px solid #f5c6c0}
.st-human{background:#fdf0e6;color:#c2662b;border:1px solid #f0d0b0}
.st-todo{background:#f1f5f9;color:#64748b;border:1px dashed #cbd5e1;font-weight:500}
/* 二级标签 */
.tg{display:inline-block;white-space:nowrap;font-size:10px;padding:2px 7px;border-radius:10px;margin:1px 3px 1px 0}
.tg-human{background:#fdf0e6;color:#c2662b;font-weight:600}
.tg-no{background:#fdeceb;color:#c0392b}
.tg-warn{background:#fdf9f0;color:#b3762a}
.tg-todo{background:#f1f5f9;color:#64748b;border:1px dashed #cbd5e1}
.tg-info{background:#eef2f7;color:#64748b}
th,td{padding:9px 10px;border-bottom:1px solid #eef2f7;text-align:left;font-size:12px;vertical-align:top}
th{background:#f1f5f9;color:#64748b;font-weight:500;position:sticky;top:0}
tr:hover td{background:#f8fafc}
.badge{display:inline-block;padding:3px 9px;border-radius:20px;font-size:11px;white-space:nowrap}
.b-ok{background:#e9f7f1;color:#2f8a6d;border:1px solid #cfe9de}
.b-done{background:#f0f2f6;color:#7d8798;border:1px solid #e2e8f0}
.b-no{background:#fdf4f3;color:#c0392b;border:1px solid #f2d3d0}
.b-warn{background:#fdf9f0;color:#b3762a;border:1px solid #f0e0c4}
.mono{font-family:ui-monospace,Menlo,monospace}.kind{font-size:11px;color:#6a7690}
.rej{color:#c0392b;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
table.list td.rej,table.list td.okc,table.list td.wait{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.okc{color:#2f8a6d;font-size:11px}.wait{color:#64748b;font-size:11px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
.kcards{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:12px;margin-bottom:8px}
.kcard{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:15px 17px}
.kcard .kname{font-size:13px;font-weight:700;color:#0f172a;margin-bottom:10px;display:flex;align-items:center;gap:7px}
.kcard .kname i{width:6px;height:14px;border-radius:3px;background:#2563eb;display:inline-block}
.kcard .krow{display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px dashed #eef2f7;font-size:12px;color:#64748b}
.kcard .krow:last-child{border-bottom:0}
.kcard .krow b{font-size:19px;color:#0f172a}
.kcard .krow b.gd{color:#2f8a6d}.kcard .krow b.bd{color:#c0392b}
.kcard .knote{margin-top:8px;font-size:11px;color:#94a3b8}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px}
.card span{font-size:12px;color:#64748b}.card b{display:block;font-size:26px;margin:8px 0 2px}
.card small{font-size:11px;color:#94a3b8}
.card.good b{color:#2f8a6d}.card.bad b{color:#c0392b}
h2{font-size:14px;margin:22px 0 10px}
.hint{font-size:11px;color:#64748b;margin:6px 0 0}
.desc{color:#475569;font-size:11px;max-width:320px}
.empty{padding:40px;text-align:center;color:#8b95a8}
.tag{font-size:10px;background:#eef1ff;color:#5264d6;border-radius:6px;padding:2px 6px;margin-left:6px}
.hide{display:none}
.pair{border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:14px 16px;margin-bottom:12px}
.pair .row2{display:flex;gap:14px;flex-wrap:wrap}
.pair .col{flex:1;min-width:260px}
.pair h3{font-size:12px;margin:0 0 6px;color:#64748b;font-weight:500}
.pair pre{white-space:pre-wrap;font:12px/1.7 -apple-system,"PingFang SC",sans-serif;margin:0;color:#33415c}
.pair .rejbox{background:#fdf4f3;border:1px solid #f2d3d0;border-radius:8px;padding:10px}
.pair .okbox{background:#eefaf4;border:1px solid #cfe9de;border-radius:8px;padding:10px}
</style></head><body>
<header>
  <h1>申诉工作台</h1>
  <div class="tabs">
    <button data-tab="ops" class="on">运营</button>
    <button data-tab="boss">老板</button>
    <button data-tab="review">复盘</button>
    <button data-tab="queue">核对</button>
    <button data-tab="list">工单</button>
  </div>
  <div class="tools"><span id="gen" class="hint"></span><a class="btn" href="/export.csv" download>导出 CSV</a><button class="primary" id="refresh">刷新</button></div>
</header>
<main>
  <div id="ops"></div>
  <div id="boss" class="hide"></div>
  <div id="review" class="hide"></div>
  <div id="queue" class="hide">
    <div class="fbar">
      <div class="chips" id="qchips"></div>
      <div class="frow">
        <select id="qshop" title="店铺"></select>
        <input id="qq" placeholder="🔍 搜索订单号 / 评价内容" style="flex:1;min-width:180px">
      </div>
    </div>
    <div id="queuewrap"></div>
    <div id="qhint" class="hint" style="margin-top:10px">人工核对：修改描述/理由后点「确认提交」，下一轮自动申诉时提交。确认前不会上报平台。</div>
  </div>
  <div id="list" class="hide">
    <div class="fbar">
      <div class="chips" id="chips"></div>
      <div class="frow">
        <div class="seg" id="fkindSeg"></div>
        <select id="fshop" title="店铺"></select>
        <select id="frange">
          <option value="">全部时间</option><option value="1">今天</option><option value="7">近 7 天</option>
          <option value="30">近 30 天</option><option value="90">近 90 天</option><option value="custom">自定义…</option>
        </select>
        <span id="fcustom" class="hide"><input id="fd1" type="date" title="开始"><span class="hint">~</span><input id="fd2" type="date" title="结束"></span>
        <input id="fq" placeholder="🔍 搜索订单号 / 商品 / 店铺">
      </div>
      <div class="fmeta">
        <span id="fcount" class="hint"></span>
        <a id="clearf" class="lnk">清空筛选</a>
        <span class="grow"></span>
        <span class="hint">每页</span>
        <select id="fpage"><option value="50">50</option><option value="100">100</option><option value="300">300</option><option value="0">全部</option></select>
      </div>
    </div>
    <div id="listwrap"></div>
    <div id="pager" class="pager"></div>
  </div>
</main>
<script>
let DATA={items:[]},STATS=null,TAB='ops';
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pct=(a,b)=>(a+b)?Math.round(a/(a+b)*100):0;
const RESULTS=(typeof DATA!=='undefined'&&DATA&&DATA._results)||{};
function auditState(oid){const v=RESULTS&&RESULTS[oid];if(!v)return null;const a=v.auditStatus;if(a===6)return '已通过';if(a===3)return '已驳回';return '举报中';}
function kindBd(k){return '<span class="kindbd '+(k==='品退'?'kd-q':'kd-r')+'">'+esc(k||'—')+'</span>'}
function badge(s){const M={'已举报':'st-doing','举报成功':'st-ok','举报失败':'st-no','不可举报':'st-no','需转人工':'st-human','未处理':'st-todo'};const c=M[s]||'st-human';return '<span class="st '+c+'">'+esc(s||'—')+'</span>'}
function auditCell(x){const tip=esc((x.auditMsg||'').replace(/\s+/g,' ').slice(0,200));if(!/^(已举报|举报成功|举报失败)$/.test(x.status||''))return '<td></td>';if(x.auditStatus===3)return '<td class="rej" title="'+tip+'">❌ 平台拒绝：'+esc((x.auditMsg||'').replace(/^失败原因[:：]/,'').split(';平台建议')[0])+'</td>';if(x.auditStatus===6)return '<td class="okc">✅ 审核通过</td>';if(x.auditStatus==null)return '<td class="wait">平台记录待同步</td>';return '<td class="wait">审核中</td>'}
function drawTabs(){document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===TAB));['ops','boss','review','queue','list'].forEach(t=>$(t).classList.toggle('hide',t!==TAB))}
function drawOps(){
  const o=STATS.ops;
  $('ops').innerHTML=kindCards(STATS.byKind||{})
   +'<h2>驳回原因 TOP（运营要盯这个）</h2>'+rejTopTable()
   +'<h2>按举报原因的成功率</h2>'+reasonTable(STATS.review.byReason);
}
function drawBoss(){
  const b=STATS.boss;
  $('boss').innerHTML='<div class="cards">'
   +card('实际剔除单量',b.pass,'单（审核通过）','good')
   +card('申诉通过率',b.rate+'%','通过 '+b.pass+' / 驳回 '+b.reject,b.rate>=50?'good':'bad')
   +card('累计提交',b.sub,'单')
   +card('审核中',b.pending,'单')
   +'</div>'
   +'<h2>近30天趋势（提交 / 通过）</h2>'+trendTable(b.trend)
   +'<h2>分类统计（品退 / 中差评）</h2>'+kindTable(STATS.byKind||{})
   +'<h2>店铺对比（含近30天趋势）</h2>'+shopTable(b.byShop,b)
   +'<h2>按举报原因的成功率</h2>'+reasonTable(STATS.review.byReason);
}
function drawReview(){
  const r=STATS.review;
  $('review').innerHTML='<p class="hint">把「你提交的说明 + 选的举报原因」和「平台审核结果 + 驳回理由」并排看，找规律。</p>'
   +'<h2>按举报原因的成功率</h2>'+reasonTable(r.byReason)
   +'<h2>驳回原因 TOP</h2>'+rejTopTable()
   +'<h2>逐条复盘（近 '+r.rows.length+' 条提交）</h2>'
   + r.rows.slice().reverse().map(x=>{
      const rej=x.auditStatus===3, ok=x.auditStatus===6;
      const box=ok?'<div class="okbox"><b>✅ 审核通过</b><pre>'+esc((x.auditMsg||'').replace(/;平台建议[\s\S]*/,''))+'</pre></div>'
        :rej?'<div class="rejbox"><b>❌ 驳回</b><pre>'+esc((x.auditMsg||'').replace(/^失败原因[:：]/,'').replace(/;平台建议[\s\S]*/,''))+'</pre></div>'
        :'<div class="wait">审核中 / 待同步</div>';
      return '<div class="pair"><div class="hint">'+esc(x.shop||'')+' · <span class="mono">'+esc(x.order_id)+'</span> · '+esc((x.at||'').slice(0,16).replace('T',' '))+' · <span class="tag">'+esc(x.submitReason||x.kind||'')+'</span></div>'
        +'<div class="row2"><div class="col"><h3>订单原始情况（买家选的）</h3><pre>'+esc(x.buyerReason||'（无）')+'</pre></div>'
        +'<div class="col"><h3>平台审核结果</h3>'+box+'</div></div></div>';
   }).join('');
}
let PAGE=1, F={status:'',kind:'',shop:'',q:'',from:'',to:''};
const STATUSES=['已举报','举报成功','举报失败','不可举报','需转人工','未举报'];
function CounterOf(rows){ const c={}; for(const x of rows){ c[x.status]=(c[x.status]||0)+1; } return c; }
function filtered(skipStatus){
  return DATA.items.filter(x=>{
    if(!x.status) return false;
    if(!skipStatus && F.status && x.status!==F.status) return false;
    if(F.kind && x.kind!==F.kind) return false;
    if(F.shop && (x.shop||'')!==F.shop) return false;
    if(F.q){ const hay=((x.shop||'')+' '+(x.order_id||'')+' '+(x.product_name||'')+' '+(x.product_id||'')+' '+(x.why||'')).toLowerCase(); if(hay.indexOf(F.q)<0) return false; }
    const d=String(x.date||'').slice(0,10);
    if(F.from && d && d<F.from) return false;
    if(F.to && d && d>F.to) return false;
    return true;
  });
}
function drawChips(all){
  const c=CounterOf(all); const el=$('chips');
  el.innerHTML=['全部'].concat(STATUSES).map(k=>{
    const n=(k==='全部')?all.length:(c[k]||0);
    if(k!=='全部'&&!n) return '';
    return '<button class="chip'+(F.status===k||(k==='全部'&&!F.status)?' on':'')+'" data-st="'+k+'">'+k+'<i>'+n+'</i></button>';
  }).join('');
  el.querySelectorAll('button').forEach(b=>b.onclick=()=>{ F.status=(b.dataset.st==='全部')?'':b.dataset.st; PAGE=1; drawList(); });
}
function drawShopSel(all){
  const m={}; for(const x of all){ if(x.shop) m[x.shop]=(m[x.shop]||0)+1; }
  const sel=$('fshop');
  sel.innerHTML='<option value="">全部店铺 ('+Object.keys(m).length+')</option>'
    +Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([k,v])=>'<option'+(F.shop===k?' selected':'')+' value="'+esc(k)+'">'+esc(k)+' ('+v+')</option>').join('');
}
function drawSeg(){
  $('fkindSeg').innerHTML=['','品退','中差评'].map(k=>'<button class="sg'+((F.kind===k||(k===''&&!F.kind))?' on':'')+'" data-k="'+k+'">'+(k||'全部')+'</button>').join('');
  $('fkindSeg').querySelectorAll('button').forEach(b=>b.onclick=()=>{ F.kind=b.dataset.k; PAGE=1; drawSeg(); drawList(); });
}

function drawList(){
  const all=DATA.items;
  if(!$('fshop').options.length) drawShopSel(all);
  drawSeg();
  drawChips(filtered(true));
  const rows=filtered();
  const size=Number(($('fpage')&&$('fpage').value)||50);
  const pages=size>0?Math.max(1,Math.ceil(rows.length/size)):1;
  if(PAGE>pages) PAGE=pages; if(PAGE<1) PAGE=1;
  const view=size>0?rows.slice((PAGE-1)*size,PAGE*size):rows;
  $('fcount').textContent='共 '+rows.length+' 条';
  if(!rows.length){ $('listwrap').innerHTML='<div class="empty">没有符合条件的记录。</div>'; $('pager').innerHTML=''; return }
  $('listwrap').innerHTML='<table class="list"><colgroup><col class="c1"><col class="c4"><col class="c2"><col class="c5"><col class="c9"><col class="c10"></colgroup>'
   +'<thead><tr><th>店铺 / 类型 / 日期</th><th>订单号 / 商品</th><th>状态</th><th>状态原因</th><th>提交人</th><th>审核结果</th></tr></thead><tbody>'
   +view.map(x=>'<tr>'
      +'<td class="shopcell"><b>'+esc(x.shop)+'</b><br>'+kindBd(x.kind)+' <span class="sub">'+esc(x.date)+'</span></td>'
      +'<td class="ordcell"><span class="mono">'+esc(x.order_id)+'</span><br><span class="sub">'+esc(x.product_name||'')+'</span>'+(x.product_id?'<span class="sub"> · 编码 '+esc(x.product_id)+'</span>':'')+'</td>'
      +'<td>'+badge(x.status)+'</td>'
      +'<td class="why" title="'+esc(x.why||'')+'">'+esc(x.why||'—')+'</td>'
      +'<td>'+(x.submitter?'<span class="tag">'+esc(x.submitter)+'</span>':'')+'</td>'
      +auditCell(x)
      +'</tr>').join('')+'</tbody></table>';
  $('pager').innerHTML= size>0 && pages>1
    ? '<button data-pg="1">首页</button><button data-pg="'+(PAGE-1)+'">上一页</button><span class="hint">第 '+PAGE+' / '+pages+' 页 · 每页 '+size+' 条</span><button data-pg="'+(PAGE+1)+'">下一页</button><button data-pg="'+pages+'">末页</button>'
    : '<span class="hint">共 '+rows.length+' 条</span>';
  $('pager').querySelectorAll('button[data-pg]').forEach(b=>b.onclick=()=>{ const p=Number(b.dataset.pg); if(p>=1&&p<=Math.max(1,pages)){ PAGE=p; drawList(); } });
}
const card=(t,v,u,cls)=>'<div class="card '+(cls||'')+'"><span>'+esc(t)+'</span><b>'+v+'</b><small>'+esc(u||'')+'</small></div>';
function barTable(map,label){const e=Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,15);if(!e.length)return '<div class="empty">暂无</div>';const max=e[0][1];return '<table><thead><tr><th>'+esc(label)+'</th><th>数量</th><th></th></tr></thead><tbody>'+e.map(([k,v])=>'<tr><td>'+esc(k)+'</td><td>'+v+'</td><td><div style="height:8px;background:#e6ebf5;border-radius:4px"><div style="height:8px;width:'+Math.round(v/max*100)+'%;background:#2563eb;border-radius:4px"></div></div></td></tr>').join('')+'</tbody></table>'}
function rejTopTable(){const e=Object.entries(STATS.review.rejTop).sort((a,b)=>b[1]-a[1]);if(!e.length)return '<div class="empty">暂无驳回</div>';return '<table><thead><tr><th>驳回理由</th><th>条数</th></tr></thead><tbody>'+e.map(([k,v])=>'<tr><td class="rej">'+esc(k)+'</td><td>'+v+'</td></tr>').join('')+'</tbody></table>'}
function reasonTable(map){const e=Object.entries(map).sort((a,b)=>b[1].total-a[1].total);if(!e.length)return '<div class="empty">暂无</div>';return '<table><thead><tr><th>举报原因</th><th>提交</th><th>通过</th><th>驳回</th><th>通过率</th></tr></thead><tbody>'+e.map(([k,v])=>'<tr><td>'+esc(k)+'</td><td>'+v.total+'</td><td class="okc">'+v.pass+'</td><td class="rej">'+v.reject+'</td><td>'+pct(v.pass,v.reject)+'%</td></tr>').join('')+'</tbody></table>'}
function shopTable(map,b){const e=Object.entries(map).sort((a,b)=>b[1].total-a[1].total);if(!e.length)return '<div class="empty">暂无</div>';return '<table><thead><tr><th>店铺</th><th>提交</th><th>通过</th><th>驳回</th><th>审核中</th><th>通过率</th><th>近30天趋势 <span class="tag">品退</span><span class="tag" style="background:#fdf1e8;color:#b3762a">中差评</span></th></tr></thead><tbody>'+e.map(([k,v])=>{const day=((b&&b.byShopDay)||{})[k]||{},dd=(b&&b.days)||[];const q=dd.map(x=>(day[x]&&day[x].q)||0),r=dd.map(x=>(day[x]&&day[x].r)||0);return '<tr><td>'+esc(k)+'</td><td>'+v.total+'</td><td class="okc">'+v.pass+'</td><td class="rej">'+v.reject+'</td><td class="wait">'+v.pending+'</td><td>'+pct(v.pass,v.reject)+'%</td><td>'+miniChart(dd,q,r)+'</td></tr>'}).join('')+'</tbody></table>'}
function chart(days,q,r){
  const w=300,h=72,pad=6, n=days.length;
  const max=Math.max(1,...q,...r);
  const X=i=>n<=1?w/2:pad+(w-2*pad)*i/(n-1);
  const Y=v=>h-pad-(h-2*pad)*(v/max);
  const poly=a=>a.map((v,i)=>X(i).toFixed(1)+','+Y(v).toFixed(1)).join(' ');
  return '<svg width="'+w+'" height="'+h+'" style="background:#fff;border:1px solid #eef2f7;border-radius:6px"><polyline fill="none" stroke="#2563eb" stroke-width="1.6" points="'+poly(q)+'"/><polyline fill="none" stroke="#e8833a" stroke-width="1.6" points="'+poly(r)+'"/></svg>';
}
function totalTrend(b){
  const dd=b.days||[], q=dd.map(x=>((b.totalDaily||{}).quality||{})[x]||0), r=dd.map(x=>((b.totalDaily||{}).review||{})[x]||0);
  const sq=q.reduce((a,c)=>a+c,0), sr=r.reduce((a,c)=>a+c,0);
  return '<p class="hint">近30天合计：品退 <b>'+sq+'</b> 单 · 中差评 <b>'+sr+'</b> 条 · <span class="tag">品退</span><span class="tag" style="background:#fdf1e8;color:#b3762a">中差评</span></p>'
    +'<div class="pair">'+chart(dd,q,r)+'</div>'
    +'<table><thead><tr><th>日期</th><th>品退</th><th>中差评</th></tr></thead><tbody>'
    +dd.slice().reverse().map(x=>'<tr><td>'+x+'</td><td>'+(((b.totalDaily||{}).quality||{})[x]||0)+'</td><td>'+(((b.totalDaily||{}).review||{})[x]||0)+'</td></tr>').join('')
    +'</tbody></table>';
}
function kindCards(bk){
  const row=(t,v,cls)=>'<div class="krow"><span>'+t+'</span><b class="'+(cls||'')+'">'+v+'</b></div>';
  return '<div class="kcards">'+['品退','中差评'].map(k=>{const v=bk[k]||{};
    return '<div class="kcard"><div class="kname"><i></i>'+k+'</div>'
     + row('今日新增',(v.today||0)+' 条')
     + row('近30天总数',(v.total||0)+' 条')
     + row('已申请',(v.sub||0)+' 条')
     + row('通过',(v.pass||0)+' 条','gd')
     + row('通过率',(v.rate||0)+'%',(v.rate>=50?'gd':'bd'))
     + '<div class="knote">不可举报 '+(v.notReportable||0)+' · 无需举报 '+(v.notNeed||0)+' · 驳回 '+(v.reject||0)+'</div>'
     +'</div>'}).join('')+'</div>';
}
function kindSummary(bk){
  const ks=['品退','中差评'];
  const row=k=>{const v=bk[k]||{};return '<tr><td class="kk"><b>'+k+'</b></td><td><b>'+(v.total||0)+'</b> 条</td><td><b>'+(v.sub||0)+'</b> 条</td><td class="okc"><b>'+(v.pass||0)+'</b> 条</td><td><b>'+(v.rate||0)+'%</b></td></tr>'};
  return '<table class="kinds"><thead><tr><th>类型</th><th>总数</th><th>已申请</th><th>通过</th><th>通过率</th></tr></thead><tbody>'
   + ks.map(row).join('') + '</tbody></table>'
   + '<p class="hint">通过率 = 通过 ÷（通过 + 驳回），不含审核中。例：品退总数 128，已申请 53，通过 12，通过率 23%。</p>';
}
function kindTable(bk){
  const ks=['品退','中差评'];
  return '<table><thead><tr><th>类型</th><th>总数</th><th>已提交</th><th>通过</th><th>驳回</th><th>审核中</th><th>通过率</th></tr></thead><tbody>'
   + ks.map(k=>{const v=bk[k]||{};return '<tr><td><b>'+k+'</b></td><td>'+(v.total||0)+'</td><td>'+(v.sub||0)+'</td><td class="okc">'+(v.pass||0)+'</td><td class="rej">'+(v.reject||0)+'</td><td class="wait">'+(v.pending||0)+'</td><td><b>'+(v.rate||0)+'%</b></td></tr>'}).join('')
   + '</tbody></table><p class="hint">通过率 = 通过 ÷（通过+驳回），不含审核中。</p>';
}
function miniChart(days,q,r){
  const w=120,h=26,pad=2,n=days.length;
  const max=Math.max(1,...q,...r);
  const X=i=>n<=1?w/2:pad+(w-2*pad)*i/(n-1);
  const Y=v=>h-pad-(h-2*pad)*(v/max);
  const poly=a=>a.map((v,i)=>X(i).toFixed(1)+','+Y(v).toFixed(1)).join(' ');
  return '<svg width="'+w+'" height="'+h+'" style="vertical-align:middle"><polyline fill="none" stroke="#2563eb" stroke-width="1.2" points="'+poly(q)+'"/><polyline fill="none" stroke="#e8833a" stroke-width="1.2" points="'+poly(r)+'"/></svg>';
}
function shopTrends(b){
  const shops=Object.entries(b.byShop||{}).sort((a,c)=>c[1].total-a[1].total).slice(0,12);
  if(!shops.length)return '<div class="empty">暂无</div>';
  return '<p class="hint"><span class="tag">品退</span> <span class="tag" style="background:#fdf1e8;color:#b3762a">中差评</span> · 近30天每天的候选单量</p>'
   + shops.map(([name,v])=>{
      const day=(b.byShopDay||{})[name]||{};
      const q=b.days.map(d=>(day[d]&&day[d].q)||0), r=b.days.map(d=>(day[d]&&day[d].r)||0);
      return '<div class="pair"><div class="hint"><b>'+esc(name)+'</b> · 提交 '+v.total+' / 通过 '+v.pass+' / 驳回 '+v.reject+'</div>'+chart(b.days,q,r)+'</div>';
    }).join('');
}
function trendTable(map){const ks=Object.keys(map).sort();if(!ks.length)return '<div class="empty">暂无</div>';return '<table><thead><tr><th>日期</th><th>提交</th><th>通过</th><th>驳回</th></tr></thead><tbody>'+ks.map(k=>'<tr><td>'+k+'</td><td>'+map[k].sub+'</td><td class="okc">'+map[k].pass+'</td><td class="rej">'+map[k].reject+'</td></tr>').join('')+'</tbody></table>'}
function draw(){drawTabs();if(!STATS)return;$('gen').textContent='更新于 '+(STATS.generated_at?new Date(STATS.generated_at).toLocaleString('zh-CN'):'');if(TAB==='ops')drawOps();else if(TAB==='boss')drawBoss();else if(TAB==='review')drawReview();else if(TAB==='queue')drawQueue();else drawList()}
const QREASONS=[['report_reason_evaluate_product_other_shop','评价内容非交易商品或内容无意义'],['report_reason_fake_negative_comment','评价等级为差评内容为好评'],['report_reason_wrong_size','消费者买错型号'],['report_reason_low_politics_guns','评价内容中包含辱骂或不当词汇'],['report_reason_evaluate_advertise','评价内容包含广告信息'],['report_reason_before_signing_evaluate','订单签收前评价商品质量问题'],['report_reason_negative_comment_compensation','利用中差评骗赔'],['report_reason_business_evil_compete','同行恶意竞争'],['report_reason_platform_voucher','平台发券导致的降价差评']];
const QST=['待核对','已确认','已提交','不举报','已失效'];
let QF={status:'待核对',shop:'',q:''}, QDATA={items:[]};
function qFiltered(){
  return QDATA.items.filter(x=>{
    if(QF.status && x.status!==QF.status) return false;
    if(QF.shop && (x.shop||'')!==QF.shop) return false;
    if(QF.q){ const h=((x.shop||'')+' '+(x.order_id||'')+' '+(x.content||'')).toLowerCase(); if(h.indexOf(QF.q)<0) return false; }
    return true;
  });
}
function drawQueue(){
  if(document.activeElement && $('queue').contains(document.activeElement) && /TEXTAREA|INPUT|SELECT/.test(document.activeElement.tagName)) return; // 正在编辑时不重绘
  const all=QDATA.items||[]; const cnt={}; for(const s of ['待核对','已确认','已提交','不举报','已失效']) cnt[s]=all.filter(x=>x.status===s).length;
  const el=$('qchips');
  el.innerHTML=['待核对','已确认','已提交','不举报','已失效'].map(k=>'<button class="chip'+(QF.status===k?' on':'')+'" data-st="'+k+'">'+k+'<i>'+(cnt[k]||0)+'</i></button>').join('');
  el.querySelectorAll('button').forEach(b=>b.onclick=()=>{ QF.status=b.dataset.st; drawQueue(); });
  const shops=[...new Set(all.map(x=>x.shop).filter(Boolean))];
  const qs=$('qshop');
  if(!qs.options.length || qs.dataset.n!=String(shops.length)){
    qs.dataset.n=String(shops.length);
    qs.innerHTML='<option value="">全部店铺</option>'+shops.map(s=>'<option'+(QF.shop===s?' selected':'')+'>'+esc(s)+'</option>').join('');
    qs.onchange=()=>{ QF.shop=qs.value; drawQueue(); };
  }
  const rows=qFiltered().sort((a,b)=>(b.filledAt||'').localeCompare(a.filledAt||''));
  if(!rows.length){ $('queuewrap').innerHTML='<div class="empty">没有'+esc(QF.status||'')+'的记录。</div>'; return; }
  $('queuewrap').innerHTML=rows.map(x=>{
    const rec=(x.recommend&&x.recommend.is_match)?('<span class="tag">平台推荐:'+esc(x.recommend.sub_scene_type_name||'')+' · 置信度'+esc(x.recommend.confidence)+'</span>'):'<span class="tag">平台无推荐</span>';
    const pa=x.preAudit?('<span class="tag" style="background:'+(x.preAudit.level==='low'?'#fdeceb;color:#c0392b':'#e9f7f0;color:#1f7a55')+'">预审:'+(x.preAudit.level||'?')+'</span>'+(x.preAudit.rateReason?'<span class="hint"> '+esc(String(x.preAudit.rateReason).slice(0,60))+'</span>':'')):'';
    const sel='<select id="qsub_'+x.order_id+'" style="max-width:260px">'+QREASONS.map(r=>'<option value="'+r[0]+'"'+(r[0]===x.sub?' selected':'')+'>'+esc(r[1])+'</option>').join('')+'</select>';
    const act = x.status==='待核对'
      ? '<button class="primary qa" data-oid="'+x.order_id+'" data-act="confirm">✅ 确认提交</button> <button class="qa" data-oid="'+x.order_id+'" data-act="reject">🚫 不举报</button>'
      : (x.status==='已确认' ? '<button class="qa" data-oid="'+x.order_id+'" data-act="reset">↩ 撤回确认</button>' : '');
    return '<div class="pair"><div class="hint"><b>'+esc(x.shop||'')+'</b> · <span class="mono">'+esc(x.order_id)+'</span> · '+esc(x.rank||'')+' · '+esc(x.date||'')+' · '+act+'</div>'
      +'<div style="margin:6px 0">'+rec+pa+' <span class="hint">评价:'+esc(x.content||'')+'</span></div>'
      +(x.llmWhy?'<div class="hint">AI:'+esc(String(x.llmWhy).slice(0,90))+'</div>':'')
      +(x.goneReason?'<div class="hint">失效原因:'+esc(x.goneReason)+'</div>':'')
      +'<textarea id="qta_'+x.order_id+'" rows="2" style="width:100%;margin:6px 0;font:inherit">'+esc(x.desc||'')+'</textarea>'
      +'<div>'+sel+'</div></div>';
  }).join('');
  $('queuewrap').querySelectorAll('button.qa').forEach(b=>b.onclick=()=>queueAct(b.dataset.oid,b.dataset.act));
}
async function queueAct(oid,action){
  const body={order_id:oid,action:action};
  const ta=$('qta_'+oid), sel=$('qsub_'+oid);
  if(ta) body.desc=ta.value;
  if(sel) body.sub=sel.value;
  if(sel){ const m=QREASONS.find(r=>r[0]===sel.value); if(m) body.label=m[1]; }
  try{ await fetch('/queue/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); }catch(e){}
  await loadQueueData(); drawQueue();
}
async function loadQueueData(){ try{ QDATA=await fetch('/queue').then(r=>r.json()); }catch(e){} }
function load(){Promise.all([fetch('/data').then(r=>r.json()),fetch('/stats').then(r=>r.json()),loadQueueData()]).then(([d,s])=>{DATA=d;STATS=s;draw()}).catch(()=>{})}
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{TAB=b.dataset.tab;draw()});
function applyRange(){
  const rg=$('frange').value; $('fcustom').classList.toggle('hide', rg!=='custom');
  if(rg && rg!=='custom'){ const d=new Date(); d.setDate(d.getDate()-Number(rg));
    const pad=n=>String(n).padStart(2,'0');
    F.from=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); F.to=''; }
  else if(rg==='custom'){ F.from=$('fd1').value; F.to=$('fd2').value; }
  else { F.from=''; F.to=''; }
  PAGE=1; drawList();
}
function bindFilters(){
  $('fshop').onchange=()=>{ F.shop=$('fshop').value; PAGE=1; drawList(); };
  $('frange').onchange=()=>{ applyRange(); };
  $('fd1').onchange=$('fd2').onchange=()=>{ F.from=$('fd1').value; F.to=$('fd2').value; PAGE=1; drawList(); };
  $('fq').oninput=()=>{ F.q=$('fq').value.trim().toLowerCase(); PAGE=1; drawList(); };
  $('qq').oninput=()=>{ QF.q=$('qq').value.trim().toLowerCase(); drawQueue(); };
  $('fpage').onchange=()=>{ PAGE=1; drawList(); };
  $('clearf').onclick=()=>{ F={status:'',kind:'',shop:'',q:'',from:'',to:''}; $('fq').value=''; $('frange').value=''; $('fcustom').classList.add('hide'); PAGE=1; drawList(); };
}
load(); bindFilters(); setInterval(load,30000);
load();setInterval(load,30000);
</script></body></html>`;

function createAppealWeb({app, appeal}){
  let server=null, port=null;
  const dataDir = () => path.join(app.getPath('userData'),'business-data');
  const reportsDir = () => path.join(app.getPath('userData'),'appeal-reports');
  const readJson = f => { try{ return JSON.parse(fs.readFileSync(f,'utf8')) }catch(e){ return null } };
  function loadAllReviews(){
    const map=new Map();
    try{ const files=fs.readdirSync(dataDir()).filter(f=>f.startsWith('reviews-all-')&&f.endsWith('.json')).sort();
      for(const f of files){ for(const r of (readJson(path.join(dataDir(),f))||[])){ if(r.order_id){ const old=map.get(r.order_id); map.set(r.order_id, old?Object.assign({},old,r):r); } } }
    }catch(e){}
    return [...map.values()];
  }
  function loadWorklist(prefix){
    const map=new Map();
    try{ const files=fs.readdirSync(dataDir()).filter(f=>f.startsWith('appeal-worklist-'+prefix+'-')&&f.endsWith('.json')).sort();
      for(const f of files){ for(const r of (readJson(path.join(dataDir(),f))||[])){ if(!r.order_id) continue; const old=map.get(r.order_id); if(old){ map.set(r.order_id,Object.assign({},old,r)); } else map.set(r.order_id,r); } }
    }catch(e){}
    return [...map.values()];
  }
  function collectLogs(){
    const logs=[];
    try{ for(const f of fs.readdirSync(reportsDir()).filter(x=>x.endsWith('.json')&&x!=='results.json')){ const rep=readJson(path.join(reportsDir(),f)); if(rep&&Array.isArray(rep.log)) logs.push(...rep.log); } }catch(e){}
    try{ const live=appeal&&appeal.snapshot&&appeal.snapshot(); if(live&&Array.isArray(live.log)) logs.push(...live.log); }catch(e){}
    return logs;
  }
  function readResults(){ try{ const rf=readJson(path.join(reportsDir(),'results.json')); return (rf&&rf.map)||{} }catch(e){ return {} } }
  function buildData(){
    const logs=collectLogs(), results=readResults();
    // 平台审核状态
    const auditOf=(oid)=>{ const v=results[oid]; if(!v) return null; const a=v.auditStatus; return a===6?'举报成功':(a===3?'举报失败':'已举报'); };
    const auditTags=(oid)=>{ const v=results[oid]; if(!v) return []; const a=v.auditStatus; if(a===6) return ['已通过']; if(a===3) return ['已驳回']; return ['审核中']; };
    const arrOf=t=>{ if(t instanceof Set) return [...t]; if(Array.isArray(t)) return t; return t?[String(t)]:[]; };

    // 每单取“最新一条日志”，并记住是否曾经提交成功过
    const last={}, everSubmitted=new Set();
    for(const e of logs){ if(!e.order) continue; last[e.order]=e; if(e.result==='已提交') everSubmitted.add(e.order); }

    // 转人工的具体理由（来自最新日志）
    const humanWhy=(e)=>{
      const dd=e.detail||{};
      const ai=dd.llm&&dd.llm.why?String(dd.llm.why):'';
      const rs=String(e.reason||'');
      if(/需卖家提供质量证明/.test(rs)) return ai||'飞鸽聊天中有图片证据证明商品质量问题，需准备质量证明材料';
      if(/买家反馈真实问题/.test(rs)) return ai||'买家指出了本店商品/服务的具体缺陷，不宜举报';
      if(/买家发过图片/.test(rs)) return '买家发来过图片/视频证据';
      if(/判断不确定/.test(rs)) return ai||'内容为空或信息不足，AI 无法判断，需人工';
      if(/买家有沟通/.test(rs)) return ai||'买家与客服有过沟通，需人工查看聊天内容';
      if(/飞鸽未加载|未查到|勾选失败/.test(rs)) return '平台页面/查询异常：'+(rs||'');
      return ai||'需人工核实';
    };

    const items=[]; const seen=new Set();
    const d0=new Date(Date.now()-30*86400000), minDate=d0.getFullYear()+'-'+String(d0.getMonth()+1).padStart(2,'0')+'-'+String(d0.getDate()).padStart(2,'0');

    // ① 清单里的单（品退候选 + 中差评全量）
    for(const [kind,prefix,label] of [['quality','quality_returns','品退'],['review','negative_reviews','中差评']]){
      const src=(prefix==='negative_reviews')?loadAllReviews():loadWorklist(prefix);
      for(const r of src){
        const dd=r.apply_date||r.comment_date||'';
        if(dd && dd<minDate) continue;
        if(seen.has(r.order_id)) continue; seen.add(r.order_id);
        const e=last[r.order_id];
        const tags=[]; let why='';
        if(e){
          const rs=String(e.reason||'');
          if(e.result==='已提交'){ /* 已举报，走平台状态 */ }
          else if(/^需人工介入/.test(rs)||/需卖家提供质量证明/.test(rs)){
            why=humanWhy(e); tags.push('需人工介入');
            if(/买家发过图片/.test(rs)) tags.push('买家发过图片');
            if(/买家反馈真实问题/.test(rs)) tags.push('买家反馈真实问题');
            if(/需卖家提供质量证明/.test(rs)) tags.push('需卖家提供质量证明');
          }
          else if(/不可举报/.test(rs)){ why='平台判定不符合举报条件'; tags.push('不可举报'); }
          if(/转人工|需人工|不宜举报|质量证明|拿不准|无法判断|不宜直接举报/.test(why)) tags.push('需转人工');
          else if(/无需举报/.test(rs)){ why='平台判定无需举报'; tags.push('无需举报'); }
          else if(/已举报过/.test(rs)){ why='该订单已有举报记录（平台一单一报）'; tags.push('已举报过'); }
          else if(/买家有沟通/.test(rs)){ why='买家与客服有过沟通，需人工查看聊天内容'; tags.push('买家有沟通'); }
          else if(/飞鸽未加载/.test(rs)){ why='飞鸽页面未加载成功，需重试'; tags.push('待重试'); }
          else if(/未查到/.test(rs)){ why='平台查询未找到该单，需重试'; tags.push('待重试'); }
          else if(/演练模式/.test(rs)){ why='演练模式跑过但未提交：平台允许举报（can_select=true），需人工确认后提交'; tags.push('待提交(演练)'); }
        }
        // 平台有记录 → 覆盖为平台事实
        const av=results[r.order_id];
        let status='未举报';
        if(av){
          // 平台审核结果出来后：清掉预检/跳过阶段的旧标签和旧 why，以平台事实为准（标签清洗）
          status=auditOf(r.order_id);
          const PRECHECK=/^(不可举报|无需举报|已举报过|待重试|待提交\(演练\)|买家有沟通|买家发过图片|买家反馈真实问题|需卖家提供质量证明|需人工介入)$/;
          for(let i=tags.length-1;i>=0;i--) if(PRECHECK.test(tags[i])) tags.splice(i,1);
          tags.push(...auditTags(r.order_id));
          const act=String(av.resultMsg||'');
          const m=act.match(/平台动作:([^;]+)/);
          why=(auditOf(r.order_id)==='举报失败')?('平台拒绝：'+act.replace(/^失败原因[:：]/,'').split(';平台建议')[0]):(m?m[1]:'已提交举报，平台已受理');
        }
        if(e && e.result==='已提交' && !av) status='已举报';
        if(!av && !(e&&e.result==='已提交') && tags.some(t=>/^(需人工介入|需卖家提供质量证明|待重试)$/.test(t))) status='需转人工';
        if(status==='需转人工' && !tags.some(t=>t==='需转人工')) tags.unshift('需转人工');
        if(status==='需转人工') tags.unshift('需转人工');
        items.push({kind:label,shop:r.shop||'',order_id:r.order_id||'',reason:r.reason||r.content||'',date:dd||'',
          desc:r.report_desc||'',status:status,why:why,tags:tags,submitted_at:(e&&e.at)||'',
          product_name:r.product_name||'',product_id:r.product_id?String(r.product_id):'',
          submitter:(everSubmitted.has(r.order_id))?'AI提交':'',
          auditStatus:(av&&av.auditStatus!=null)?av.auditStatus:null, auditMsg:(av&&av.resultMsg)||''});
      }
    }
    // ② 平台有记录、但不在清单里的单
    for(const [oid,v] of Object.entries(results)){
      if(seen.has(oid)) continue; seen.add(oid);
      items.push({kind:(v.scene||'').indexOf('售后')>=0?'品退':'中差评',shop:v.shop||'',order_id:oid,reason:v.sub||'',
        date:(v.created||'').slice(0,10),desc:'',status:auditOf(oid),why:(auditOf(oid)==='举报失败')?('平台拒绝理由：'+String(v.resultMsg||'').replace(/^失败原因[:：]/,'').split(';平台建议')[0]):'已提交举报（平台审核中）',
        tags:auditTags(oid),submitted_at:v.created||'',submitter:'AI提交',
        product_name:'',product_id:'',
        auditStatus:(v.auditStatus!=null?v.auditStatus:null),auditMsg:v.resultMsg||''});
    }
    return {generated_at:new Date().toISOString(), _results:results, count:items.length,
      items};
  }
    function buildStats(){
    const data=buildData(), logs=collectLogs(), results=readResults();
    const subMap=new Map();
    for(const e of logs){ if(e.result!=='已提交'||!e.order) continue; if(!subMap.has(e.order)) subMap.set(e.order,e); }
    const today=new Date().toISOString().slice(0,10);
    const rows=[...subMap.values()].map(e=>{ const a=results[e.order]||{}; return {
      order_id:e.order, shop:e.shop||'', kind:e.kind==='review'?'中差评':'品退', at:e.at||'',
      submitReason:e.submitReason||e.reason||'', buyerReason:e.buyer||'',
      auditStatus:(a.auditStatus!=null?a.auditStatus:null), auditMsg:a.resultMsg||'', auditTime:a.auditTime||'' }; });
    // 平台有结果但我们没日志的（手动提交）
    for(const [oid,a] of Object.entries(results)){ if(subMap.has(oid)) continue; rows.push({order_id:oid,shop:a.shop||'',kind:(a.scene||'').indexOf('售后')>=0?'品退':'中差评',at:(a.created||'').replace(/\//g,'-'),submitReason:a.sub||'',buyerReason:'',auditStatus:(a.auditStatus!=null?a.auditStatus:null),auditMsg:a.resultMsg||'',auditTime:a.auditTime||''}); }
    const pass=rows.filter(r=>r.auditStatus===6).length, reject=rows.filter(r=>r.auditStatus===3).length;
    const pending=rows.filter(r=>r.auditStatus==null||r.auditStatus===1).length;
    const byReason={},byShop={},rejTop={},trend={};
    for(const r of rows){ const k=r.submitReason||'(未知)'; byReason[k]=byReason[k]||{total:0,pass:0,reject:0}; byReason[k].total++; if(r.auditStatus===6)byReason[k].pass++; if(r.auditStatus===3)byReason[k].reject++;
      const s=r.shop||'?'; byShop[s]=byShop[s]||{total:0,pass:0,reject:0,pending:0}; byShop[s].total++; if(r.auditStatus===6)byShop[s].pass++; else if(r.auditStatus===3)byShop[s].reject++; else byShop[s].pending++;
      if(r.auditStatus===3){ let m=(r.auditMsg||'').replace(/^失败原因[:：]/,'').split(';平台建议')[0].trim()||'(无理由)'; rejTop[m]=(rejTop[m]||0)+1; }
      const d=(r.at||'').slice(0,10); if(d){ trend[d]=trend[d]||{sub:0,pass:0,reject:0}; trend[d].sub++; if(r.auditStatus===6)trend[d].pass++; if(r.auditStatus===3)trend[d].reject++; } }
    const days=[]; for(let i=29;i>=0;i--){ const dd=new Date(Date.now()-i*86400000); days.push(dd.getFullYear()+'-'+String(dd.getMonth()+1).padStart(2,'0')+'-'+String(dd.getDate()).padStart(2,'0')); }
    // 真实总量趋势（全部品退 / 全部中差评，按天；来自采集）
    const totalDaily={quality:{},review:{}};
    try{ const qd=readJson(path.join(dataDir(),'appeal-daily-quality_returns.json')); if(qd&&qd.daily) totalDaily.quality=qd.daily; }catch(e){}
    try{ const rd=readJson(path.join(dataDir(),'appeal-daily-negative_reviews.json')); if(rd&&rd.daily) totalDaily.review=rd.daily; }catch(e){}
    const byShopDay={};
    for(const it of data.items){ const dd=it.date; if(!dd) continue; const sh=it.shop||'?'; byShopDay[sh]=byShopDay[sh]||{}; byShopDay[sh][dd]=byShopDay[sh][dd]||{q:0,r:0}; if(it.kind==='品退')byShopDay[sh][dd].q++; else byShopDay[sh][dd].r++; }
    const todoItems=[];
    const qTotal=data.items.filter(i=>i.kind==='品退').length, rTotal=data.items.filter(i=>i.kind==='中差评').length;
    const pendByShop={}; for(const i of todoItems){ const k=i.shop||'?'; pendByShop[k]=(pendByShop[k]||0)+1; }
    const manualByShop={}; for(const i of data.items){ if(i.reason&&/（平台判定不可举报）|待同步/.test(i.reason)) continue; }
    const byKind={}; for(const k of ['品退','中差评']) byKind[k]={total:0,today:0,sub:0,pass:0,reject:0,notNeed:0,notReportable:0,pending:0,rate:0};
    for(const it of data.items){ const k=it.kind; if(!byKind[k]) continue; byKind[k].total++; if(it.date===today)byKind[k].today++; if(it.status==='不可举报')byKind[k].notReportable++; else if(it.status==='无需举报')byKind[k].notNeed++; }
    for(const [oid,a] of Object.entries(results)){ const k=(a.scene||'').indexOf('售后')>=0?'品退':((a.scene||'').indexOf('评价')>=0?'中差评':null); if(!k||!byKind[k]) continue; byKind[k].sub++; if(a.auditStatus===6)byKind[k].pass++; else if(a.auditStatus===3)byKind[k].reject++; else byKind[k].pending++; }
    for(const k of Object.keys(byKind)){ const v=byKind[k]; v.rate=(v.pass+v.reject)?Math.round(v.pass/(v.pass+v.reject)*100):0; }
    const todaySub=rows.filter(r=>(r.at||'').slice(0,10)===today && r.auditStatus!==undefined).length;
    const todaySubmitted=logs.filter(e=>e.result==='已提交'&&(e.at||'').slice(0,10)===today).length;
    return {generated_at:new Date().toISOString(),
      notReportable:data.notReportable,
      byKind,
      ops:{todo:todoItems.length, qTotal, rTotal, pendByShop, todaySub:todaySubmitted, manualByShop},
      boss:{sub:rows.length, pass, reject, pending, rate:((pass+reject)?Math.round(pass/(pass+reject)*100):0), byShop, trend, days, byShopDay, totalDaily},
      review:{rows, byReason, rejTop}};
  }
  function buildCsv(){
    const data=buildData();
    const head=['状态','类型','店铺','订单号','商品名称','商品编码','原因/内容','日期','提交人','审核状态','审核理由','提交时间'];
    const stat=s=>s===3?'驳回':s===6?'通过':(s==null?'':'审核中');
    const rows=data.items.map(i=>[i.status,i.kind,i.shop,i.order_id,i.product_name||'',i.product_id||'',i.reason,i.date,i.submitter||'',stat(i.auditStatus),(i.auditMsg||'').replace(/\s+/g,' '),i.submitted_at||'']);
    const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
    return '\uFEFF'+[head,...rows].map(r=>r.map(q).join(',')).join('\r\n');
  }
  function start(){
    if(server) return Promise.resolve(url());
    const handler=(req,res)=>{
      try{
        if(req.method==='POST' && req.url==='/queue/update'){
          let raw=''; req.on('data',c=>{ raw+=c; if(raw.length>1e5) req.destroy(); });
          req.on('end',()=>{
            try{
              const b=JSON.parse(raw||'{}');
              if(!b.order_id) throw Error('order_id required');
              const dir=reportsDir(); const f=path.join(dir,'review-queue.json');
              let q={items:{}}; try{ q=JSON.parse(fs.readFileSync(f,'utf8')); if(!q.items) q.items={}; }catch(e){}
              const it=q.items[b.order_id];
              if(!it) throw Error('队列中无此单');
              if(b.action==='confirm'){ it.status='confirmed'; if(b.desc) it.desc=String(b.desc).slice(0,200); if(b.sub) it.sub=String(b.sub); if(b.label) it.label=String(b.label); it.confirmedAt=new Date().toISOString(); }
              else if(b.action==='reject'){ it.status='rejected'; it.rejectedAt=new Date().toISOString(); }
              else if(b.action==='reset'){ it.status='pending'; }
              else if(b.desc||b.sub){ if(b.desc) it.desc=String(b.desc).slice(0,200); if(b.sub){ it.sub=String(b.sub); it.label=b.label?String(b.label):it.label; } }
              fs.writeFileSync(f,JSON.stringify(q,null,2)); fs.chmodSync(f,0o600);
              res.setHeader('Content-Type','application/json;charset=utf-8'); res.end(JSON.stringify({ok:true,status:it.status}));
            }catch(e){ res.statusCode=400; res.setHeader('Content-Type','application/json;charset=utf-8'); res.end(JSON.stringify({ok:false,error:String(e&&e.message||e)})); }
          });
          return;
        }
        if(req.url==='/'||req.url.startsWith('/?')){ res.setHeader('Content-Type','text/html;charset=utf-8'); res.end(HTML); return }
        if(req.url.startsWith('/queue')){ 
          const f=path.join(reportsDir(),'review-queue.json');
          let q={items:{}}; try{ q=JSON.parse(fs.readFileSync(f,'utf8')); }catch(e){}
          const SMAP={pending:'待核对',confirmed:'已确认',submitted:'已提交',rejected:'不举报',gone:'已失效'};
          const items=Object.values(q.items||{}).map(x=>Object.assign({},x,{status:SMAP[x.status]||x.status||'待核对'}));
          res.setHeader('Content-Type','application/json;charset=utf-8'); res.end(JSON.stringify({items, count:items.length})); return;
        }
        if(req.url.startsWith('/data')){ res.setHeader('Content-Type','application/json;charset=utf-8'); res.end(JSON.stringify(buildData())); return }
        if(req.url.startsWith('/stats')){ res.setHeader('Content-Type','application/json;charset=utf-8'); res.end(JSON.stringify(buildStats())); return }
        if(req.url.startsWith('/export')){ res.setHeader('Content-Type','text/csv;charset=utf-8'); res.setHeader('Content-Disposition','attachment; filename="appeal-worklist.csv"'); res.end(buildCsv()); return }
        res.statusCode=404; res.end('not found');
      }catch(e){ res.statusCode=500; res.end('error '+e.message) }
    };
    const ports=[8899,8900,8901,8902,0];
    return new Promise((resolve)=>{ let i=0; const attempt=()=>{ const s=http.createServer(handler);
      s.once('error',()=>{ try{s.close()}catch(e){}; i++; if(i<ports.length) attempt(); else resolve('') });
      s.listen(ports[i],'127.0.0.1',()=>{ server=s; port=s.address().port; resolve(url()) }); }; attempt(); });
  }
  function url(){ return 'http://127.0.0.1:'+port+'/' }
  function close(){ try{ server&&server.close() }catch(e){} server=null }
  return {start,url,close,data:buildData,stats:buildStats};
}
module.exports={createAppealWeb};
