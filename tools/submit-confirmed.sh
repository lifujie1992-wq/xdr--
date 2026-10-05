#!/bin/bash
# 定时提交「已确认」：拉云端确认（含人工修改） → 若有已确认未提交的单 → 触发轻量提交(confirmedOnly)
set -u
APP="$HOME/Library/Application Support/shopdesk"
SRC="$HOME/shopdesk-workbench-src"
LOG="$APP/appeal-reports/submit-confirmed.log"
mkdir -p "$APP/appeal-reports"
say(){ echo "[$(date '+%F %T')] $*" >> "$LOG"; }

BRIDGE="$APP/agent-bridge.json"
[ -f "$BRIDGE" ] || { say "工作台未运行，跳过"; exit 0; }
P=$(/usr/bin/plutil -extract port raw -o - "$BRIDGE" 2>/dev/null)
T=$(/usr/bin/plutil -extract token raw -o - "$BRIDGE" 2>/dev/null)
case "$P" in ''|*[!0-9]*) say "端口无效，跳过"; exit 0;; esac
case "$T" in ''|*[!0-9a-f]*) say "token 无效，跳过"; exit 0;; esac

# ① 拉云端确认（合并进本地队列，带人工修改后的内容）
bash "$SRC/tools/sync-appeal-cloud.sh" >> "$LOG" 2>&1 || say "云端同步失败（忽略）"

# ② 统计「已确认且未提交」
N=$(/usr/bin/python3 - <<'PY'
import json,os
p=os.path.expanduser('~/Library/Application Support/shopdesk/appeal-reports/review-queue.json')
try: q=json.load(open(p))
except Exception: print(0); raise SystemExit
print(sum(1 for v in (q.get('items') or {}).values() if isinstance(v,dict) and v.get('status')=='confirmed'))
PY
)
say "待提交已确认: ${N:-0}"
[ "${N:-0}" -gt 0 ] || exit 0

# ③ 已有申诉任务在跑 → 本次跳过，下次再提
R=$(printf 'header = "Authorization: Bearer %s"\n' "$T" | /usr/bin/curl --config - -s --max-time 15 --noproxy '*' -H 'Content-Type: application/json' --data-binary '{"method":"auto_appeal_status"}' "http://127.0.0.1:$P/call" 2>/dev/null)
case "$R" in *'"running":true'*) say "已有申诉任务在跑，本次跳过"; exit 0;; esac

# ④ 触发轻量提交（只处理已确认单）
OUT=$(printf 'header = "Authorization: Bearer %s"\n' "$T" | /usr/bin/curl --config - -s --max-time 30 --noproxy '*' \
  -H 'Content-Type: application/json' -H 'X-ShopDesk-Client: cron' \
  --data-binary '{"method":"auto_appeal_start","args":{"kinds":["reviews"],"submit":true,"reviewQueue":true,"confirmedOnly":true,"skipSync":true}}' \
  "http://127.0.0.1:$P/call" 2>/dev/null)
say "已触发提交: $OUT"
