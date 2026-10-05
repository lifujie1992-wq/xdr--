#!/bin/bash
# 店铺健康体检：① 登录状态 ② 飞鸽会话权限/会话失效
# 发现异常先自动刷新会话(重开店铺首页)再复查；仍有异常 → 弹窗 + 飞书告警
set -u
APP="$HOME/Library/Application Support/shopdesk"
LOG="$APP/health-check.log"
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
FEIGE = 'https://im.jinritemai.com/pc_seller_v2/main/workspace'
HOME  = 'https://fxg.jinritemai.com/ffa/mshop/homepage/index'
EXPR_FEIGE = '(()=>{try{const t=(document.body?document.body.innerText:"").slice(0,3000);return JSON.stringify({ready:(!!document.querySelector(".messageList")||document.querySelectorAll(".msgItemWrap").length>0),noperm:/暂无会话权限|基础接待/.test(t),login:/扫码登录|验证码登录|登录已失效|请先登录/.test(t)});}catch(e){return "{}"}})()'
EXPR_HOME  = '(()=>{try{const t=(document.body?document.body.innerText:"").slice(0,3000);return JSON.stringify({login:/扫码登录|验证码登录|密码登录|登录已失效|请先登录/.test(t),head:t.replace(/\\s+/g," ").slice(0,60)});}catch(e){return "{}"}})()'

def api(method, args=None, timeout=60):
    body=json.dumps({"method":method,"args":args or {}})
    p=subprocess.run(['/usr/bin/curl','--config','-','-s','--max-time',str(timeout),'--noproxy','*',
                      '-H','Content-Type: application/json','--data-binary',body,
                      'http://127.0.0.1:%s/call'%port],
                     input='header = "Authorization: Bearer %s"\n'%token, capture_output=True, text=True)
    try: return json.loads(p.stdout)
    except Exception: return {}

def jget(r):
    j=r.get('result',{})
    if isinstance(j,str):
        try: j=json.loads(j)
        except Exception: j={}
    return j

def probe(shop_id,url,expr):
    return jget(api('flyge_probe',{'shop_id':shop_id,'url':url,'expression':expr},timeout=45))

def login_bad_list():
    bad=[]
    for x in json.load(open(os.path.join(app,'shops.json'))):
        h=(x.get('loginHealth') or {}); st=h.get('status')
        if st in ('needs_login','needs_verification'):
            bad.append({'shop':x['name'],'id':x['id'],'status':st,'checkedAt':h.get('checkedAt')})
    return bad

shops=[x for x in json.load(open(os.path.join(app,'shops.json'))) if x.get('platform')=='抖店']

# ① 逐店探飞鸽
feige_bad=[]
for s in shops:
    j=probe(s['id'],FEIGE,EXPR_FEIGE)
    if j.get('noperm') or j.get('login'):
        feige_bad.append({'shop':s['name'],'id':s['id'],'reason':('无会话权限' if j.get('noperm') else '登录失效')})
    time.sleep(0.2)

# ② 异常店铺自动刷新会话(重开首页) → 再复查
refreshed=[]
if feige_bad:
    for x in feige_bad:
        probe(x['id'],HOME,EXPR_HOME)
        time.sleep(2.5)
    still=[]
    for x in feige_bad:
        j=probe(x['id'],FEIGE,EXPR_FEIGE)
        if j.get('noperm') or j.get('login'): still.append(x)
        else: refreshed.append({'shop':x['shop'],'id':x['id'],'was':x['reason']})
    feige_bad=still

login_bad=login_bad_list()
json.dump({'checked_at':datetime.datetime.now().isoformat(timespec='seconds'),
           'shop_total':len(shops),'login_bad':login_bad,'feige_bad':feige_bad,'auto_recovered':refreshed},
          open(os.path.join(app,'health-report.json'),'w'), ensure_ascii=False, indent=1)

print('自动刷新恢复 %d 家 %s' % (len(refreshed), ('· '+'、'.join(x['shop'] for x in refreshed[:6])) if refreshed else ''))
print('登录异常 %d 家；飞鸽异常 %d 家' % (len(login_bad), len(feige_bad)))
for x in login_bad: print('  [登录] %s (%s)' % (x['shop'], x['status']))
for x in feige_bad: print('  [飞鸽] %s (%s)' % (x['shop'], x['reason']))

n=len(login_bad)+len(feige_bad)
if n:
    lines=[]
    if login_bad: lines.append('登录掉线 %d 家：%s' % (len(login_bad), '、'.join(x['shop'] for x in login_bad[:5])))
    if feige_bad: lines.append('飞鸽异常 %d 家：%s' % (len(feige_bad), '、'.join(x['shop'] for x in feige_bad[:5])))
    msg=' | '.join(lines)
    try:
        subprocess.run(['/usr/bin/osascript','-e','display notification %s with title "店铺掉线提醒"' % json.dumps(msg, ensure_ascii=False)], timeout=10)
    except Exception: pass
    wf=os.path.join(app,'alert-webhook.json')
    if os.path.isfile(wf):
        try:
            import hashlib, hmac, base64
            cfg=json.load(open(wf)); url=str(cfg.get('url') or '').strip(); secret=str(cfg.get('secret') or '').strip()
            if url:
                payload={'msg_type':'text','content':{'text':'【店铺掉线】'+msg}}
                if secret:
                    ts=str(int(time.time()))
                    dig=hmac.new((ts+'\n'+secret).encode('utf-8'), digestmod=hashlib.sha256).digest()
                    payload['timestamp']=ts; payload['sign']=base64.b64encode(dig).decode('utf-8')
                req=urllib.request.Request(url, data=json.dumps(payload, ensure_ascii=False).encode(), headers={'Content-Type':'application/json'})
                r=urllib.request.urlopen(req, timeout=10)
                print('webhook:', r.status, r.read().decode()[:80])
        except Exception as e: print('webhook 失败:', e)
PY
say "体检完成"
