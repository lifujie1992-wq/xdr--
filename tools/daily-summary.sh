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
SYNCED=0
if [ -n "${P:-}" ] && [ -n "${T:-}" ]; then
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
import json, os, time, base64, hmac, hashlib, datetime, collections, urllib.request, subprocess

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

L = []
L.append('【抖店申诉日报】%s' % today)
L.append('')

tot_sub = sum(G[k]['sub'] for k in KINDS)
L.append('📤 今日提交 %d 单' % tot_sub)
if tot_sub:
    for k in KINDS:
        g = G[k]
        if g['sub']:
            L.append('   %-4s %d 单（AI%d · 人工%d）｜ 已出结果 成功%d 失败%d · 审核中%d' % (
                k, g['sub'], g['subAI'], g['subMan'], g['pass'], g['rej'], g['wait']))
else:
    L.append('   （今天没有提交）')

tot_aud = sum(A[k]['audN'] for k in KINDS)
L.append('')
L.append('📋 今日出结果 %d 单（含往日提交）' % tot_aud)
if tot_aud:
    for k in KINDS:
        a = A[k]
        if a['audN']:
            L.append('   %-4s %d 单（AI%d · 人工%d）｜ ✅%d ❌%d · 通过率%d%%' % (
                k, a['audN'], a['audAI'], a['audMan'], a['audPass'], a['audRej'], rate(a['audPass'], a['audRej'])))
else:
    L.append('   （今天没有新出结果）')

L.append('')
L.append('📊 累计（按类型）')
for k in KINDS:
    t = T[k]
    L.append('   %-4s 提交%d（AI%d · 人工%d）成功%d 失败%d · 通过率%d%%' % (
        k, t['total'], t['totAI'], t['totMan'], t['ok'], t['bad'], rate(t['ok'], t['bad'])))
L.append('   合计 提交%d 成功%d 失败%d · 通过率%d%%' % (
    sum(T[k]['total'] for k in KINDS), sum(T[k]['ok'] for k in KINDS),
    sum(T[k]['bad'] for k in KINDS),
    rate(sum(T[k]['ok'] for k in KINDS), sum(T[k]['bad'] for k in KINDS))))

L.append('')
L.append('🤖 累计（按提交人）')
for w in WHOS:
    x = W[w]
    if x['total']:
        L.append('   %-4s 提交%d 成功%d 失败%d · 通过率%d%%' % (w, x['total'], x['ok'], x['bad'], rate(x['ok'], x['bad'])))

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
        L.append('❌ 今日驳回原因（%s）' % k)
        for m, n in msgs.most_common(4):
            L.append('   • %s  ×%d' % (m, n))

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

if SH:
    def tot(d):
        return sum(d[k]['total'] for k in KINDS)
    def totAI(d):
        return sum(d[k]['totAI'] for k in KINDS)
    def totMan(d):
        return sum(d[k]['totMan'] for k in KINDS)
    order = sorted(SH.items(), key=lambda kv: (-act(kv[1]), -tot(kv[1])))
    L.append('')
    L.append('🏪 店铺维度（每店：品退/中差评 数量 · 成功失败 · 通过率；末行 AI/人工 合计）')
    for s, d in order:
        if not tot(d):
            continue
        L.append('• %s%s' % (s, '   ★今日有动作' if act(d) else ''))
        for k in KINDS:
            x = d[k]
            if not x['total']:
                continue
            line = '   %-4s %d 单 ｜ 成功 %d · 失败 %d · 通过率 %d%%' % (
                k, x['total'], x['ok'], x['bad'], rate(x['ok'], x['bad']))
            if x['sub'] or x['audN']:
                line += ' ｜ 今日 提交%d(成%d 败%d 审%d) 出结果%d' % (
                    x['sub'], x['pass'], x['rej'], x['wait'], x['audN'])
            L.append(line)
        L.append('   └ 提交合计 AI %d · 人工 %d' % (totAI(d), totMan(d)))

L.append('')
L.append('（数据源：抖店举报记录 + 本地提交日志；%s）' % ('本次已刷新' if os.environ.get('SYNCED') == '1' else '本次未刷新，沿用上次'))
text = '\n'.join(L)
open(out, 'w', encoding='utf-8').write(text + '\n')
print(text)

# 存档 json
jpath = os.path.join(rd, 'daily-summary.json')
try:
    json.dump({'date': today, 'text': text,
               'kinds': {k: {'today': G[k], 'auditToday': A[k], 'total': T[k]} for k in KINDS},
               'bySubmitter': W,
               'byShop': [{'shop': s, **{k: d[k] for k in KINDS}} for s, d in
                          sorted(SH.items(), key=lambda kv: -sum(kv[1][k]['total'] for k in KINDS))],
               'generatedAt': datetime.datetime.now().isoformat()},
              open(jpath, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
except Exception:
    pass

# 推云端
try:
    for src, dst in ((out, 'daily-summary.txt'), (jpath, 'daily-summary.json')):
        subprocess.run(['/usr/bin/scp', '-q', '-i', os.path.expanduser('~/.ssh/xdr_mac'),
                        '-o', 'ConnectTimeout=12', src,
                        'root@47.114.33.246:/srv/appeal-workbench/data/' + dst], timeout=30)
    print('已推云端')
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
