#!/bin/bash
# 自动部署：检查 GitHub 有没有新提交，有就拉下来重新构建 + 重启 App
# 由 launchd 每 5 分钟跑一次（见 local.shopdesk.autodeploy.plist）
set -u
cd "$(dirname "$0")"
LOG="$HOME/Library/Application Support/shopdesk/autodeploy.log"
mkdir -p "$(dirname "$LOG")"
say(){ echo "[$(date '+%F %T')] $*" >> "$LOG"; }

# 只在工作台没在跑任务时部署（避免打断申诉）
BRIDGE="$HOME/Library/Application Support/shopdesk/agent-bridge.json"
if pgrep -f "python.*worker.py" >/dev/null 2>&1; then say "有采集在跑，跳过本轮"; exit 0; fi

BEFORE=$(git rev-parse HEAD 2>/dev/null)
git fetch --quiet origin 2>>"$LOG" || { say "git fetch 失败（没网？）"; exit 0; }
AFTER=$(git rev-parse origin/HEAD 2>/dev/null || git rev-parse origin/main 2>/dev/null || git rev-parse origin/master 2>/dev/null)
[ -z "$AFTER" ] && { say "取不到远端分支"; exit 0; }
[ "$BEFORE" = "$AFTER" ] && exit 0     # 没变化，静默退出

say "发现新提交 ${BEFORE:0:7} → ${AFTER:0:7}，开始部署"
git pull --quiet --ff-only 2>>"$LOG" || { say "git pull 失败"; exit 1; }
bash build.sh >>"$LOG" 2>&1
say "部署完成，当前版本 $(git rev-parse --short HEAD)"
