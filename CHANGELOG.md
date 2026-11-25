# 更新记录

## 0.2.4 — 2026-11-25

### 采纳使用者那份本地改动（原样并进）

- **`spawnSync` 把宿主冻住**：`lib/rec.js` 的 `runExplore()` 用同步 `spawnSync` 跑
  `jm_explore.py`（超时 180 秒）。Node 是单线程，这一调用不返回，同进程里所有 HTTP 路由
  都在它后面排队——点「按口味推荐」之后切页面整个界面就没反应，日志里一条错都没有。
  改成 `spawn` + Promise，超时自己 `kill`；`recommendMany` / `recommendOne` 跟着改 async，
  对话工具那边补 `await`。
- **推荐改后台任务**：`POST /recommend/run`、`/recommend/eh` 立刻返回 `jobId`，新增
  `GET /recommend/status?id=` 轮询；页面用 `sessionStorage` 记任务，切走再回来能接上
  （30 分钟内）、没有未完成任务就把上次结果摆出来。任务表只留最近 20 个。
- **嵌进宿主面板**：`?embed=1` 或 iframe 下加 `body.embed`（隐藏 header），同源
  `target="_blank"` 链接改成就地跳转——Electron 的 `windowOpenHandler` 会静默拦掉，
  点了跟卡住一样。
- **「回 DSH」不再整页重载**：改成按钮，按三档处理（新窗口就 `window.close()`、同窗口
  `history.back()`、都不行才跳 `../`）。
- **关闭按钮的安全边界**：只有在 `?win=1` 打开的新窗口里才显示。**在 DSH 主窗口里调
  `window.close()` 会把宿主连后台进程一起关掉**——这是 0.2.3 我加的那个按钮的隐患，已按
  这个规则限住。
- **`client.js` 改常驻查看栏**：面板里直接嵌 iframe（`?embed=1`），上面一排按钮切页，
  不再开新窗口；切换时先 `about:blank` 再挂 `src`，避免上一页还在跑请求时把框拖住。
- 命名统一：`settings.section` 的 label 与页面标题改成 `JM / EH`。

### 我这边补的

- **下载有进度了**（右键下载原来只弹一句「已开始下载」，之后成败全靠猜）：
  - 所有页面共用 `page()` 里注入的 `dlToast` 提示条 + `dlWatchEh` / `dlWatchJm` 轮询器；
  - E 站问 `/eh/status`：显示「下载中 12/40 张」、完成后报「缺第 N 页（重跑只补缺页）」、
    以及「N 张只拿到显示版」；失败直接把 `msg` 报出来；
  - JM 问 `/jm/status`：排队位次、已落盘张数、失败时日志尾部；
  - `lib/jm.js` 从 jmcomic 的 `→ [路径]` 日志里统计已落盘页数（`jmJob().pages`），
    脚本没给总数，所以只报已下张数；
  - 每条入口（E 站收藏页、E 站详情页、JM 收藏页、JM 详情页、阅读器右键）都接上了。
- **修掉一处残留**：阅读器右键菜单里 `window.open(..., '_blank', 'noopener')` 还带着
  features 参数（0.2.1 修的是面板三个按钮，这里漏了）。
- **`scripts/jm_login.py`**：补上 jmcomic `login()` 的两个坑——① 它只写 `AVS`，不写
  `uid` / `username`（收藏接口要三个都在）；② 第一次登录响应常不带 `__cflb`，Cloudflare
  粘性会话换节点后掉登录态，所以再登录一次合并 cookie。三个脚本改成调它（找不到
  `jm_login.py` 时自动退化成旧行为）。**实测**：cookie 里 `__cflb` / `uid` / `username`
  都在，收藏夹 9 页、第一页 20 条，不再 401。
- `test/test_ui.mjs` 增加下载反馈断言（提示条、两个轮询器、各处入口都接上）。

### 仍未处理

- 独立窗口与宿主窗口的视觉重叠（需要宿主的窗口布局约定）。
- `lib/jm.js` 收藏操作、`index.js` 探针里剩下的 `spawnSync`（秒级操作，影响小）。
- `test/test_client.mjs` 仍按字面量顺序断言，面板结构一动就得改。

## 0.2.3 — 2026-11-24

界面反馈那一批，全部落在这里。

- **进收藏页之后出不去**：`lib/web.js` 的 header 只有站内导航，没有退回 DSH 或关窗口的入口；
  加上 0.2.1 之后入口改成新标签打开，而桌面端没有浏览器标签栏，用户点进去就回不来。
  - header 末尾加「回 DSH」（`../`）与「关闭」两个出口；
  - 关闭按钮先试 `window.close()`，关不掉（同窗口跳进来的情况）再 `history.back()`，最后退到 `../`。
