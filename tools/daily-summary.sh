#!/bin/bash
# 每日 22:00：① 只刷新平台审核结果（不采集、不提交）② 生成当日汇总 ③ 推飞书 + 存档 + 推云端
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
    "")
      say "接口无响应，跳过结果刷新";;
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

# ---------- ②③④ 生成汇总 + 推飞书 + 存档 + 推云端 ----------
SYNCED="$SYNCED" OUT="$OUT" LOG="$LOG" /usr/bin/python3 - <<'PY'
import json, os, time, base64, hmac, datetime, collections, urllib.request, subprocess

app = os.path.expanduser('~/Library/Application Support/shopdesk')
rd = os.path.join(app, 'appeal-reports')
out = os.environ['OUT']
today = datetime.date.today().isoformat()

def norm(d):
    """'2026/10/07 23:32:04' -> '2026-10-07'"""
    return str(d or '').replace('/', '-')[:10]

try:
    res = json.load(open(os.path.join(rd, 'results.json')))
    recs = list((res.get('map') or {}).values()) if isinstance(res, dict) else []
except Exception:
    recs = []

def kind_of(r):
    return '品退' if '售后' in str(r.get('scene') or '') else '中差评'

sub_today = [r for r in recs if norm(r.get('created')) == today]
aud_today = [r for r in recs if norm(r.get('auditTime')) == today]
sub_pass = [r for r in sub_today if r.get('auditStatus') == 6]
sub_rej  = [r for r in sub_today if r.get('auditStatus') == 3]
sub_wait = [r for r in sub_today if r.get('auditStatus') not in (6, 3)]
aud_pass = [r for r in aud_today if r.get('auditStatus') == 6]
aud_rej  = [r for r in aud_today if r.get('auditStatus') == 3]

tot_sub, tot_pass, tot_rej = len(recs), sum(1 for r in recs if r.get('auditStatus') == 6), sum(1 for r in recs if r.get('auditStatus') == 3)
tot_wait = tot_sub - tot_pass - tot_rej
rate = round(tot_pass * 100 / (tot_pass + tot_rej)) if (tot_pass + tot_rej) else 0

def split(lst):
    c = collections.Counter(kind_of(r) for r in lst)
    return '品退 %d · 中差评 %d' % (c.get('品退', 0), c.get('中差评', 0)) if lst else '—'

L = []
L.append('【抖店申诉日报】%s' % today)
L.append('')
L.append('📤 今日提交 %d 单（%s）' % (len(sub_today), split(sub_today)))
if sub_today:
    L.append('   ├ 已出结果：成功 %d · 失败 %d' % (len(sub_pass), len(sub_rej)))
    L.append('   └ 审核中：%d' % len(sub_wait))
L.append('')
L.append('📋 今日出结果 %d 单（含往日提交）' % len(aud_today))
L.append('   ├ ✅ 成功 %d' % len(aud_pass))
L.append('   └ ❌ 失败 %d' % len(aud_rej))
if aud_today:
    L.append('   当日通过率 %d%%' % round(len(aud_pass) * 100 / len(aud_today)))
L.append('')
L.append('📊 累计：提交 %d · 成功 %d · 失败 %d · 审核中 %d（通过率 %d%%）' % (tot_sub, tot_pass, tot_rej, tot_wait, rate))

# 今日驳回原因 Top
rej_msg = collections.Counter()
for r in aud_rej:
    m = str(r.get('resultMsg') or '').replace('失败原因:', '').split(';平台建议')[0].strip()
    m = (m[:34] + '…') if len(m) > 34 else m
    rej_msg[m or '(无理由)'] += 1
if rej_msg:
    L.append('')
    L.append('❌ 今日驳回原因 Top')
    for m, n in rej_msg.most_common(5):
        L.append('   • %s  ×%d' % (m, n))

# ---------- 店铺维度 ----------
shops = {}
def row(s):
    return shops.setdefault(s, {'subT': 0, 'passT': 0, 'rejT': 0, 'waitT': 0,
                                'audT': 0, 'audPass': 0, 'audRej': 0,
                                'total': 0, 'pass': 0, 'rej': 0})
for r in recs:
    d = row(str(r.get('shop') or '?'))
    d['total'] += 1
    if r.get('auditStatus') == 6:
        d['pass'] += 1
    elif r.get('auditStatus') == 3:
        d['rej'] += 1
