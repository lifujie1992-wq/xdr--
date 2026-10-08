#!/bin/bash
# 每日 22:00：① 只刷新平台审核结果（不采集、不提交）
# ② 生成当日汇总（按 品退/中差评 × AI/人工 区分）③ 推飞书 + 存档 + 推云端
set -u
APP="$HOME/Library/Application Support/shopdesk"
RD="$APP/appeal-reports"
BRIDGE="$APP/agent-bridge.json"
LOG="$RD/daily-summary.log"
OUT="$RD/summary-$(date +%F).txt"
mkdir -p "$RD"
say(){ echo "[$(date '+%F %T')] $*" >> "$LOG"; }
say "==== 每日汇总开始 ===="

# ---------- ① 刷新审核结果 ----------
P=$(/usr/bin/plutil -extract port raw -o - "$BRIDGE" 2>/dev/null)
T=$(/usr/bin/plutil -extract token raw -o - "$BRIDGE" 2>/dev/null)
if [ -z "${P:-}" ] || [ -z "${T:-}" ]; then
  say "工作台未运行，尝试启动"
  pgrep -f "店铺工作台.app/Contents/MacOS/店铺工作台" >/dev/null 2>&1 || open "$HOME/店铺工作台.app"
  for i in $(seq 1 20); do [ -f "$BRIDGE" ] && break; sleep 3; done
  P=$(/usr/bin/plutil -extract port raw -o - "$BRIDGE" 2>/dev/null)
  T=$(/usr/bin/plutil -extract token raw -o - "$BRIDGE" 2>/dev/null)
fi
# ---------- ⓪ 补齐当天采集（不采集的话日报里的"今日"只到早上7点）----------
call_bridge(){
  printf 'header = "Authorization: Bearer %s"\n' "$T" | /usr/bin/curl --config - -s --max-time 60 --noproxy '*' \
    -H 'Content-Type: application/json' -H 'X-ShopDesk-Client: cron' --data-binary "$1" "http://127.0.0.1:$P/call" 2>/dev/null
}
if [ "${SKIP_COLLECT:-0}" = "1" ]; then
  say "SKIP_COLLECT=1，跳过当天采集"
elif [ -n "${P:-}" ] && [ -n "${T:-}" ]; then
  for _key in builtin:quality_returns builtin:negative_reviews; do
    _job=$(call_bridge "{\"method\":\"start_collector\",\"args\":{\"key\":\"$_key\"}}")
    _id=$(printf '%s' "$_job" | /usr/bin/python3 -c 'import sys,json
try: print((json.load(sys.stdin).get("result") or {}).get("id",""))
except Exception: print("")' 2>/dev/null)
    if [ -z "$_id" ]; then say "采集 $_key 启动失败: $(printf '%s' "$_job" | head -c 200)"; continue; fi
    say "采集 $_key 启动（id=$_id）"
    for _i in $(seq 1 90); do
      sleep 5
      _st=$(call_bridge "{\"method\":\"get_collector_job\",\"args\":{\"id\":\"$_id\"}}" | /usr/bin/python3 -c 'import sys,json
try: print((json.load(sys.stdin).get("result") or {}).get("status",""))
except Exception: print("")' 2>/dev/null)
      case "$_st" in done|error|cancelled|failed) say "采集 $_key 结束: $_st"; break;; esac
    done
  done
fi

SYNCED=0
if [ "${SKIP_SYNC:-0}" = "1" ]; then
  say "SKIP_SYNC=1，跳过结果刷新（仅预览日报格式）"
elif [ -n "${P:-}" ] && [ -n "${T:-}" ]; then
  R=$(printf 'header = "Authorization: Bearer %s"\n' "$T" | /usr/bin/curl --config - -s --max-time 20 --noproxy '*' -H 'Content-Type: application/json' --data-binary '{"method":"auto_appeal_status"}' "http://127.0.0.1:$P/call" 2>/dev/null)
  case "$R" in
    *'"running":true'*) say "跑批中，跳过结果刷新（日报用现有数据）";;
    "") say "接口无响应，跳过结果刷新";;
    *)
      say "刷新平台审核结果…"
      printf 'header = "Authorization: Bearer %s"\n' "$T" | /usr/bin/curl --config - -s --max-time 1500 --noproxy '*' \
        -H 'Content-Type: application/json' -H 'X-ShopDesk-Client: cron' \
        --data-binary '{"method":"appeal_sync_results","args":{"days":30,"pages":12}}' \
        "http://127.0.0.1:$P/call" >> "$LOG" 2>&1
      SYNCED=1
      say "结果刷新完成"
      ;;
  esac
