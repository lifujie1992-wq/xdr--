// tb-client.js — 淘宝/天猫 mtop 签名直连（工作台分区内存会话直读）
// 算法（军火库/淘宝 case 已破解）: token = _m_h5_tk 前半段;
//   sign = md5(token & t & appKey & data)，appKey=12574478，网关 h5api.m.taobao.com
// 关键设计: 会话核心 cookie(_tb_token_/sn/csg 等)是 session cookie 不落盘，
//   只有进程内 session API 读得到 —— 必须在主进程里做，不能外部读文件。
// 走 net.fetch(useSessionCookies) 复用 Chromium 网络栈: cookie 自动附带/回写，
//   token 过期时服务端 Set-Cookie 新 _m_h5_tk 自动进 jar，重读重签即可。
const { session, net, app } = require('electron');
const crypto = require('node:crypto');

const APPKEY = '12574478';
const H5 = 'https://h5api.m.taobao.com/h5/';
const SELLER = 'https://myseller.taobao.com/';
const MIN_GAP_MS = 800; // 同店请求最小间隔（mtop 接口级限流，Baxia 慎惹）

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function createTbClient({ store }) {
  const lastCallAt = new Map();

  async function sesOf(shopId) {
    const shop = store.get(shopId);
    if (!shop) throw Error('店铺不存在');
    if (shop.platform !== '天猫') throw Error('仅支持天猫/淘宝（千牛）店铺');
    return session.fromPartition('persist:shop-' + shopId);
  }

  async function cookiesOf(shopId) {
    const ses = await sesOf(shopId);
    const cs = await ses.cookies.get({ url: SELLER });
    const now = Date.now() / 1000;
    const alive = cs.filter((c) => c.value && (!c.expirationDate || c.expirationDate > now));
    if (!alive.some((c) => c.name === 'sgcookie')) throw Error('千牛登录态缺失或已过期（请在工作台内重新登录该天猫店铺）');
    return alive;
  }

  function tokenOf(cs) {
    const c = cs.find((c) => c.name === '_m_h5_tk');
    return c ? c.value.split('_')[0] : '';
  }

  function signOf(token, t, dataS) {
    return crypto.createHash('md5').update(`${token}&${t}&${APPKEY}&${dataS}`).digest('hex');
  }

  /**
   * mtop 调用。
   * opts: { api: 'mtop.taobao.trade.order.nums.pc', version?: '1.0', data?: object, method?: 'GET'|'POST' }
   * 返回 { status, ret, data }（mtop 原始信封）
   */
  async function request(shopId, opts = {}) {
    const api = String(opts.api || '');
    if (!/^[A-Za-z0-9_.]{3,120}$/.test(api)) throw Error('api 名非法');
    const version = String(opts.version || '1.0').replace(/[^A-Za-z0-9.]/g, '') || '1.0';
    const method = String(opts.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') throw Error('仅支持 GET/POST');
    const data = opts.data && typeof opts.data === 'object' && !Array.isArray(opts.data) ? opts.data : {};

    const last = lastCallAt.get(shopId) || 0;
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt.set(shopId, Date.now());

    const ses = await sesOf(shopId);
    let cs = await cookiesOf(shopId);
    let token = tokenOf(cs);

    let lastResp = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const t = String(Date.now());
      const ds = JSON.stringify(data);
      const sign = signOf(token, t, ds);
      const qs = new URLSearchParams({
        jsv: '2.6.1', appKey: APPKEY, t, sign, api, v: version,
        type: 'originaljsonp', dataType: 'originaljsonp', data: ds,
      });
      const url = `${H5}${api}/${version}/?${qs}`;
      const headers = {
        referer: SELLER,
        'user-agent': app ? app.userAgentFallback : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      };
      let init = { method: 'GET', headers, session: ses, useSessionCookies: true };
      if (method === 'POST') {
        init.method = 'POST';
        init.headers['content-type'] = 'application/x-www-form-urlencoded';
        init.body = 'data=' + encodeURIComponent(ds);
      }
      const resp = await net.fetch(url, init);
      lastResp = resp.status;
      const text = await resp.text();
      let j;
      try { j = JSON.parse(text); }
      catch { const m = text.match(/\((\{[\s\S]*\})\)\s*;?\s*$/); j = m ? JSON.parse(m[1]) : null; }
      if (!j) return { status: resp.status, ret: ['PARSE_ERROR::' + text.slice(0, 150)], data: null };

      const ret = (j.ret || [])[0] || '';
      // token 过期: net.fetch(useSessionCookies) 已把服务端 Set-Cookie 的新 _m_h5_tk 回写进分区 jar，重读重签重试
      if (/TOKEN_EXPIRED|TOKEN_EXOIRED/i.test(ret) && attempt < 2) {
        await sleep(300);
        cs = await cookiesOf(shopId);
        const fresh = tokenOf(cs);
        if (fresh && fresh !== token) { token = fresh; continue; }
        // jar 里没换新 token（罕见），主动自举一次
        await net.fetch(`${H5}mtop.common.getTimestamp/1.0/?jsv=2.6.1&appKey=${APPKEY}`, { session: ses, useSessionCookies: true, headers });
        await sleep(300);
        cs = await cookiesOf(shopId);
        const fresh2 = tokenOf(cs);
        if (fresh2 && fresh2 !== token) { token = fresh2; continue; }
      }
      return { status: resp.status, ret: j.ret || [], data: j.data === undefined ? null : j.data };
    }
    return { status: lastResp, ret: ['RETRY_EXHAUSTED'], data: null };
  }

  return { request, cookiesOf };
}

module.exports = { createTbClient };
