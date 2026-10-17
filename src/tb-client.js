// tb-client.js — 淘宝/天猫直连（页面上下文路由版）
// 实证（2026-10-17 case taobao）:
//  1) 老 mtop 网关(h5api.m.taobao.com + mtop.taobao.*)对新版千牛 havana 会话一律
//     SESSION_EXPIRED —— 页内调用也一样，与签名/cookie/UA 无关，此路不通
//  2) 业务接口(mangkhut/mars 等, myseller.taobao.com 同域)有 Baxia fetch hook 把守：
//     隐藏窗口/离线请求都会被拦，只有真实可见的店铺页里发起的请求放行
//     （同抖店 appeal.js 的教训："必须从浏览器页面里发起"）
//  ⇒ 正确姿势 = 在店铺页(真实 tab)的页面上下文里执行 fetch：
//     会话/风控 cookie(_tb_token_ 等 session cookie 不落盘)由页面自带，无需外部拼凑。
const SELLER_HOSTS = ['myseller.taobao.com', 'seller.tmall.com'];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function createTbClient({ store, windows, openShop }) {
  function tabOf(shopId) {
    const shop = store.get(shopId);
    if (!shop) throw Error('店铺不存在');
    if (shop.platform !== '天猫') throw Error('仅支持天猫/淘宝（千牛）店铺');
    const w = windows.get(shopId);
    if (!w || w.isDestroyed()) return null;
    return w;
  }

  /** 确保店铺页开着、已登录(非登录页、有 _tb_token_)、加载完成；返回 webContents */
  async function ensurePage(shopId) {
    let w = tabOf(shopId);
    if (!w) { openShop(shopId); await sleep(3000); w = tabOf(shopId); if (!w) throw Error('店铺页打开失败，请在工作台手动打开该店'); }
    if (w.sleeping) throw Error('该店铺页在休眠，请先在工作台点亮该店');
    const wc = w.webContents;
    let lastErr = '';
    for (let i = 0; i < 25; i++) {
      if (wc.isDestroyed()) throw Error('店铺页已关闭');
      if (!wc.isLoadingMainFrame()) {
        let url = '';
        try { url = wc.getURL(); } catch {}
        const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
        if (SELLER_HOSTS.includes(host)) {
          if (/login|signin|passport/i.test(url)) lastErr = '店铺页在登录页 —— 请先在工作台完成千牛登录';
          else {
            const has = await wc.executeJavaScript('(function(){return !!/(?:^|;\\s*)_tb_token_=/.test(document.cookie)})()').catch(() => false);
            if (has) return wc;
            lastErr = '千牛会话已失效（页面里没有 _tb_token_），请在工作台重新登录该店';
          }
        } else lastErr = '店铺页不在千牛域名下: ' + url.slice(0, 80);
      }
      await sleep(1000);
    }
    throw Error(lastErr || '等待店铺页就绪超时');
  }

  /**
   * 页面上下文调用 myseller 同域接口（页面用哪个就调哪个）。
   * opts: { path: '/mangkhut/mms/recentOrderList', method?: 'POST', query?: object, data?: object }
   * 返回 { status, json } 或 { status, text }
   */
  async function request(shopId, opts = {}) {
    let p = String(opts.path || '');
    if (!p.startsWith('/')) p = '/' + p;
    if (p.length > 300 || /[^\x21-\x7e]/.test(p)) throw Error('path 非法');
    const method = String(opts.method || 'POST').toUpperCase();
    if (method !== 'GET' && method !== 'POST') throw Error('仅支持 GET/POST');
    const query = opts.query && typeof opts.query === 'object' && !Array.isArray(opts.query) ? opts.query : {};
    const data = opts.data && typeof opts.data === 'object' && !Array.isArray(opts.data) ? opts.data : {};

    const wc = await ensurePage(shopId);
    const expr = `(async () => {
      function gc(n){const m=document.cookie.match(new RegExp("(?:^|;\\\\s*)"+n+"=([^;]*)"));return m?m[1]:"";}
      const tb = gc("_tb_token_") || "";
      const path0 = ${JSON.stringify(p)};
      const qs = new URLSearchParams(${JSON.stringify(query)});
      ${method === 'GET' ? 'qs.set("_tb_token_", tb);' : ''}
      const path = path0 + (qs.toString() ? (path0.includes("?") ? "&" : "?") + qs.toString() : "");
      const res = await fetch(path, {
        method: ${JSON.stringify(method)},
        headers: {"content-type": "application/json"},
        body: ${method === 'POST' ? `JSON.stringify(Object.assign({}, ${JSON.stringify(data)}, {_tb_token_: tb}))` : 'undefined'},
        credentials: "include"
      });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch (e) {}
      return {status: res.status, json: json, text: json ? undefined : String(text).slice(0, 400)};
    })()`;
    const out = await wc.executeJavaScript(expr, true);
    if (!out) throw Error('页面执行无返回');
    return out;
  }

  /**
   * 驾驶模式：点击页面菜单让 SPA 自己发请求（Baxia 只拦注入调用，不拦页面自身请求），
   * 主进程从 CDP Network 层抓目标接口的响应体。
   * opts: { click_text: '订单查询', wait_api: 'recentOrderList', timeout_ms?: 15000 }
   */
  async function drive(shopId, opts = {}) {
    const clickText = String(opts.click_text || '');
    const waitApi = String(opts.wait_api || '');
    const timeoutMs = Math.min(Number(opts.timeout_ms) || (waitApi ? 15000 : 12000), 45000);
    const wc = await ensurePage(shopId);

    try { wc.debugger.attach('1.3'); } catch (e) { /* 已附加则复用 */ }
    await wc.debugger.sendCommand('Network.enable').catch(() => {});

    const captured = [];
    let rid = null;
    const result = new Promise((resolve, reject) => {
      const finish = (fn, val) => { clearTimeout(timer); wc.debugger.removeListener('message', onMsg); fn(val); };
      const timer = setTimeout(() => {
        if (waitApi) finish(reject, Error('等待 ' + waitApi + ' 响应超时（' + timeoutMs + 'ms）'));
        else finish(resolve, {status: 'captured', urls: captured.slice(0, 60)});
      }, timeoutMs);
      async function onMsg(_e, meth, p) {
        try {
          if (meth === 'Network.requestWillBeSent' && p.request && p.request.url) {
            const u = String(p.request.url);
            if (/^https?:/.test(u) && !/\.(js|css|png|jpe?g|gif|svg|woff2?|ttf|ico)(\?|$)/.test(u)
                && !u.includes('gm.mmstat') && !u.includes('ynuf') && !u.includes('/aes.') && !u.includes('beacon')) {
              captured.push({url: u.slice(0, 300), method: p.request.method,
                postData: p.request.postData ? String(p.request.postData).slice(0, 800) : undefined});
            }
          }
          if (meth === 'Network.responseReceived' && p.response && waitApi && p.response.url.includes(waitApi)) rid = p.requestId;
          if (meth === 'Network.loadingFinished' && waitApi && rid && p.requestId === rid) {
            const body = await wc.debugger.sendCommand('Network.getResponseBody', { requestId: rid }).catch(() => null);
            if (!body) return finish(reject, Error('响应体获取失败'));
            let j = null; try { j = JSON.parse(body.body); } catch (e) {}
            finish(resolve, { status: 200, json: j, text: j ? undefined : String(body.body).slice(0, 400), captured: captured.slice(0, 40) });
          }
        } catch (e) {}
      }
      wc.debugger.on('message', onMsg);
    });

    if (clickText) {
      const clicked = await wc.executeJavaScript(`(function(){
        const t = ${JSON.stringify(clickText)};
        const els = [...document.querySelectorAll('a,div,span,li,[role=menuitem],[role=button],[role=tab],[class*=menu] *,[class*=nav] *')].filter(e=>{
          if (e.children.length > 2) return false;
          if (!e.getClientRects().length) return false;
          const s = getComputedStyle(e); if (s.visibility==='hidden'||s.display==='none') return false;
          return (e.innerText||'').replace(/\\s+/g,'').includes(t);
        });
        if (!els.length) return false;
        const el = els[els.length-1];
        ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(type=>{
          el.dispatchEvent(new MouseEvent(type, {bubbles:true, cancelable:true, view:window}));
        });
        return true;
      })()`, true);
      if (!clicked) { wc.debugger.removeAllListeners('message'); throw Error('页面上找不到可点: ' + clickText); }
    } else {
      // 无点击目标 = 发现模式：刷新页面重新触发自身数据请求
      await wc.executeJavaScript('location.reload()', true).catch(() => {});
    }
    return await result;
  }

  /**
   * mtop 调用（页内借官方 SDK：window.lib.mtop.request）。
   * 签名/安全头/token 轮换全由 SDK 处理 —— 离线重放会被 SESSION_EXPIRED 拦
   * （阿里安全头 x-sgext/x-mini-wua 离线无法复刻，实证见 case evidence）。
   * opts: { api, version?: '1.0', data?: object, method?: 'GET'|'POST' }
   */
  async function mtop(shopId, opts = {}) {
    const api = String(opts.api || '');
    if (!/^[A-Za-z0-9_.]{3,120}$/.test(api)) throw Error('api 名非法');
    const version = String(opts.version || '1.0').replace(/[^A-Za-z0-9.]/g, '') || '1.0';
    const method = String(opts.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') throw Error('仅支持 GET/POST');
    const data = opts.data && typeof opts.data === 'object' && !Array.isArray(opts.data) ? opts.data : {};
    const wc = await ensurePage(shopId);
    const expr = `(async () => {
      if (!(window.lib && window.lib.mtop && window.lib.mtop.request)) return {__err: '页面无 lib.mtop SDK'};
      const opts = {v: ${JSON.stringify(version)}, data: ${JSON.stringify(data)}, type: ${JSON.stringify(method)}, dataType: 'originaljsonp', timeout: 10000};
      const api = ${JSON.stringify(api)};
      // 不同页面的 mtop SDK 版本不同，两种调用形式挨个试，取返回标准信封（含 ret）的那个
      const forms = [
        (a, o) => window.lib.mtop.request(a, o),
        (a, o) => window.lib.mtop.request(Object.assign({api: a}, o)),
      ];
      let lastRaw = '', lastErr = null;
      for (const f of forms) {
        try {
          const res = await f(api, opts);
          lastRaw = JSON.stringify(res).slice(0, 250);
          if (res && res.ret) return {ret: res.ret, data: res.data === undefined ? null : res.data};
        } catch (e) { lastErr = e; }
      }
      return {__err: String(lastErr && (lastErr.ret && lastErr.ret[0] || lastErr.message) || 'SDK 两种形式均未返回标准信封').slice(0, 180), raw: lastRaw};
    })()`;
    const out = await wc.executeJavaScript(expr, true);
    if (!out) throw Error('页面执行无返回');
    if (out.__err) { const err = new Error(out.__err); err.ret = out.ret; throw err; }
    return out;
  }

  return { request, ensurePage, drive, mtop };
}

module.exports = { createTbClient };