fi

# ---------- ②③④ 汇总 ----------
SYNCED="$SYNCED" OUT="$OUT" /usr/bin/python3 - <<'PY'
import json, os, time, base64, hmac, hashlib, datetime, collections, urllib.request, subprocess, glob

app = os.path.expanduser('~/Library/Application Support/shopdesk')
rd = os.path.join(app, 'appeal-reports')
out = os.environ['OUT']
today = datetime.date.today().isoformat()
KINDS = ['品退', '中差评']
WHOS = ['AI', '人工']

def norm(d):
    return str(d or '').replace('/', '-')[:10]

# 平台举报记录（含订单号）
try:
    res = json.load(open(os.path.join(rd, 'results.json')))
    recs = [dict(v, order_id=str(k)) for k, v in (res.get('map') or {}).items()]
except Exception:
    recs = []

# 提交人归属：我们系统提交的=AI；平台上其它来源=人工（取自本地 /stats）
who_of = {}
try:
    st = json.loads(urllib.request.urlopen('http://127.0.0.1:8899/stats', timeout=40).read().decode('utf-8'))
    for row in ((st.get('review') or {}).get('rows') or []):
        oid = str(row.get('order_id') or '')
        if oid:
            who_of[oid] = 'AI' if str(row.get('submitter') or '').startswith('AI') else '人工'
except Exception:
    pass

def who(r):
    return who_of.get(str(r.get('order_id') or ''), 'AI')

def kind_of(r):
    return '品退' if '售后' in str(r.get('scene') or '') else '中差评'

def newrec():
    return {'sub': 0, 'pass': 0, 'rej': 0, 'wait': 0, 'audN': 0, 'audPass': 0, 'audRej': 0,
            'total': 0, 'ok': 0, 'bad': 0, 'subAI': 0, 'subMan': 0,
            'totAI': 0, 'totMan': 0, 'audAI': 0, 'audMan': 0}

sub_today = [r for r in recs if norm(r.get('created')) == today]
aud_today = [r for r in recs if norm(r.get('auditTime')) == today]

G = {k: newrec() for k in KINDS}     # 今日提交
A = {k: newrec() for k in KINDS}     # 今日出结果
T = {k: newrec() for k in KINDS}     # 累计
W = {w: newrec() for w in WHOS}      # 按提交人累计

for r in recs:
    k, w = kind_of(r), who(r)
    t = T[k]; t['total'] += 1; t['totAI' if w == 'AI' else 'totMan'] += 1
    x = W[w]; x['total'] += 1
    a = r.get('auditStatus')
    if a == 6:
        t['ok'] += 1; x['ok'] += 1
    elif a == 3:
        t['bad'] += 1; x['bad'] += 1
for r in sub_today:
    k, w = kind_of(r), who(r)
    g = G[k]
    g['sub'] += 1; g['subAI' if w == 'AI' else 'subMan'] += 1
    a = r.get('auditStatus')
    if a == 6:
        g['pass'] += 1
    elif a == 3:
        g['rej'] += 1
    else:
        g['wait'] += 1
for r in aud_today:
    k, w = kind_of(r), who(r)
    a = A[k]
    a['audN'] += 1; a['audAI' if w == 'AI' else 'audMan'] += 1
    s = r.get('auditStatus')
    if s == 6:
        a['audPass'] += 1
    elif s == 3:
        a['audRej'] += 1

def rate(p, r):
    return round(p * 100 / (p + r)) if (p + r) else 0

# ---------- 今日新增（平台今天产生的差评/品退） ----------
PURE_EMOTION = {'差评','中评','差','中','烂','不好','不推荐','不推荐购买','垃圾','辣鸡','无语','服了','服气',
                '呵呵','唉','哎','后悔','失望','一般','还行','凑合','醉了','离谱','难看','丑','不值','不值得',
                '浪费钱','上当','踩雷','翻车','绝了','恶心','什么玩意','很一般','太差了','差劲','无语子'}

