#!/bin/bash
# 店铺健康体检：① 登录状态（工作台 loginHealth）② 飞鸽会话权限/会话失效
# 有异常 → 写报告 + macOS 通知（可选 webhook）
set -u
APP="$HOME/Library/Application Support/shopdesk"
REPORT="$APP/health-report.json"
LOG="$APP/health-check.log"
WEBHOOK_FILE="$APP/alert-webhook.txt"     # 可选：一行飞书/企业微信机器人 webhook
say(){ echo "[$(date '+%F %T')] $*" >> "$LOG"; }
BRIDGE="$APP/agent-bridge.json"
[ -f "$BRIDGE" ] || { say "工作台未运行，跳过"; exit 0; }
P=$(/usr/bin/plutil -extract port raw -o - "$BRIDGE" 2>/dev/null)
T=$(/usr/bin/plutil -extract token raw -o - "$BRIDGE" 2>/dev/null)
case "$P" in ''|*[!0-9]*) say "端口无效，跳过"; exit 0;; esac
case "$T" in ''|*[!0-9a-f]*) say "token 无效，跳过"; exit 0;; esac

PORT="$P" TOKEN="$T" APP="$APP" /usr/bin/python3 - <<'PY'
import json, os, subprocess, time, datetime, urllib.request

app=os.environ['APP']; port=os.environ['PORT']; token=os.environ['TOKEN']

def api(method, args=None, timeout=60):
    body=json.dumps({"method":method,"args":args or {}})
    p=subprocess.run(['/usr/bin/curl','--config','-','-s','--max-time',str(timeout),'--noproxy','*',
                      '-H','Content-Type: application/json','--data-binary',body,
                      'http://127.0.0.1:%s/call'%port],
                     input='header = "Authorization: Bearer %s"\n'%token, capture_output=True, text=True)
    try: return json.loads(p.stdout)
    except Exception: return {}

# ① 各店登录状态（工作台维护）
shops=json.load(open(os.path.join(app,'shops.json')))
login_bad=[]
for s in shops:
    h=(s.get('loginHealth') or {})
    st=h.get('status')
    if st in ('needs_login','needs_verification'):
        login_bad.append({'shop':s['name'],'id':s['id'],'status':st,'checkedAt':h.get('checkedAt')})

# ② 逐店探飞鸽页（会话权限/会话失效）
expr='''(()=>{try{const t=(document.body?document.body.innerText:"").slice(0,3000);
return JSON.stringify({ready:(!!document.querySelector(".messageList")||document.querySelectorAll(".msgItemWrap").length>0),
noperm:/暂无会话权限|基础接待/.test(t),login:/扫码登录|验证码登录|登录已失效|请先登录/.test(t),
head:t.replace(/\\s+/g," ").slice(0,100)});}catch(e){return JSON.stringify({error:String(e&&e.message||e)})}})()'''
feige_bad=[]
for i,s in enumerate(shops):
    if s.get('platform')!='抖店': continue
    r=api('flyge_probe',{'shop_id':s['id'],'url':'https://im.jinritemai.com/pc_seller_v2/main/workspace','expression':expr},timeout=45)
    j=r.get('result',{})
    if isinstance(j,str):
        try: j=json.loads(j)
        except Exception: j={}
    if j.get('noperm') or j.get('login'):
        feige_bad.append({'shop':s['name'],'id':s['id'],'reason':('无会话权限' if j.get('noperm') else '登录失效')})
    time.sleep(0.2)

rep={'checked_at':datetime.datetime.now().isoformat(timespec='seconds'),
     'shop_total':len([s for s in shops if s.get('platform')=='抖店']),
     'login_bad':login_bad,'feige_bad':feige_bad}
json.dump(rep, open(os.path.join(app,'health-report.json'),'w'), ensure_ascii=False, indent=1)

n=len(login_bad)+len(feige_bad)
print('登录异常 %d 家；飞鸽异常 %d 家' % (len(login_bad), len(feige_bad)))
for x in login_bad: print('  [登录] %s (%s)' % (x['shop'], x['status']))
for x in feige_bad: print('  [飞鸽] %s (%s)' % (x['shop'], x['reason']))

if n:
    lines=[]
    if login_bad: lines.append('登录掉线 %d 家：%s' % (len(login_bad), '、'.join(x['shop'] for x in login_bad[:5])))
    if feige_bad: lines.append('飞鸽异常 %d 家：%s' % (len(feige_bad), '、'.join(x['shop'] for x in feige_bad[:5])))
    msg=' | '.join(lines)
    # macOS 通知
    try:
        subprocess.run(['/usr/bin/osascript','-e','display notification %s with title "店铺掉线提醒"' % json.dumps(msg, ensure_ascii=False)], timeout=10)
    except Exception: pass
    # 可选 webhook
    wf=os.path.join(app,'alert-webhook.txt')
    if os.path.isfile(wf):
        try:
            url=open(wf).read().strip()
            if url:
                payload=json.dumps({'msg_type':'text','content':{'text':'【店铺掉线】'+msg}}, ensure_ascii=False).encode()
                req=urllib.request.Request(url, data=payload, headers={'Content-Type':'application/json'})
                urllib.request.urlopen(req, timeout=10)
                print('webhook 已发送')
        except Exception as e: print('webhook 失败:', e)
PY
say "体检完成"
