#!/bin/bash
# 每日 22:00：① 只刷新平台审核结果（不采集、不提交）② 生成当日汇总（按品退/中差评区分）
# ③ 推飞书 + 存档 + 推云端
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

# ---------- ②③④ 生成汇总 + 存档 + 推云端 + 推飞书 ----------
SYNCED="$SYNCED" OUT="$OUT" LOG="$LOG" /usr/bin/python3 - <<'PY'
import json, os, time, base64, hmac, datetime, collections, urllib.request, subprocess

app = os.path.expanduser('~/Library/Application Support/shopdesk')
rd = os.path.join(app, 'appeal-reports')
out = os.environ['OUT']
today = datetime.date.today().isoformat()
KINDS = ['品退', '中差评']

def norm(d):
    return str(d or '').replace('/', '-')[:10]

def blank():
    return {'sub': 0, 'pass': 0, 'rej': 0, 'wait': 0, 'audN': 0, 'audPass': 0, 'audRej': 0,
            'total': 0, 'okTotal': 0, 'rejTotal': 0}

try:
    res = json.load(open(os.path.join(rd, 'results.json')))
    recs = list((res.get('map') or {}).values()) if isinstance(res, dict) else []
except Exception:
    recs = []

def kind_of(r):
    return '品退' if '售后' in str(r.get('scene') or '') else '中差评'

sub_today = [r for r in recs if norm(r.get('created')) == today]
aud_today = [r for r in recs if norm(r.get('auditTime')) == today]

# 全局按 kind
G = {k: blank() for k in KINDS}                      # 今日提交
A = {k: blank() for k in KINDS}                      # 今日出结果
T = {k: blank() for k in KINDS}                      # 累计
for r in recs:
    k = kind_of(r); t = T[k]
    t['total'] += 1
    if r.get('auditStatus') == 6:
        t['okTotal'] += 1
    elif r.get('auditStatus') == 3:
        t['rejTotal'] += 1
for r in sub_today:
    k = kind_of(r); g = G[k]
    g['sub'] += 1
    a = r.get('auditStatus')
    if a == 6:
        g['pass'] += 1
    elif a == 3:
        g['rej'] += 1
    else:
        g['wait'] += 1
for r in aud_today:
    k = kind_of(r); a = A[k]
    a['audN'] += 1
    if r.get('auditStatus') == 6:
        a['audPass'] += 1
    elif r.get('auditStatus') == 3:
        a['audRej'] += 1

def rate(p, r):
    return round(p * 100 / (p + r)) if (p + r) else 0

def kline(k, s):
    """品退 5 单 ｜ 已出结果 成功1 失败2 · 审核中2"""
    return '   %-4s %d 单 ｜ 已出结果 成功%d 失败%d · 审核中%d' % (k, s['sub'], s['pass'], s['rej'], s['wait'])

L = []
L.append('【抖店申诉日报】%s' % today)
L.append('')
tot_sub = sum(G[k]['sub'] for k in KINDS)
L.append('📤 今日提交 %d 单' % tot_sub)
if tot_sub:
    for k in KINDS:
        if G[k]['sub']:
            L.append(kline(k, G[k]))
else:
    L.append('   （今天没有提交）')
L.append('')
L.append('📋 今日出结果 %d 单（含往日提交）' % sum(A[k]['audN'] for k in KINDS))
if sum(A[k]['audN'] for k in KINDS):
    for k in KINDS:
        a = A[k]
        if a['audN']:
            L.append('   %-4s %d 单 ｜ ✅%d ❌%d · 通过率%d%%' % (k, a['audN'], a['audPass'], a['audRej'], rate(a['audPass'], a['audRej'])))
else:
    L.append('   （今天没有新出结果）')
L.append('')
L.append('📊 累计')
for k in KINDS:
    t = T[k]
    L.append('   %-4s 提交%d 成功%d 失败%d · 通过率%d%%' % (k, t['total'], t['okTotal'], t['rejTotal'], rate(t['okTotal'], t['rejTotal'])))
L.append('   合计 提交%d 成功%d 失败%d · 通过率%d%%' % (
    sum(T[k]['total'] for k in KINDS), sum(T[k]['okTotal'] for k in KINDS),
    sum(T[k]['rejTotal'] for k in KINDS), rate(sum(T[k]['okTotal'] for k in KINDS), sum(T[k]['rejTotal'] for k in KINDS))))

