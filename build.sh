#!/bin/bash
# 构建 + 部署：把 src/ 打进 app.asar，重签名，装进本机的工作台 App
#
# 用法：
#   bash build.sh              # 构建并部署到本机 /Applications 或 ~/店铺工作台.app
#   bash build.sh --no-install # 只生成 dist/app.asar，不安装
#
# 注意：必须是 macOS（要 codesign）。修改 collectors/ 里的采集模块不需要跑这个脚本。
set -e
cd "$(dirname "$0")"

# launchd 环境下 PATH 极简，必须自己找 node（用 glob 自动探测）
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
for d in "$HOME/.local"/node-*/bin "$HOME/.nvm/versions/node"/*/bin /opt/homebrew/opt/node/bin "$HOME/.volta/bin"; do
  [ -x "$d/node" ] && export PATH="$d:$PATH"
done
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then echo "❌ 找不到 node，请检查 Node.js 安装（PATH=$PATH）"; exit 1; fi
echo "   node: $NODE_BIN"

APP="${SHOPDESK_APP:-/Users/zhaoxiaozhong/店铺工作台.app}"
ASAR_BIN="${ASAR_BIN:-npx --yes @electron/asar}"
WORK="$(mktemp -d)"
STAGE="$WORK/app"

echo "① 准备构建目录"
mkdir -p "$STAGE" dist
cp -R src "$STAGE/src"
cp -R collectors "$STAGE/collectors" 2>/dev/null || true
cp package.json "$STAGE/" 2>/dev/null || true

echo "② 打包 app.asar"
rm -f dist/app.asar
$ASAR_BIN pack "$STAGE" dist/app.asar >/dev/null
ls -lh dist/app.asar

if [ "$1" = "--no-install" ]; then echo "✅ 已生成 dist/app.asar（未安装）"; rm -rf "$WORK"; exit 0; fi

echo "③ 校验完整性哈希（Electron 要求）"
HASH=$(node -e '
const fs=require("fs"),crypto=require("crypto");
const fd=fs.openSync("dist/app.asar","r");
const b=Buffer.alloc(8); fs.readSync(fd,b,0,8,0);
const sl=Buffer.alloc(4); fs.readSync(fd,sl,0,4,12);
const n=sl.readInt32LE(0); const j=Buffer.alloc(n); fs.readSync(fd,j,0,n,16);
console.log(crypto.createHash("SHA256").update(j).digest("hex"));
fs.closeSync(fd);')
echo "   hash=$HASH"

echo "④ 安装到 App"
[ -d "$APP" ] || { echo "❌ 找不到 App: $APP（用 SHOPDESK_APP=... 指定）"; exit 1; }
cp dist/app.asar "$APP/Contents/Resources/app.asar"
/usr/libexec/PlistBuddy -c "Set :ElectronAsarIntegrity:Resources/app.asar:hash $HASH" "$APP/Contents/Info.plist"

echo "⑤ 重签名（ad-hoc）"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 && echo "   OK"

echo "⑥ 重启 App"
pkill -f "店铺工作台" 2>/dev/null || true
sleep 3
rm -f "$HOME/Library/Application Support/shopdesk/agent-bridge.json"
open "$APP"
sleep 15
if [ -f "$HOME/Library/Application Support/shopdesk/agent-bridge.json" ]; then
  echo "✅ 部署完成，本机接口已就绪"
else
  echo "⚠️ 接口未起来，可能需要手动确认（退出重开 App）"
fi
rm -rf "$WORK"
