// pdd-client.js — 拼多多店铺直连请求（算法 + 工作台分区登录态配合）
// 登录态永不落地文件：从 persist:shop-<id> 分区 session 直读 cookie，
// 随工作台重登自动续期。仅自有店铺、限速使用。
const { session } = require('electron');
const { genAntiContent, getServerTime, UA } = require('./pdd-signer');

const MMS = 'https://mms.pinduoduo.com';
const MIN_GAP_MS = 1200; // 同店请求最小间隔（限速）
const lastCallAt = new Map();

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function createPddClient({ store }) {
  /** 分区 cookie → header 串。PASS_ID 缺失视为登录态失效 */
  async function cookieHeader(shopId) {
    const shop = store.get(shopId);
    if (!shop) throw Error('店铺不存在');
    if (shop.platform !== '拼多多') throw Error('仅支持拼多多店铺');
    const ses = session.fromPartition('persist:shop-' + shopId);
    const cs = await ses.cookies.get({ url: MMS });
    const now = Date.now() / 1000;
    const live = cs.filter((c) => c.value && (!c.expires || c.expires > now));
    if (!live.some((c) => c.name === 'PASS_ID')) throw Error('该店拼多多登录态缺失或已过期（请在工作台内重新登录）');
    return live.map((c) => c.name + '=' + c.value).join('; ');
  }

  /**
   * 发起 mms 业务请求。
   * opts: { method: 'GET'|'POST', path: '/janus/api/...', query?: object, body?: object }
   * 返回 { status, data }（data 为上游 JSON 原样）
   */
  async function request(shopId, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') throw Error('仅支持 GET/POST');
    let p = String(opts.path || '');
    if (!p.startsWith('/')) p = '/' + p;
    if (p.length > 300 || /[^A-Za-z0-9\-._~!$&+,/:;=?@\[\]%]/.test(p.replace(/%[0-9A-Fa-f]{2}/g, ''))) throw Error('path 非法');
    if (opts.body != null && (typeof opts.body !== 'object' || Array.isArray(opts.body))) throw Error('body 须为 JSON 对象');

    // 限速
    const last = lastCallAt.get(shopId) || 0;
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt.set(shopId, Date.now());

    const cookie = await cookieHeader(shopId);
    const serverTime = await getServerTime(cookie);
    const token = genAntiContent(serverTime);

    let url = MMS + p;
    let body;
    if (method === 'GET') {
      const q = new URLSearchParams(opts.query || {});
      q.set('crawlerInfo', token);
      url += (url.includes('?') ? '&' : '?') + q.toString();
    } else {
      const obj = Object.assign({}, opts.body || {}, { crawlerInfo: token });
      body = JSON.stringify(obj);
    }

    const res = await fetch(url, {
      method,
      headers: {
        cookie,
        'content-type': 'application/json',
        'user-agent': UA,
        referer: MMS + '/home/',
        origin: MMS,
        'anti-content': token,
      },
      body,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }

  return {
    request,
    cookieHeader,
    serverTime: async (shopId) => getServerTime(await cookieHeader(shopId)),
  };
}

module.exports = { createPddClient };