- **窄窗口下按钮错位**：`header` 是 `flex-wrap:nowrap`，且 `.sub` 没有 `min-width:0`
  （flex 子项默认 `min-width:auto`，内容多长都压不下去），窗口一窄 `nav` 就被挤出容器，
  视觉位置和点击区域对不上。
  - `.sub` 加 `min-width:0`，`header` 改 `flex-wrap:wrap`，`nav` 自己也允许换行；
  - 加 `@media (max-width:860px)`：header 收窄、隐藏 `.sub`、`nav` 独占一行可横向滚动；560px 以下缩卡片最小宽度。
- **封面取不到时一片空白**：`<img>` 没有失败兜底。改成在 `page()` 里挂一个捕获阶段的
  `error` 监听，任何 `IMG` 加载失败都替换成「封面取不到」占位块 —— 一处覆盖所有页面。
  - 顺带核实：本机用真实数据跑通了 `ehgt.org` 封面（`200 / 11296 字节 / image/webp`），
    `/thumb` 代理本身没问题；之前那边全空白是出口网络不通。
- **推荐页只有 JM**：`/recommend` 只接了 JM 的 `recMany`。加 JM / E 站两个 tab，
  E 站 tab 走新路由 `POST /recommend/eh`（调 `deps.recEh`，复用 `ehentai_recommend` 那套
  tag 画像打分），返回的条目带 `thumb`，卡片能直接显示封面。
  - `lib/recommend.js` 的返回值补上 `thumb` 字段（原来只给了 gid/token/title/tags，页面没封面可用）。
- **两处小毛病**：收藏页那句玩笑式 notice 改成中性说明（里站需要 igneous）；顶栏版本号改为
  从 `package.json` 读（`deps.version`），不再硬编码 `b1108a`。
- 新增 `test/test_ui.mjs`：把上面这些（出口按钮、版本号来源、图片失败占位、推荐页两个 tab、
  中性文案、header 可换行/可收缩/有媒体查询）固化成断言。

## 0.2.2 — 2026-11-24

- **`package.json` 被写成带 UTF-8 BOM**，宿主 `dsh plugin list` 直接
  `JSON.parse(readFileSync(...))` 抛 `SyntaxError: Unexpected token '\uFEFF'`，插件在列表里报错。
  - 这是我自己的锅：0.2.1 改版本号时用了 PowerShell 的
    `Set-Content -Encoding utf8`（5.1 默认写 BOM），把 BOM 写回了文件。0.2.0 及更早是干净的。
  - Node 的 `import` / `require` / `node --check` 都会自动剥 BOM，所以本机一切正常，
    只有宿主的裸 `JSON.parse` 会炸——这类问题必须在测试里挡。
- 新增 `test/test_encoding.mjs`：扫一遍被跟踪的文本文件不许有 BOM，并用**裸 `JSON.parse`**
  校验 `package.json` / `settings.example.json`（模拟宿主读法，不走会剥 BOM 的加载器）。
- 文档补上这个坑：改 JSON 一律用编辑器/脚本写不带 BOM 的 UTF-8，别用
  `Set-Content -Encoding utf8`。

## 0.2.1 — 2026-11-24

- **面板上的按钮点了没反应**：`client.js` 里三个入口用的是
  `window.open(url, '_blank', 'noopener')`。带第三个 features 参数时浏览器按"弹窗"处理，
  Electron 桌面版的 windowOpenHandler 经常直接 deny，返回 null 而不抛错，原来的
  `try { … } catch {}` 又什么都吞掉，于是点击看起来毫无反应。
  - 改成不带 features，断开 opener 用 `w.opener = null`；
  - 返回 null（被拦）时退成 `window.location.assign`，至少能打开；
  - 三个入口从 `<button>` 换成 `<a href target="_blank">`，中键、右键"在新标签打开"也能用；
  - 面板上补一句"万一点了没反应，右键复制链接地址"。
- 新增 `test/test_client.mjs`：离线验证 bundle 能被 ModuleLoader 收下、两处 slot 都注册、
  三个入口的 href 正确、`window.open` 被拦时会退到当前窗口。
- 记录一个问题定位线索：面板能显示出按钮，说明 client bundle 加载成功，但**不代表**服务端
  路由已注册。按钮打开的是 404 时，先直接访问 `http://127.0.0.1:<端口>/dsh-ehentai/jm`
  确认路由（本机实测 200 + HTML）。

## 0.2.0 — 2026-11-24

这一版基本是"别人机器上跑一遍"逼出来的修复。原版本在本机一路顺，换台机器就是装不上、同步只进第一页、下载只拿到缩略版——都是环境依赖和几处站点机制记错，不是重写。

### 修掉的错

