// 申诉经验学习：从平台审核结果（举报成功/失败）里整理案例，供大模型判断品退/中差评时参照。
// 纯函数模块（不依赖 electron），方便离线评估：node tools/eval-quality-learn.js
'use strict';

const QUALITY_REJECT_HINT = /品质问题|商品存在品质|签收后发起品质/;

const shortReason = r => String(r || '').replace(/[（(]商品品质原因[）)]|[（(]物流品质原因[）)]/g, '').trim();
const cleanMsg = m => String(m || '').replace(/^失败原因[:：]/, '').split(/;平台建议|；平台建议/)[0].replace(/^商家您好，?/, '').trim().slice(0, 60);

// items：appeal-web buildData().items（含 status/aftersale_desc/appeal_desc/auditMsg/content/rank/report_reason）
function buildCases(items, {qOk = 40, qBad = 30, rOk = 20, rBad = 20} = {}) {
  const Q_OK = [], Q_BAD = [], R_OK = [], R_BAD = [];
  const seen = new Set();
  const sorted = [...(items || [])].sort((a, b) =>
    String(b.submitted_at || b.date || '').localeCompare(String(a.submitted_at || a.date || '')));
  for (const x of sorted) {
    if (x.status !== '举报成功' && x.status !== '举报失败') continue;
    const ok = x.status === '举报成功';
    if (x.kind === '品退') {
      const d = String(x.aftersale_desc || '').trim();
      if (!d) continue;   // 没写说明的看不出规律，不进案例
      if (!ok && !QUALITY_REJECT_HINT.test(String(x.auditMsg || ''))) continue;   // 失败案例只要「买家表明品质问题」这类，最有参考价值
      const key = 'q' + ok + d;
      if (seen.has(key)) continue; seen.add(key);
      (ok ? Q_OK : Q_BAD).push({order_id: x.order_id, reason: shortReason(x.aftersale || x.reason), desc: d.slice(0, 60),
        appeal: ok ? String(x.appeal_desc || '').slice(0, 120) : '', fail: ok ? '' : cleanMsg(x.auditMsg)});
    } else if (x.kind === '中差评') {
      const c = String(x.content || '').trim();
      if (!c) continue;
      const key = 'r' + ok + c;
      if (seen.has(key)) continue; seen.add(key);
      (ok ? R_OK : R_BAD).push({order_id: x.order_id, rank: x.rank || '', content: c.slice(0, 60), reason: x.report_reason || '',
        fail: ok ? '' : cleanMsg(x.auditMsg)});
    }
  }
  return {
    builtAt: new Date().toISOString(),
    quality: {ok: Q_OK.slice(0, qOk), bad: Q_BAD.slice(0, qBad)},
    review: {ok: R_OK.slice(0, rOk), bad: R_BAD.slice(0, rBad)},
    counts: {qualityOk: Q_OK.length, qualityBad: Q_BAD.length, reviewOk: R_OK.length, reviewBad: R_BAD.length},
  };
}

function qualityCasesText(cases) {
  const q = (cases && cases.quality) || {ok: [], bad: []};
  const ok = q.ok.map((c, i) => `${i + 1}. 原因「${c.reason}」说明「${c.desc}」`).join('\n') || '（暂无）';
  const bad = q.bad.map((c, i) => `${i + 1}. 原因「${c.reason}」说明「${c.desc}」→ 驳回：${c.fail}`).join('\n') || '（暂无）';
  const tpl = (q.ok.find(c => c.appeal) || {}).appeal || '';
  return {ok, bad, tpl};
}

const QUALITY_RULES = `背景：买家退货时选了「品质原因」（商品质量不好 / 商品与描述不符 等），会计入店铺品退率。
如果买家实际是个人主观原因（不喜欢、不想要、不合适、尺码不合适、买大/买小、上身效果不好、和想象的不一样等），商家可以举报「消费者选择品质退货与事实不符」，平台核实后剔除品退率。
平台驳回的最主要原因：买家已在【售后说明】或【飞鸽聊天】中表明商品存在品质问题——比如质量差、做工差、开线、破洞、起球、掉色、色差、薄/透、异味、皱、与描述/图片/直播不符、尺码不标准等。只要出现这类具体问题描述，举报基本必败。`;

// 第一轮：只看售后说明的批量初筛（便宜），决定要不要进入完整判断
function qualityScreenPrompt(cases) {
  const t = qualityCasesText(cases);
  return `你是资深抖音小店运营，负责从品退售后单里挑出值得举报的。
${QUALITY_RULES}

【平台判举报成功的历史案例】
${t.ok}

【平台驳回的历史案例】
${t.bad}

现在给你一批售后单（只有售后原因和说明），逐条判断：
- "subjective"：说明是个人主观原因，没有提到任何具体品质问题，且和成功案例同类
- "quality"：说明里提到了具体品质问题或与描述不符，和驳回案例同类
- "uncertain"：看不出来
严格只输出 JSON：{"items":[{"i":序号,"v":"subjective|quality|uncertain"}]}`;
}

