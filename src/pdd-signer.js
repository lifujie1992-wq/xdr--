// pdd-signer.js — 拼多多 mms 后台 anti-content 离线签名
// 算法来源: ~/军火库/多多/work/pdd-mms-web-sign（2026-10-17 逆向，服务端验证通过）
// fbeZ 子包剥离自 commons.b14b84eb9b769af80c0c.js（v20261012201535_ffb90f1c）。
// PDD 更换 bundle 时按 case 的 01-observe.mjs → 剥离流程重新导出本文件。
const fs = require('node:fs');
const path = require('node:path');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ── 最小浏览器环境桩（fbeZ 采集器触碰面；报错驱动逐个补齐，勿删）──
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
if (!globalThis.location) globalThis.location = { href: 'https://mms.pinduoduo.com/home/', port: '', protocol: 'https:', host: 'mms.pinduoduo.com', hostname: 'mms.pinduoduo.com', pathname: '/home/', search: '' };
try { if (!globalThis.navigator || globalThis.navigator.userAgent !== UA) Object.defineProperty(globalThis, 'navigator', { value: { userAgent: UA, platform: 'MacIntel', languages: ['zh-CN', 'zh'], language: 'zh-CN', plugins: { length: 0 }, hardwareConcurrency: 8, webdriver: false }, configurable: true }); } catch {}
if (!globalThis.screen) globalThis.screen = { width: 1920, height: 1080, availWidth: 1920, availHeight: 1055, colorDepth: 24, pixelDepth: 24 };
if (!globalThis.history) globalThis.history = { length: 2 };
if (!globalThis.document) globalThis.document = { cookie: '', addEventListener() {}, removeEventListener() {}, createElement: () => ({ getContext: () => null }), documentElement: { scrollTop: 0, scrollLeft: 0, clientWidth: 1920, clientHeight: 1080 }, body: { scrollTop: 0, scrollLeft: 0, clientWidth: 1920, clientHeight: 1080, appendChild() {} } };
if (!globalThis.Element) globalThis.Element = { prototype: {} };
if (!globalThis.addEventListener) globalThis.addEventListener = () => {};
if (!globalThis.removeEventListener) globalThis.removeEventListener = () => {};

let _cls = null;
function loadCls() {
  if (_cls) return _cls;
  const body = fs.readFileSync(path.join(__dirname, 'pdd-fbeZ-module.js'), 'utf8');
  const mod = { exports: {} };
  const shims = { '8oxB': process }; // webpack process shim → Node process
  const r = (id) => { if (!(id in shims)) throw new Error('pdd-signer: missing shim module ' + id); return shims[id]; };
  new Function('t', 'e', 'r', body)(mod, mod.exports, r);
  _cls = mod.exports.default || mod.exports;
  if (typeof _cls !== 'function') throw new Error('pdd-signer: fbeZ 导出异常');
  return _cls;
}

/** 生成 anti-content。serverTime: 毫秒时间戳（偏差数秒内服务端均接受） */
function genAntiContent(serverTime) {
  return new (loadCls())({ serverTime }).messagePack();
}

// ── 服务器时间缓存（复刻页面 window.mmsTime 逻辑：新鲜窗口 150s）──
let baseline = null; // { serverTime, localTime }
const FRESH_MS = 150000;

/** cookieHeader: "a=b; c=d"；返回毫秒服务器时间。失败回退本地时间 */
async function getServerTime(cookieHeader) {
  const now = Date.now();
  if (baseline && now - baseline.localTime < FRESH_MS) {
    return now - baseline.localTime + baseline.serverTime;
  }
  try {
    const res = await fetch('https://mms.pinduoduo.com/api/server/_stm', {
      headers: { cookie: cookieHeader || '', 'user-agent': UA, referer: 'https://mms.pinduoduo.com/home/' },
    });
    const j = await res.json();
    if (j && j.server_time) {
      baseline = { serverTime: j.server_time, localTime: Date.now() };
      return baseline.serverTime;
    }
  } catch {}
  return Date.now();
}

module.exports = { genAntiContent, getServerTime, UA };
