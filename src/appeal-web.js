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
table.list col.c1{width:82px}table.list col.c2{width:54px}table.list col.c3{width:110px}
table.list col.c4{width:166px}table.list col.c5{width:186px}table.list col.c6{width:122px}
table.list col.c7{width:150px}table.list col.c8{width:94px}table.list col.c9{width:72px}table.list col.c10{width:250px}table.list col.c11{width:190px}
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
    <button data-tab="list">工单</button>
  </div>
  <div class="tools"><span id="gen" class="hint"></span><a class="btn" href="/export.csv" download>导出 CSV</a><button class="primary" id="refresh">刷新</button></div>
</header>
<main>
  <div id="ops"></div>
  <div id="boss" class="hide"></div>
  <div id="review" class="hide"></div>
  <div id="list" class="hide">
    <div class="tools" style="margin:0 0 10px"><select id="fkind"><option value="">全部类型</option><option>品退</option><option>中差评</option></select>
      <select id="fstatus"><option value="">全部状态</option><option>已举报</option><option>举报成功</option><option>不可举报</option><option>需转人工</option><option>未处理</option></select>
      <select id="ftag"><option value="">全部标签</option><option>不可举报</option><option>无需举报</option><option>已举报过</option><option>买家有沟通</option><option>需人工介入</option><option>需卖家提供质量证明</option><option>已驳回</option><option>审核中</option></select>
      <input id="fd1" type="date" title="开始日期"><span class="hint">~</span><input id="fd2" type="date" title="结束日期">
      <select id="frange"><option value="">全部时间</option><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option></select>
      <input id="fq" placeholder="搜索店铺/订单号/商品名/编码…">
      <select id="fpage"><option value="50">50 条/页</option><option value="100">100 条/页</option><option value="300">300 条/页</option><option value="0">全部</option></select>
      <span id="fcount" class="hint"></span></div>
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
function badge(s){const M={'已举报':'st-doing','举报成功':'st-ok','不可举报':'st-no','需转人工':'st-human','未处理':'st-todo'};const c=M[s]||'st-human';return '<span class="st '+c+'">'+esc(s||'—')+'</span>'}
function auditCell(x){const tip=esc((x.auditMsg||'').replace(/\s+/g,' ').slice(0,200));if(!/^(已举报|举报中|已通过|已驳回)$/.test(x.status||''))return '<td></td>';if(x.auditStatus===3)return '<td class="rej" title="'+tip+'">❌ 驳回：'+esc((x.auditMsg||'').replace(/^失败原因[:：]/,'').split(';平台建议')[0])+'</td>';if(x.auditStatus===6)return '<td class="okc">✅ 审核通过</td>';if(x.auditStatus==null)return '<td class="wait">待同步</td>';return '<td class="wait">审核中</td>'}
function drawTabs(){document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===TAB));['ops','boss','review','list'].forEach(t=>$(t).classList.toggle('hide',t!==TAB))}
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
let PAGE=1;
function drawList(){
  const kind=$('fkind').value, st=$('fstatus').value, q=$('fq').value.trim().toLowerCase();
  const d1=$('fd1').value, d2=$('fd2').value, rg=$('frange').value;
  let from=d1, to=d2;
  if(rg){ const d=new Date(); d.setDate(d.getDate()-Number(rg)); const pad=n=>String(n).padStart(2,'0');
    from=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  const rows=DATA.items.filter(x=>{
    if(!x.status) return false;
    if(kind&&x.kind!==kind) return false;
    if(st&&x.status!==st) return false;
    if(q){ const hay=((x.shop||'')+' '+(x.order_id||'')+' '+(x.product_name||'')+' '+(x.product_id||'')).toLowerCase(); if(hay.indexOf(q)<0) return false }
    const d=String(x.date||'').slice(0,10);
    if(from&&d&&d<from) return false;
    if(to&&d&&d>to) return false;
    return true;
  });
  const size=Number(($('fpage')&&$('fpage').value)||50);
  const pages=size>0?Math.max(1,Math.ceil(rows.length/size)):1;
  if(PAGE>pages) PAGE=pages; if(PAGE<1) PAGE=1;
  const view=size>0?rows.slice((PAGE-1)*size,PAGE*size):rows;
  $('fcount').textContent='共 '+rows.length+' 条';
  if(!rows.length){ $('listwrap').innerHTML='<div class="empty">没有符合条件的记录。</div>'; $('pager').innerHTML=''; return }
  $('listwrap').innerHTML='<table class="list"><colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4"><col class="c5"><col class="c6"><col class="c7"><col class="c8"><col class="c9"><col class="c11"><col class="c10"></colgroup>'
   +'<thead><tr><th>状态</th><th>类型</th><th>店铺</th><th>订单号</th><th>商品名称</th><th>商品编码</th><th>原因/内容</th><th>日期</th><th>提交人</th><th>详情</th><th>审核结果</th></tr></thead><tbody>'
   +view.map(x=>'<tr><td>'+badge(x.status)+'</td><td class="kind">'+esc(x.kind)+'</td><td>'+esc(x.shop)+'</td><td class="mono">'+esc(x.order_id)+'</td><td class="desc" title="'+esc(x.product_name||'')+'">'+esc(x.product_name||'—')+'</td><td class="mono">'+esc(x.product_id||'—')+'</td><td>'+esc(x.reason)+'</td><td>'+esc(x.date)+'</td><td>'+(x.submitter?'<span class="tag">'+esc(x.submitter)+'</span>':'')+'</td>'+auditCell(x)+'</tr>').join('')+'</tbody></table>';
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
     + row('总数',(v.total||0)+' 条')
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
function draw(){drawTabs();if(!STATS)return;$('gen').textContent='更新于 '+(STATS.generated_at?new Date(STATS.generated_at).toLocaleString('zh-CN'):'');if(TAB==='ops')drawOps();else if(TAB==='boss')drawBoss();else if(TAB==='review')drawReview();else drawList()}
function load(){Promise.all([fetch('/data').then(r=>r.json()),fetch('/stats').then(r=>r.json())]).then(([d,s])=>{DATA=d;STATS=s;draw()}).catch(()=>{})}
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{TAB=b.dataset.tab;draw()});
$('refresh').onclick=load;['fkind','fstatus','ftag','fd1','fd2','frange','fpage'].forEach(id=>{const el=$(id); if(el){ el.onchange=()=>{PAGE=1;draw()}; el.oninput=()=>{PAGE=1;draw()}; }});$('fq').oninput=()=>{PAGE=1;draw()};
load();setInterval(load,30000);
</script></body></html>`;

function createAppealWeb({app, appeal}){
  let server=null, port=null;
  const dataDir = () => path.join(app.getPath('userData'),'business-data');
  const reportsDir = () => path.join(app.getPath('userData'),'appeal-reports');
  const readJson = f => { try{ return JSON.parse(fs.readFileSync(f,'utf8')) }catch(e){ return null } };
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
    // 主状态：已举报 / 未举报 / 举报成功；其余作为二级标签（取最新一条记录，可拆成多个标签）
    const last={}, everSubmitted=new Set();
    for(const e of logs){ if(!e.order) continue; last[e.order]=e; if(e.result==='已提交') everSubmitted.add(e.order); }
    const done=new Map();
    const TAGS=['不可举报','无需举报','已举报过','买家有沟通','飞鸽未加载','未查到','勾选失败','需卖家提供质量证明'];
    for(const oid of Object.keys(last)){
      const e=last[oid];
      const hasRec=!!results[oid];
      const cur={tags:new Set(), at:e.at, shop:e.shop, kind:e.kind, submitted:(everSubmitted.has(oid)||hasRec)};
      if(cur.submitted) cur.submitter='AI提交';
      if(!hasRec && !cur.submitted) {
        const rs=String(e.reason||'');
        if(/^需人工介入/.test(rs)){ cur.tags.add('需人工介入'); if(/买家发过图片/.test(rs)) cur.tags.add('买家发过图片'); if(/买家有沟通/.test(rs)) cur.tags.add('买家有沟通'); if(/买家反馈真实问题/.test(rs)) cur.tags.add('买家反馈真实问题'); }
        const base=rs.split(' ')[0].split('(')[0].split('·')[0];
        if(TAGS.indexOf(base)>=0) cur.tags.add(base);
      }
      done.set(oid,cur);
    }
    const A=(oid)=>{ const v=results[oid]; if(!v) return null; const a=v.auditStatus; return a===6?'举报成功':'已举报'; };
    // 主分类：只有 4 类
    const BUCKET=(oid,s,tags)=>{
      if(A(oid)==='举报成功') return '举报成功';
      if(A(oid)==='已举报') return '已举报';
      if(s==='已举报') return '已举报';
      if(/^(不可举报|无需举报|已举报过)/.test((tags||[]).join(' '))) return '不可举报';
      if(/^(需人工介入|需卖家提供质量证明|买家有沟通|飞鸽未加载|未查到|勾选失败|未提交)/.test((tags||[]).join(' '))) return '需转人工';
      if(/^(未处理)/.test((tags||[]).join(' '))) return '未处理';
      return '需转人工';
    };
    const tagOf=(oid)=>{ const v=results[oid]; if(!v) return []; const a=v.auditStatus; if(a===6) return ['已通过']; if(a===3) return ['已驳回']; return ['审核中']; };
    const items=[]; const seen=new Set();
    const d0=new Date(Date.now()-30*86400000), minDate=d0.getFullYear()+'-'+String(d0.getMonth()+1).padStart(2,'0')+'-'+String(d0.getDate()).padStart(2,'0');
    for(const [kind,prefix,label] of [['quality','quality_returns','品退'],['review','negative_reviews','中差评']]){
      for(const r of loadWorklist(prefix)){ const dd=r.apply_date||r.comment_date||''; if(dd && dd<minDate) continue;
        seen.add(r.order_id); const s=done.get(r.order_id);
        items.push({kind:label,shop:r.shop||'',order_id:r.order_id||'',reason:r.reason||r.content||'',date:r.apply_date||r.comment_date||'',desc:r.report_desc||'',status:BUCKET(r.order_id,null,(s&&[...(s.tags||[]),...(A(r.order_id)?tagOf(r.order_id):[])])||['未处理']), tags:[...((s&&s.tags)||[]),...(A(r.order_id)?tagOf(r.order_id):[])].length?[...((s&&s.tags)||[]),...(A(r.order_id)?tagOf(r.order_id):[])]:['未处理'], submitted_at:(s&&s.at)||'',
          product_name:r.product_name||'', product_id:r.product_id?String(r.product_id):'', submitter:(s&&s.submitter)||'',
          auditStatus:(results[r.order_id]&&results[r.order_id].auditStatus!=null)?results[r.order_id].auditStatus:null, auditMsg:(results[r.order_id]&&results[r.order_id].resultMsg)||''}); }
    }
    for(const [oid,v] of Object.entries(results)){ if(seen.has(oid)) continue; seen.add(oid);
      items.push({kind:(v.scene||'').indexOf('售后')>=0?'品退':'中差评',shop:v.shop||'',order_id:oid,reason:v.sub||'',date:(v.created||'').slice(0,10),desc:'',status:'举报成功'===A(oid)?'举报成功':'已举报', tags:tagOf(oid), submitted_at:v.created||'',auditStatus:(v.auditStatus!=null?v.auditStatus:null),auditMsg:v.resultMsg||''}); }
    for(const [oid,s] of done){ if(seen.has(oid)) continue; seen.add(oid);
      items.push({kind:s.kind==='review'?'中差评':(s.kind==='quality'?'品退':'—'),shop:s.shop||'',order_id:oid,reason:(s.status==='不可举报'?'（平台判定不可举报）':'（已提交）'),date:'',desc:'',status:BUCKET(oid,s,[...((s.tags)||[]),(s.status||''),...(A(oid)?tagOf(oid):[])].length?[...((s.tags)||[]),(s.status||''),...(A(oid)?tagOf(oid):[])]:['未处理']), tags:[...((s.tags)||[]),...(A(oid)?tagOf(oid):[])].length?[...((s.tags)||[]),...(A(oid)?tagOf(oid):[])]:['未处理'], submitted_at:s.at||'',
        auditStatus:(results[oid]&&results[oid].auditStatus!=null)?results[oid].auditStatus:null, auditMsg:(results[oid]&&results[oid].resultMsg)||''}); }
    return {generated_at:new Date().toISOString(), _results:results, count:items.length,
      appealable:0, appealed:items.filter(i=>/^(已举报|举报中|已通过|已驳回)$/.test(i.status)).length,
      notReportable:items.filter(i=>i.status==='不可举报').length, notNeed:items.filter(i=>i.status==='无需举报').length, items};
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
    const byKind={}; for(const k of ['品退','中差评']) byKind[k]={total:0,sub:0,pass:0,reject:0,notNeed:0,notReportable:0,pending:0,rate:0};
    for(const it of data.items){ const k=it.kind; if(!byKind[k]) continue; byKind[k].total++; if(it.status==='不可举报')byKind[k].notReportable++; else if(it.status==='无需举报')byKind[k].notNeed++; }
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
        if(req.url==='/'||req.url.startsWith('/?')){ res.setHeader('Content-Type','text/html;charset=utf-8'); res.end(HTML); return }
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