// 第二轮：结合飞鸽聊天的完整判断 + 按成功案例写法生成申诉说明
function qualityJudgePrompt(cases) {
  const t = qualityCasesText(cases);
  return `你是资深抖音小店运营，负责判断一笔品退售后单要不要举报，并写举报说明。
${QUALITY_RULES}

【平台判举报成功的历史案例】
${t.ok}

【平台驳回的历史案例】
${t.bad}

判断规则：
- verdict="appeal"：售后说明和买家聊天里都只有个人主观原因，没有任何具体品质问题描述，且与上面某条成功案例同类 → 写举报说明
- verdict="quality_claim"：售后说明或买家聊天里出现了具体品质问题（见背景）、或买家发过问题图片 → 不举报
- verdict="uncertain"：拿不准、或和成功案例都不像 → 交人工
- confidence：0~1，只有和成功案例高度相似、且聊天里买家没有任何品质抱怨时才给 0.85 以上
- desc：举报说明，100 字以内，仿照成功案例的写法，写清「售后原因选了XX，但说明/沟通显示是XX主观原因，与所选品质原因不符，恳请核实剔除品退率考核」，不要编造事实${t.tpl ? '\n  成功案例的说明写法参考：' + t.tpl : ''}
严格只输出 JSON，不要解释：
{"verdict":"appeal|quality_claim|uncertain","confidence":0到1,"similar":"最像的那条成功案例的说明原文或空","why":"一句话理由","desc":"举报说明或空"}`;
}

function qualityJudgeUser({reason, desc, buyerMsgs, buyerImgs}) {
  const msgs = (buyerMsgs || []).map(m => String(m || '').trim()).filter(Boolean);
  return `售后原因：${shortReason(reason) || '（空）'}
售后说明：${String(desc || '').trim() || '（空）'}
买家飞鸽聊天（只含买家发言）：${msgs.length ? msgs.join(' | ').slice(0, 800) : '（买家没有发言）'}
买家是否发过图片/视频：${buyerImgs > 0 ? '是（' + buyerImgs + ' 张）' : '否'}`;
}

function reviewCasesText(cases) {
  const r = (cases && cases.review) || {ok: [], bad: []};
  if (!r.ok.length && !r.bad.length) return '';
  const ok = r.ok.map((c, i) => `${i + 1}. ${c.rank || ''}「${c.content}」→ 用「${c.reason}」举报成功`).join('\n') || '（暂无）';
  const bad = r.bad.map((c, i) => `${i + 1}. ${c.rank || ''}「${c.content}」→ 用「${c.reason}」被驳回：${c.fail}`).join('\n') || '（暂无）';
  return `\n\n【平台审核过的历史案例（请参照：和成功案例同类的大胆报，和驳回案例同类的不要报或交人工）】\n成功：\n${ok}\n驳回：\n${bad}`;
}

function parseJSON(txt) {
  let t = String(txt || '').trim();
  const m = t.match(/\{[\s\S]*\}/); if (m) t = m[0];
  if (!t) throw new Error('空响应');
  return JSON.parse(t);
}

function normalizeJudge(o) {
  const V = ['appeal', 'quality_claim', 'uncertain'];
  return {
    verdict: V.includes(o && o.verdict) ? o.verdict : 'uncertain',
    confidence: Math.max(0, Math.min(1, Number(o && o.confidence) || 0)),
    similar: String((o && o.similar) || '').slice(0, 60),
    why: String((o && o.why) || '').slice(0, 80),
    desc: String((o && o.desc) || '').slice(0, 120),
  };
}

// OpenAI 兼容接口；cfg={base_url,key,model}
async function chatJSON(cfg, sys, user, {timeoutMs = 30000, tries = 3, maxTokens = 4000} = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch(cfg.base_url + '/chat/completions', {method: 'POST', signal: ctrl.signal,
        headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key},
        body: JSON.stringify({model: cfg.model, max_tokens: maxTokens, messages: [{role: 'system', content: sys}, {role: 'user', content: user}]})});
      clearTimeout(timer);
      const j = await r.json();
      return parseJSON(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr || new Error('大模型无结果');
}

module.exports = {buildCases, qualityScreenPrompt, qualityJudgePrompt, qualityJudgeUser, reviewCasesText, normalizeJudge, parseJSON, chatJSON, shortReason};