def emo(t):
    s = str(t or '').strip().strip('。.！!~～,，、；;？?　 \t\n')
    return (not s) or (s in PURE_EMOTION)

NEW = {k: {'n': 0, 'ok': 0} for k in KINDS}
NEW_SHOP = {}          # {店铺: {'品退':[总,可申诉], '中差评':[总,可申诉]}}
COLLECTED_AT = ''

def bump(shop, k, ok):
    d = NEW_SHOP.setdefault(shop or '(未知店铺)', {})
    e = d.setdefault(k, [0, 0])
    e[0] += 1
    if ok:
        e[1] += 1
    NEW[k]['n'] += 1
    if ok:
        NEW[k]['ok'] += 1

try:
    _p = os.path.join(app, 'business-data', 'quality-all-latest.json')
    COLLECTED_AT = datetime.datetime.fromtimestamp(os.path.getmtime(_p)).strftime('%m-%d %H:%M')
    for r in json.load(open(_p)):
        if str(r.get('apply_date') or '')[:10] != today:
            continue
        bump(r.get('shop'), '品退', r.get('appealable') is True)
except Exception:
    pass
try:
    _fs = sorted(glob.glob(os.path.join(app, 'business-data', 'reviews-all-*.json')))
    if _fs:
        _mt = datetime.datetime.fromtimestamp(os.path.getmtime(_fs[-1])).strftime('%m-%d %H:%M')
        if _mt > COLLECTED_AT:
            COLLECTED_AT = _mt
    seen_r = set()
    for _f in _fs:                      # 批次文件是增量的，要全部合并去重
        try:
            _d = json.load(open(_f))
        except Exception:
            continue
        for r in (_d if isinstance(_d, list) else (_d.get('all_reviews') or [])):
            try:
                if int(r.get('rank') or 5) > 3:      # 只要中差评
                    continue
            except Exception:
                continue
            oid = str(r.get('order_id') or '')
            if not oid or oid in seen_r:
                continue
            seen_r.add(oid)
            if str(r.get('comment_date') or '')[:10] != today:
                continue
            bump(r.get('shop'), '中差评', emo(r.get('content')) and not r.get('has_media'))
except Exception:
    pass

L = []
L.append('【抖店申诉日报】%s%s' % (today, ('　数据截至 ' + COLLECTED_AT) if COLLECTED_AT else ''))
L.append('')
L.append('📥 今日新增　品退 %d（可申诉 %d）｜ 中差评 %d（可申诉 %d）　→ 合计可申诉 %d 单' % (
    NEW['品退']['n'], NEW['品退']['ok'], NEW['中差评']['n'], NEW['中差评']['ok'],
    NEW['品退']['ok'] + NEW['中差评']['ok']))
if COLLECTED_AT:
    L.append('　（当天剩余时段平台产生的，次日 07:00 入账）')
L.append('')

tot_sub = sum(G[k]['sub'] for k in KINDS)
tot_aud = sum(A[k]['audN'] for k in KINDS)
_p = sum(A[k]['audPass'] for k in KINDS)
_r = sum(A[k]['audRej'] for k in KINDS)
_all = sum(T[k]['total'] for k in KINDS)
_ok = sum(T[k]['ok'] for k in KINDS)
_bad = sum(T[k]['bad'] for k in KINDS)
L.append('📤 今日提交 %d 单 ｜ 今日出结果 %d（✅%d ❌%d）' % (tot_sub, tot_aud, _p, _r))
L.append('📊 累计提交 %d ｜ ✅%d ❌%d ｜ 通过率 %d%%' % (_all, _ok, _bad, rate(_ok, _bad)))
L.append('　 按类型　品退 %d（%d%%）· 中差评 %d（%d%%）' % (
    T['品退']['total'], rate(T['品退']['ok'], T['品退']['bad']),
    T['中差评']['total'], rate(T['中差评']['ok'], T['中差评']['bad'])))
L.append('　 按提交　%s' % (' · '.join('%s %d（%d%%）' % (w, W[w]['total'], rate(W[w]['ok'], W[w]['bad'])) for w in WHOS if W[w]['total'])))