for r in sub_today:
    d = row(str(r.get('shop') or '?'))
    d['subT'] += 1
    if r.get('auditStatus') == 6:
        d['passT'] += 1
    elif r.get('auditStatus') == 3:
        d['rejT'] += 1
    else:
        d['waitT'] += 1
for r in aud_today:
    d = row(str(r.get('shop') or '?'))
    d['audT'] += 1
    if r.get('auditStatus') == 6:
        d['audPass'] += 1
    elif r.get('auditStatus') == 3:
        d['audRej'] += 1

if shops:
    L.append('')
    L.append('🏪 店铺维度（今日 提交·成功·失败·审核中 ｜ 累计 单数·通过率）')
    ordered = sorted(shops.items(), key=lambda kv: (-kv[1]['subT'], -kv[1]['total']))
    active = [(s, d) for s, d in ordered if d['subT'] or d['audT']]
    idle = [(s, d) for s, d in ordered if not (d['subT'] or d['audT'])]
    for s, d in active:
        r_ = round(d['pass'] * 100 / (d['pass'] + d['rej'])) if (d['pass'] + d['rej']) else 0
        L.append('• %s' % s)
        L.append('   今日 提交%d 成功%d 失败%d 审核中%d ｜ 出结果%d（成%d 败%d）' % (
            d['subT'], d['passT'], d['rejT'], d['waitT'], d['audT'], d['audPass'], d['audRej']))
        L.append('   累计 提交%d 成功%d 失败%d · 通过率%d%%' % (d['total'], d['pass'], d['rej'], r_))
    if idle:
        L.append('')
        L.append('— 今日无提交的店（累计）—')
        for s, d in idle:
            r_ = round(d['pass'] * 100 / (d['pass'] + d['rej'])) if (d['pass'] + d['rej']) else 0
            L.append('• %s：提交 %d · 成功 %d · 失败 %d · 通过率 %d%%' % (s, d['total'], d['pass'], d['rej'], r_))

L.append('')
L.append('（数据源：抖店举报记录，%s）' % ('本次已刷新' if os.environ.get('SYNCED') == '1' else '本次未刷新，沿用上次'))
text = '\n'.join(L)

open(out, 'w', encoding='utf-8').write(text + '\n')
print(text)

# 存一份 json（页面/后续分析用）
json_path = os.path.join(rd, 'daily-summary.json')
try:
    js = {'date': today, 'text': text,
          'subToday': len(sub_today), 'audToday': len(aud_today),
          'audPass': len(aud_pass), 'audReject': len(aud_rej),
          'total': {'sub': tot_sub, 'pass': tot_pass, 'reject': tot_rej, 'pending': tot_wait, 'rate': rate},
          'byShop': [dict(shop=s, **d) for s, d in sorted(shops.items(), key=lambda kv: -kv[1]['total'])],
          'generatedAt': datetime.datetime.now().isoformat()}
    json.dump(js, open(json_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
except Exception:
    pass

# 推云端（供页面展示）
try:
    for src, dst in ((out, 'daily-summary.txt'), (json_path, 'daily-summary.json')):
        subprocess.run(['/usr/bin/scp', '-q', '-i', os.path.expanduser('~/.ssh/xdr_mac'),
                        '-o', 'ConnectTimeout=12', src,
                        'root@47.114.33.246:/srv/appeal-workbench/data/' + dst], timeout=30)
    print('已推云端')
except Exception as e:
    print('推云端失败:', e)

# 飞书推送
try:
    wf = os.path.join(app, 'alert-webhook.json')
    cfg = json.load(open(wf))
    url, secret = str(cfg.get('url') or '').strip(), str(cfg.get('secret') or '').strip()
    if url:
        payload = {'msg_type': 'text', 'content': {'text': text}}
        if secret:
            ts = str(int(time.time()))
            dig = hmac.new((ts + '\n' + secret).encode('utf-8'), digestmod=__import__('hashlib').sha256).digest()
            payload['timestamp'] = ts
            payload['sign'] = base64.b64encode(dig).decode('utf-8')
        req = urllib.request.Request(url, data=json.dumps(payload, ensure_ascii=False).encode(),
                                     headers={'Content-Type': 'application/json'})
        r = urllib.request.urlopen(req, timeout=10)
        print('飞书:', r.status, r.read().decode()[:80])
except Exception as e:
    print('飞书推送失败:', e)

PY

say "日报已生成: $OUT"
say "==== 每日汇总结束 ===="
