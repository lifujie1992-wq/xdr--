# 店铺工作台 · 申诉自动化

抖音小店「品退 / 中差评」自动举报工作台。基于店铺工作台（Electron）二次开发。

## 目录

```
src/            主程序源码（打进 app.asar）
  appeal.js       自动申诉核心：筛查 → 飞鸽零沟通 → 截图 → 接口提交
  appeal-web.js   本地看板网页（8899）：运营/老板/复盘/工单
  main.js / agent-api.js / preload.js   本机接口接线
  index.html / style.css / renderer.js  工作台内 UI
collectors/     采集模块（Python，放进 App 的 Resources/collectors/builtin/）
  quality.py      品退 + 中差评 扫描
  worker.py       采集任务入口
build.sh        构建 + 部署（打包 asar → 重签名 → 装进 App → 重启）
```

## 开发流程（在自己机器上改代码）

```bash
git clone <repo> && cd shopdesk-workbench-src
# 改 src/ 或 collectors/ 里的代码
git commit -am "xxx" && git push
```

在**工作台那台 Mac** 上部署：

```bash
cd ~/shopdesk-workbench-src && git pull
bash build.sh                 # 构建 + 部署 + 重启 App
```

> `collectors/`（采集模块）改完**不需要**跑 build.sh，
> 直接拷到 `店铺工作台.app/Contents/Resources/collectors/builtin/` 即可（改完下一轮采集生效）。

## 关键设计

### 抓取：接口优先
- **举报提交**：`POST /shopuser/accuse/apply`
  ⚠️ **必须从浏览器页面里发起**（在 Node/curl 里直接调会被平台风控拦）
- **可否举报判定**：
  - 品退：`POST /shopuser/accuse/apply_pre_check_v2`（返回空=可举报）
  - 中差评：`POST /shopuser/accuse/comment_list`（看 `can_select`）
- **平台审核结果**：`POST /shopuser/accuse/list` + `/detail`

### 品退口径（平台口径）
只报「售后原因=品质类」且「售后说明=主观原因」的单（说明为空的不报，平台不认）。

### 中差评口径
1~3 星 + 无图无视频 + 飞鸽零沟通；**逐个举报原因试，平台 `can_select=true` 才提交**。
（实测：**"评价内容为空"的中差评平台一律不受理**）

### 状态只反映平台事实
`已举报 / 举报中 / 已通过 / 已驳回 / 不可举报 / 无需举报 / 已举报过 / 买家有沟通`
——**没有"可申诉"这种我们没核实过的状态**。

### 永久跳过名单
`~/Library/Application Support/shopdesk/appeal-reports/skipped.json`
标过的（不可举报/无需举报/已举报过/买家有沟通）永不重查。

## 看板网页
`http://127.0.0.1:8899/` —— 运营 / 老板 / 复盘 / 工单 四个 Tab，
支持日期筛选、分页、CSV 导出、AI提交标记、商品名/编码。

## 定时任务
`~/Library/LaunchAgents/local.shopdesk.appeal.plist` → 每天 9:00
调用 `daily-appeal.sh` → 触发申诉 + 同步平台审核结果。