# 驳回原因（分类型）
for k in KINDS:
    msgs = collections.Counter()
    for r in aud_today:
        if kind_of(r) != k:
            continue
        m = str(r.get('resultMsg') or '').replace('失败原因:', '').split(';平台建议')[0].strip()
        if not m:
            continue
        msgs[(m[:32] + '…') if len(m) > 32 else m] += 1
    if msgs:
        L.append('')
        L.append('❌ 今日驳回（%s）' % k)
        for m, n in msgs.most_common(2):
            L.append('   • %s ×%d' % (m, n))

# ---------- 店铺维度（类型 × 提交人）----------
SH = {}
def srow(s, k):
    return SH.setdefault(s, {kk: newrec() for kk in KINDS})[k]
for r in recs:
    d = srow(str(r.get('shop') or '?'), kind_of(r))
    w = who(r)
    d['total'] += 1; d['totAI' if w == 'AI' else 'totMan'] += 1
    if r.get('auditStatus') == 6:
        d['ok'] += 1
    elif r.get('auditStatus') == 3:
        d['bad'] += 1
for r in sub_today:
    d = srow(str(r.get('shop') or '?'), kind_of(r)); w = who(r)
    d['sub'] += 1; d['subAI' if w == 'AI' else 'subMan'] += 1
    a = r.get('auditStatus')
    if a == 6:
        d['pass'] += 1
    elif a == 3:
        d['rej'] += 1
    else:
        d['wait'] += 1
for r in aud_today:
    d = srow(str(r.get('shop') or '?'), kind_of(r)); w = who(r)
    d['audN'] += 1; d['audAI' if w == 'AI' else 'audMan'] += 1
    if r.get('auditStatus') == 6:
        d['audPass'] += 1
    elif r.get('auditStatus') == 3:
        d['audRej'] += 1

def act(d):
    return sum(d[k]['sub'] + d[k]['audN'] for k in KINDS)

# ---------- 店铺明细（今日新增 + 累计，一张表）----------
_shops = set(NEW_SHOP) | set(SH)
_rows = []
for _s in _shops:
    _nq = NEW_SHOP.get(_s, {}).get('品退', [0, 0])
    _nr = NEW_SHOP.get(_s, {}).get('中差评', [0, 0])
    _d = SH.get(_s) or {}
    _t = sum(_d[k]['total'] for k in KINDS) if _d else 0
    _o = sum(_d[k]['ok'] for k in KINDS) if _d else 0
    _b = sum(_d[k]['bad'] for k in KINDS) if _d else 0
    if not (_nq[0] or _nr[0] or _t):
        continue
    _rows.append((_s, _nq, _nr, _nq[1] + _nr[1], _t, _o, _b))
_rows.sort(key=lambda r: (-(r[1][0] + r[2][0]), -r[4]))

if _rows:
    def _dw(s):
        n = 0
        for c in str(s):
            o = ord(c)
            n += 2 if (0x1100 <= o <= 0x115F or 0x2E80 <= o <= 0xA4CF or 0xAC00 <= o <= 0xD7A3
                        or 0xF900 <= o <= 0xFAFF or 0xFE30 <= o <= 0xFE6F or 0xFF00 <= o <= 0xFF60
                        or 0xFFE0 <= o <= 0xFFE6 or 0x20000 <= o <= 0x3FFFD) else 1
        return n

    def _pad(s, w):
        return str(s) + ' ' * max(1, w - _dw(s))

    _w = max(_dw(r[0]) for r in _rows) + 2
    L.append('')
    L.append('🏪 店铺明细（今日 品退/中差评 · 可申诉 ｜ 累计提交 · 通过率）')
    for _s, _nq, _nr, _aok, _t, _o, _b in _rows:
        L.append('  %s%s %4s  %5d  %5s' % (
            _pad(_s, _w), '%d/%d' % (_nq[0], _nr[0]), _aok or '-', _t,
            ('%d%%' % rate(_o, _b)) if (_o or _b) else '-'))
    L.append('  %s' % ('─' * (_w + 26)))
    L.append('  %s%s %4d  %5d  %5s' % (
        _pad('合计', _w), '%d/%d' % (NEW['品退']['n'], NEW['中差评']['n']),
        NEW['品退']['ok'] + NEW['中差评']['ok'], _all, '%d%%' % rate(_ok, _bad)))

