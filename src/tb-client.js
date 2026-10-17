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

  return { request, ensurePage };
}

module.exports = { createTbClient };
