// session-snapshot.js — 天猫/千牛会话快照持久化
// 背景: 淘宝 havana 登录的会话核心 cookie(_tb_token_/sn/csg 等)是 session cookie，
//   Chromium 不写盘，工作台重启即失效(抖店的 cookie 是持久化的所以没这问题)。
// 方案: 定时+退出前把分区内存全会话 cookie 快照存盘；打开店铺前回灌。
//   服务端会话存活期内(通常数天)重启可无损恢复；过期则自然回落到重新登录，
//   登录后快照自动刷新。自愈式设计。
const fs = require('node:fs');
const path = require('node:path');

const SAVE_INTERVAL_MS = 5 * 60 * 1000;   // 每 5 分钟存一次快照
const SNAP_ONLY_DOMAINS = /taobao|tmall|aliapp|alipay|havana/i; // 只存阿里系域，避免混入别的平台

function createSessionSnapshot({ userDataDir }) {
  const dir = path.join(userDataDir, 'session-snapshots');
  fs.mkdirSync(dir, { recursive: true });

  function fileOf(shopId) { return path.join(dir, `shop-${shopId}.json`); }

  /** 全量导出分区 cookie（含 session cookie，Electron session API 在主进程可读） */
  async function capture(ses) {
    const cs = await ses.cookies.get({});
    const now = Date.now() / 1000;
    return cs.filter(c => c.value && SNAP_ONLY_DOMAINS.test(c.domain))
             .map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path,
                          secure: c.secure, httpOnly: c.httpOnly,
                          expirationDate: c.expirationDate || null, session: !c.expirationDate }));
  }

  /** 存快照（有淘宝系 cookie 才写） */
  async function save(shopId, ses) {
    try {
      const jar = await capture(ses);
      if (!jar.length) return 0;
      const tmp = fileOf(shopId) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), cookies: jar }), { mode: 0o600 });
      fs.renameSync(tmp, fileOf(shopId));
      return jar.length;
    } catch { return 0; }
  }

  /** 回灌快照（不抛错；返回恢复条数） */
  async function restore(shopId, ses) {
    const f = fileOf(shopId);
    if (!fs.existsSync(f)) return 0;
    try {
      const snap = JSON.parse(fs.readFileSync(f, 'utf8'));
      // 快照超过 7 天视为陈旧，不回灌（服务端会话大概率已失效）
      if (Date.now() - new Date(snap.savedAt).getTime() > 7 * 86400 * 1000) return 0;
      let n = 0;
      const now = Date.now() / 1000;
      for (const c of snap.cookies || []) {
        if (c.expirationDate && c.expirationDate < now) continue;
        const host = c.domain.replace(/^\./, '');
        const params = { url: `https://${host}/`, name: c.name, value: c.value,
                         path: c.path || '/', secure: !!c.secure, httpOnly: !!c.httpOnly };
        if (!c.domain.startsWith('.')) params.domain = c.domain; // host-only
        if (c.expirationDate) params.expirationDate = c.expirationDate; // 不带 = session cookie
        const ok = await ses.cookies.set(params).catch(() => false);
        if (ok) n++;
      }
      return n;
    } catch { return 0; }
  }

  function has(shopId) { return fs.existsSync(fileOf(shopId)); }

  return { save, restore, has, dir };
}

module.exports = { createSessionSnapshot };