L.append('')
L.append('（数据源：抖店举报记录 + 本地提交日志；%s）' % ('本次已刷新' if os.environ.get('SYNCED') == '1' else '本次未刷新，沿用上次'))
text = '\n'.join(L)
open(out, 'w', encoding='utf-8').write(text + '\n')
print(text)

# 存档 json + 历史（每天一行，按日期去重；原子写入，绝不动其它日期）
jpath = os.path.join(rd, 'daily-summary.json')
hpath = os.path.join(rd, 'daily-summary-history.jsonl')
try:
    day = {'date': today,
           'kinds': {k: {'today': G[k], 'auditToday': A[k], 'total': T[k]} for k in KINDS},
           'bySubmitter': W,
           'byShop': [{'shop': s, **{k: d[k] for k in KINDS}} for s, d in
                      sorted(SH.items(), key=lambda kv: -sum(kv[1][k]['total'] for k in KINDS))],
           'generatedAt': datetime.datetime.now().isoformat()}
    # 最新一份
    with open(jpath + '.tmp', 'w', encoding='utf-8') as fh:
        json.dump(dict(day, text=text), fh, ensure_ascii=False, indent=1)
    os.replace(jpath + '.tmp', jpath)
    # 历史：读回全部 → 只替换当天 → 原子写回（其它日期原样保留；重复日期只留一行）
    lines, replaced, bad = [], False, []
    if os.path.exists(hpath):
        with open(hpath, encoding='utf-8') as fh:
            for line in fh:
                s = line.strip()
                if not s:
                    continue
                try:
                    e = json.loads(s)
                except Exception:
                    bad.append(s)          # 已损坏的行原样保留，不删
                    continue
                if str(e.get('date') or '') == today:
                    if replaced:
                        continue           # 同一天的重复行 → 跳过
                    lines.append(json.dumps(day, ensure_ascii=False))
                    replaced = True
                else:
                    lines.append(s)        # 其它日期原样保留
    if not replaced:
        lines.append(json.dumps(day, ensure_ascii=False))
    lines.extend(bad)
    with open(hpath + '.tmp', 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines) + ('\n' if lines else ''))
    os.replace(hpath + '.tmp', hpath)
    # 每天一份纯文本（其它日期不碰；同一天原子替换）
    tp = os.path.join(rd, 'summary-%s.txt' % today)
    with open(tp + '.tmp', 'w', encoding='utf-8') as fh:
        fh.write(text + '\n')
    os.replace(tp + '.tmp', tp)
except Exception:
    pass

# 推云端（最新 + 当天存档 + 历史）
try:
    pushes = [(out, 'daily-summary.txt'),
              (jpath, 'daily-summary.json'),
              (hpath, 'daily-summary-history.jsonl'),
              (os.path.join(rd, 'summary-%s.txt' % today), 'daily-summary-%s.txt' % today)]
    for src, dst in pushes:
        if os.path.exists(src):
            subprocess.run(['/usr/bin/scp', '-q', '-i', os.path.expanduser('~/.ssh/xdr_mac'),
                            '-o', 'ConnectTimeout=12', src,
                            'root@47.114.33.246:/srv/appeal-workbench/data/' + dst], timeout=30)
    print('已推云端（含历史）')
except Exception as e:
    print('推云端失败:', e)

# 飞书
try:
    cfg = json.load(open(os.path.join(app, 'alert-webhook.json')))
    url, secret = str(cfg.get('url') or '').strip(), str(cfg.get('secret') or '').strip()
    if url:
        payload = {'msg_type': 'text', 'content': {'text': text}}
        if secret:
            ts = str(int(time.time()))
            dig = hmac.new((ts + '\n' + secret).encode('utf-8'), digestmod=hashlib.sha256).digest()
            payload['timestamp'] = ts
            payload['sign'] = base64.b64encode(dig).decode('utf-8')
        req = urllib.request.Request(url, data=json.dumps(payload, ensure_ascii=False).encode(),
                                     headers={'Content-Type': 'application/json'})
        r = urllib.request.urlopen(req, timeout=10)
        print('飞书:', r.status, r.read().decode()[:60])
except Exception as e:
    print('飞书推送失败:', e)
PY

say "日报已生成: $OUT"
say "==== 每日汇总结束 ===="
