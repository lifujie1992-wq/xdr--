// 离线评估：品退「学习经验」初筛 vs 平台真实结果（3 折交叉，案例与被测单不重叠）
// 用法：node tools/eval-quality-learn.js <data.json> [llm.json]
//   data.json：appeal-web /data 导出（云端 data.json 同格式）
//   llm.json：{base_url,key,model}；不给则用本机 claude CLI（仅验证提示词逻辑，模型与线上不同）
'use strict';
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const L = require('../src/appeal-learn');

const [dataFile, cfgFile] = process.argv.slice(2);
const items = JSON.parse(fs.readFileSync(dataFile, 'utf8')).items;
const cfg = cfgFile ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : null;

async function ask(sys, user) {
  if (cfg) return L.chatJSON(cfg, sys, user, {timeoutMs: 120000});
  const out = execFileSync('claude', ['-p', '--output-format', 'text', sys + '\n\n' + user], {encoding: 'utf8', maxBuffer: 1 << 24, timeout: 300000});
  return L.parseJSON(out);
}

(async () => {
  const pool = items.filter(x => x.kind === '品退' && (x.status === '举报成功' || x.status === '举报失败') && String(x.aftersale_desc || '').trim());
  pool.sort((a, b) => String(a.order_id).localeCompare(String(b.order_id)));
  const folds = [[], [], []]; pool.forEach((x, i) => folds[i % 3].push(x));
  const res = [];
  for (let f = 0; f < 3; f++) {
    const train = items.filter(x => !folds[f].includes(x));
    const cases = L.buildCases(train);
    const sys = L.qualityScreenPrompt(cases);
    for (let s = 0; s < folds[f].length; s += 25) {
      const batch = folds[f].slice(s, s + 25);
      const user = batch.map((x, i) => `${i}. 原因「${L.shortReason(x.aftersale || x.reason)}」说明「${String(x.aftersale_desc).trim().slice(0, 80)}」`).join('\n');
      let out = {items: []};
      try { out = await ask(sys, user); } catch (e) { console.error('LLM失败', e.message); }
      const byI = new Map((out.items || []).map(o => [Number(o.i), o.v]));
      batch.forEach((x, i) => res.push({x, v: byI.get(i) || 'uncertain'}));
      process.stderr.write(`fold ${f} ${s + batch.length}/${folds[f].length}\n`);
    }
  }
  const tab = {};
  for (const r of res) { const k = r.v + '|' + r.x.status; tab[k] = (tab[k] || 0) + 1; }
  const sub = res.filter(r => r.v === 'subjective');
  const okIn = sub.filter(r => r.x.status === '举报成功').length;
  const okAll = res.filter(r => r.x.status === '举报成功').length;
  console.log('样本', res.length, '（成功', okAll, '失败', res.length - okAll, '）');
  console.log('交叉表', tab);
  console.log(`判 subjective 的 ${sub.length} 单里平台成功 ${okIn}，命中率 ${(okIn / Math.max(1, sub.length) * 100).toFixed(0)}%；成功单召回 ${okIn}/${okAll}`);
  console.log('误判（判可报但平台驳回）：'); sub.filter(r => r.x.status === '举报失败').forEach(r => console.log('  ', String(r.x.aftersale_desc).slice(0, 40), '|', String(r.x.auditMsg || '').slice(5, 40)));
  console.log('漏判（平台成功但判 quality）：'); res.filter(r => r.v === 'quality' && r.x.status === '举报成功').forEach(r => console.log('  ', String(r.x.aftersale_desc).slice(0, 40)));
  fs.writeFileSync('/tmp/eval-quality-learn.json', JSON.stringify(res.map(r => ({order_id: r.x.order_id, desc: r.x.aftersale_desc, status: r.x.status, v: r.v})), null, 1));
})();