# 驳回原因（分 kind）
for k in KINDS:
    msgs = collections.Counter()
    for r in aud_today:
        if kind_of(r) != k:
            continue
        m = str(r.get('resultMsg') or '').replace('失败原因:', '').split(';平台建议')[0].strip()
        if not m:
            continue
        m = (m[:32] + '…') if len(m) > 32 else m
        msgs[m] += 1
    if msgs:
        L.append('')
        L.append('❌ 今日驳回原因（%s）' % k)
        for m, n in msgs.most_common(4):
            L.append('   • %s  ×%d' % (m, n))

# ---------- 店铺维度（按 kind 分） ----------
SH = {}
def srow(s, k):
    return SH.setdefault(s, {kk: blank() for kk in KINDS})[k]
for r in recs:
    d = srow(str(r.get('shop') or '?'), kind_of(r))
    d['total'] += 1
    if r.get('auditStatus') == 6:
        d['okTotal'] += 1
    elif r.get('auditStatus') == 3:
        d['rejTotal'] += 1
for r in sub_today:
    d = srow(str(r.get('shop') or '?'), kind_of(r))
    d['sub'] += 1
    a = r.get('auditStatus')
    if a == 6:
        d['pass'] += 1
    elif a == 3:
        d['rej'] += 1
    else:
        d['wait'] += 1
for r in aud_today:
    d = srow(str(r.get('shop') or '?'), kind_of(r))
    d['audN'] += 1
    if r.get('auditStatus') == 6:
        d['audPass'] += 1
    elif r.get('auditStatus') == 3:
        d['audRej'] += 1

def shop_activity(d):
    return sum(d[k]['sub'] + d[k]['audN'] for k in KINDS)

if SH:
    order = sorted(SH.items(), key=lambda kv: (-shop_activity(kv[1]), -sum(kv[1][k]['total'] for k in KINDS)))
    active = [(s, d) for s, d in order if shop_activity(d)]
    idle = [(s, d) for s, d in order if not shop_activity(d)]
    L.append('')
    L.append('🏪 店铺维度（按品退 / 中差评分开）')
    for s, d in active:
        L.append('• %s' % s)
        for k in KINDS:
            x = d[k]
            if x['sub'] or x['audN']:
                r1 = rate(x['okTotal'], x['rejTotal'])
                L.append('   %-4s 今日 提交%d（成%d 败%d 审%d）· 出结果%d（成%d 败%d）｜ 累计 %d · 通过率%d%%' % (
                    k, x['sub'], x['pass'], x['rej'], x['wait'], x['audN'], x['audPass'], x['audRej'], x['total'], r1))
            elif x['total']:
                L.append('   %-4s 今日无 ｜ 累计 %d · 通过率%d%%' % (k, x['total'], rate(x['okTotal'], x['rejTotal'])))
    if idle:
        L.append('')
        L.append('— 今日无提交的店（累计）—')
        for s, d in idle:
            parts = []
            for k in KINDS:
                x = d[k]
                if x['total']:
                    parts.append('%s %d单/%d%%' % (k, x['total'], rate(x['okTotal'], x['rejTotal'])))
            L.append('• %s：%s' % (s, ' ｜ '.join(parts)))

L.append('')
L.append('（数据源：抖店举报记录，%s）' % ('本次已刷新' if os.environ.get('SYNCED') == '1' else '本次未刷新，沿用上次'))
text = '\n'.join(L)

open(out, 'w', encoding='utf-8').write(text + '\n')
print(text)

# 存档 json
json_path = os.path.join(rd, 'daily-summary.json')
try:
    js = {'date': today, 'text': text,
          'kinds': {k: {'today': G[k], 'auditToday': A[k], 'total': T[k]} for k in KINDS},
          'byShop': [{'shop': s, **{k: d[k] for k in KINDS}} for s, d in
                     sorted(SH.items(), key=lambda kv: -sum(kv[1][k]['total'] for k in KINDS))],
          'generatedAt': datetime.datetime.now().isoformat()}
    json.dump(js, open(json_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
except Exception:
    pass

# 推云端
try:
    for src, dst in ((out, 'daily-summary.txt'), (json_path, 'daily-summary.json')):
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
            import hashlib
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