- **E 站收藏同步只到第一页**：原先给 `favorites.php` 拼 `?page=N`，站点不认（实测 page 0/1/2 返回同一份 HTML），永远只同步 50 条。改成跟页面里的 `<a id="unext" href="...?next=<gid>-<时间戳>">` 游标逐页走。
- **E 站搜索分页同样失效**：搜索结果页的下一页是 `?f_search=...&next=<gid>` 游标，`?page=N` 一样被忽略（实测三页同一份 HTML）。现在跟页面里的 `unext`；`page` 参数还在，但要靠顺游标跳页实现（游标值猜不出来）。顺带：`ehentai_search` 与推荐都按 gid 去重。
- **推荐里同一本出现两三次**：`recommend` / `findNew` 把三页结果直接拼进候选池、不按 gid 去重，同一本被打三次分、排序后并排出现。现在边收集边去重。
- **表站 cookie 两处口径不一致**：`eh.js` 用整串 `ehentaiCookie`，`ehdl.js` 只认三个分量，表站用户同步成功、下载却像没登录。统一成 `cookieOf()` 一处（里站三分量优先，表站整串优先），同步与下载共用。
- **E 站只下到显示版**：`<img id="img">` 给的是 `xres=1280` 的缩图（实测同一张：显示版 100KB webp，原图 2.5MB jpeg）。现在优先走页面里的 `fullimg` 链接（302 到 hath 的原始文件），拿不到才退回显示版并单独计数。新增 `ehOriginal: false` 可只取显示版、省流量。
  - 顺带堵了一个坑：`fullimg` 需要登录，未登录时 302 到 `bounce_login.php` 回的是一页 HTML（1300 字节），只看大小会把它写进文件当图片。现在认 `content-type`，不是图片就按失败处理；没 cookie 时直接走显示版，不多打一次必然失败的请求。
- **hath 个别节点连不上直接失败**：带非标端口的节点 TLS 握手会被掐，重试同一地址没用。现在用站点自己的 `?nl=<id>` 机制换节点，最多三轮。
- **文件名按成功序号编号导致整本错位**：第 7 页失败，第 8 页会存成 `007.jpg`，阅读器顺序全乱。改成按页序编号（失败也占位），并加断点续传（只补缺页，跳过时会校验文件大小，半截文件不算完成）。
- **数据目录被拼成双层 `.dsh`**：`DSH_HOME` 本身已指向 `.dsh` 时，数据落到 `...\.dsh\.dsh\...`，与文档位置不符。
- **硬编码 `py -3.13`**：只有 3.12 的机器上五个脚本全挂（`No suitable Python runtime found`）。新增 `lib/pycmd.js`，按 `jm.python` → `DSH_JMPY` → `py -3.13` → `py -3` → `python` 探测并缓存。
- **下载子进程没传 JM 账号**：`jm_download_one.py` 从环境变量读账号，而 spawn 只给了 `PYTHONIOENCODING`，登录态带不进去。
- **下载记录有时写不进去**：目录原本只靠日志里的 `→ [路径]` 解析，格式一变就断。解析不出时按"最近改动的本子目录"兜底（下载是串行的，可判定）。
- **限流被误报成"没搜到"**：E 站限流常回 HTTP 200，正文只有 `temporarily banned`。现在识别为明确的限流错误，翻页/推荐页间也加了限速。
- **`jm_fetch.py` 的 `update` 恒为 `"0"`**：用了 `update_date`，`jmcomic` 2.7.12 里它恒 0，改成 `pub_date`（与 `jm_explore.py` 对齐）。

### 改掉的不靠谱之处

- 收藏同步消息拆成"新增 N 条 / 更新 M 条"（原来 `added` 是写入次数，翻页失效时会报"写入 150 条、库里 54 条"）。
- `engines.node` 从 `>=20` 改成 `>=22`（`node:sqlite` 是 22 才有的）。
- 补 `peerDependencies`（`@deepseek-ai/dsh-tools`，标记 optional），`files` 去掉实际不入库的 `NOTES.md`。
- README 补两种安装姿势与 `ERR_MODULE_NOT_FOUND` 的处理办法。

### 新增

- `lib/pycmd.js`、`lib/recommend.js` 入目录说明。
- `scripts/` 收进 5 个 `.py` 脚本副本（原先只存在于数据目录、没有版本管理，分发版和本地版已经分叉过一次）。
- `test/test_units.mjs`：离线单测，覆盖游标解析、cookie 口径、302 跟随（含跨源摘 Cookie）、Python 探测。
- `test/test_routes.mjs` 补齐 `recMany` mock，28 个路由全绿。

## 0.1.0

首个版本：JM 检索 / 收藏 / 下载队列 / 封面墙 / 阅读器，E-Hentai 检索、收藏同步、tag 偏好画像与推荐，11 个对话工具 + 8 个本地页面，DPAPI 凭证加密。
