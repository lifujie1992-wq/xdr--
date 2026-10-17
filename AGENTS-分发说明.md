# AGENTS-分发说明 — 把工作台发给其他电脑的 Agent

> 2026-10-17 起工作台内嵌三平台直连能力（拼多多离线签名 / 千牛页面路由 / 抖店原有采集）。
> 本文给**拿到工作台 app 的其他电脑上的 Agent**：怎么接入、能干什么、各平台边界。

## 一、接入协议（agent-bridge）

工作台启动后在本机开 HTTP 接口，**端口和 token 动态生成**，写在：

```
~/Library/Application Support/shopdesk/agent-bridge.json   # 0600
→ {"port": <端口>, "token": "<hex>", "pid": <工作台进程>}
```

调用方式（仅限本机 127.0.0.1）：

```
POST http://127.0.0.1:<port>/call
Headers:
  Authorization: Bearer <token>
  Content-Type: application/json
Body: {"method": "<能力名>", "args": {...}}
```

失败返回 HTTP 400 + `{"error": "..."}`。先调 `list_shops` 拿 shop_id。

## 二、三平台直连能力

### 拼多多（`pdd_request`）— 离线签名，重启不掉登录

```json
{"method":"pdd_request","args":{"shop_id":"<id>","method":"GET",
 "path":"/earth/api/mallInfo/commonMallInfo"}}
```
- 算法内嵌（fbeZ anti-content 离线生成 + 服务器时间缓存），**无外部依赖**
- 登录态：分区持久 cookie，重启不掉；过期回工作台重登即可
- POST 自动把 `crawlerInfo` 塞 body、GET 塞 query（复刻页面行为）
- 同店限速 1.2s/次

### 天猫/淘宝·千牛（`tb_mtop` / `tb_request` / `tb_drive`）— 页面上下文路由

```json
{"method":"tb_mtop","args":{"shop_id":"<id>","api":"mtop.taobao.jdy.shop.tag.query","data":{}}}
{"method":"tb_drive","args":{"shop_id":"<id>","click_text":"待发货","wait_api":"asyncSold","timeout_ms":25000}}
```
- **tb_mtop**：在店铺页内借官方 `lib.mtop.request` 调任意 mtop API（签名/安全头/token 由 SDK 代劳）——这是唯一可行路，离线调用一律 SESSION_EXPIRED（已实证）
- **tb_drive 双模式**：给 `wait_api` = 点击/刷新后抓该接口响应体；不给 `wait_api` = **发现模式**，返回页面发出的全部 API + POST 参数（探索未知接口用这个）
- 会话核心 cookie 不落盘，但工作台已内置**会话快照持久化**（登录成功即存、每 5 分钟刷新、打开店铺前自动回灌）：
  **重启后千牛自动恢复登录态**（快照 7 天内有效；服务端会话失效时才会回落到重新扫码，登录后自动刷新快照）

### 抖店（原有能力不变）

`open_shop` / `read_shop_page` / `find_metric_evidence` / `flyge_probe` / 申诉自动化 / 采集器等，见原 README。

## 三、探索新接口的标准姿势（Agent 自己就能做）

1. **发现**：`tb_drive`（淘宝，不给 wait_api）或 `pdd_request` 试探 / `exploration`（抖店）
2. **验证**：拿发现模式返回的接口+参数直接调
3. **取数**：确定参数后固定调用

多多已有已验证接口清单见 `多多/README.md`；淘宝页内 API 名可在千牛工作台页面用
`performance.getEntriesByType('resource')` 自查。

## 四、分发边界（重要）

- 当前包是 **macOS ad-hoc 签名**：Mac 之间直接拷 `/Applications/店铺工作台.app` 可用；
  首次打开如被 Gatekeeper 拦 → 右键打开或 `xattr -cr /Applications/店铺工作台.app`。
  Windows 需另行打包（本仓库无 Windows 构建流程）。
- **登录态不随 app 走**：每台机器各自扫码一次。拼多多为持久 cookie；千牛靠内置会话快照，
  重启自动恢复（≤7 天）；抖店为持久 cookie。首次在新机器上必须各扫一次。
- agent-bridge **仅监听 127.0.0.1** + Bearer token（每次启动换），不暴露局域网。
- 边界红线不变：仅自有店铺、限速、不做越权/压测/批量爬取。

## 五、解密通道（随包附带 `解密通道-jst_decrypt.py`）

军火库的解密资产是**聚水潭 ERP 通道**，不是平台直连，也**不在工作台内**：

| 平台 | 通道 | 可行性 |
|---|---|---|
| 拼多多 | `pinduoduo.erp321.com/order/GetOrdersWithEncrypt` | ✅ 纯脚本 |
| 京东 | 虎符直连 | ✅ 纯脚本 |
| 抖音/头条 | 端侧 SDK | ❌ 需真浏览器 |
| 兜底 | 本机 ERP 助手 WS（54322/54323） | ❌ 需装客户端 |

用法见脚本头部注释；需要**聚水潭登录 cookie**（`~/Downloads/jst-cookie-export.json` 或自备）。
淘宝/拼多多的**平台直连**收件人解密（保密信息接口）需资质与频控，未纳入，需要时单独立项。

## 六、算法与规则的知识库（不随 app 分发，按需拷贝）

逆向过程、算法细节、case 记录在本机 `~/军火库/`：
- `多多/work/pdd-mms-web-sign/` — fbeZ anti-content 全套（剥离脚本可复跑）
- `淘宝/work/taobao-qianniu-page-context/report.md` — mtop/安全头/Baxia 实证链
- `淘宝/taobao-toolkit/` — 旧版 mtop 离线签名（老会话类型仍可用）
