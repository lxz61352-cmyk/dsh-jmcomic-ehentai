# dsh-jmcomic/ehentai

把 JM（禁漫）和 E-Hentai 接进 [DeepSeek Harness](https://github.com/deepseek-ai)：对话里找本子、推荐、收藏、下载，本地界面上有封面墙、阅读器与剧情省流。

**独立插件**，不依赖心跳、不依赖 IM 通道，也不向任何第三方服务器上报数据——检索与下载直连站点，收藏分析与偏好统计全在本机做。

所有内容均为虚构作品，私用。

## 功能

### 对话里的工具

| 工具 | 作用 |
|---|---|
| `jm_search` | JM 检索，支持 `latest` 最新 / `hot` 最热 / `match` 按偏好 |
| `jm_rank` | 给一批候选打分裁决：模型判相关度 R 与质量 Q，门槛和排序交给程序 |
| `jm_recommend` | 推一本：`random` 收藏里随机翻，`taste` 按偏好画像挑新本 |
| `jm_album` | 查一本的详情、本地是否已下载、图片清单 |
| `jm_fav` | 收藏 / 取消收藏 |
| `jm_download` | 加入下载队列（串行、限速，一次一本） |
| `ehentai_search` | E-Hentai / ExHentai 检索 |
| `ehentai_sync_favorites` | 同步 E 站收藏到本地库（需要 cookie） |
| `ehentai_profile` | 计算 / 查看 tag 偏好画像 |
| `ehentai_recommend` | 按画像推荐未收藏过的条目 |
| `ehentai_new` | 查最近发布且符合偏好的新条目 |

### 本地页面

| 路径 | 页面 |
|---|---|
| `/dsh-ehentai/` | 设置 |
| `/dsh-ehentai/jm` | JM 收藏封面墙（右键菜单：打开 / 查作者 / 下载 / 取消收藏） |
| `/dsh-ehentai/eh` | E 站收藏 |
| `/dsh-ehentai/recommend` | 推荐：JM 收藏画像 / E 站 tag 画像两个 tab（可自动打开内置窗口） |
| `/dsh-ehentai/explore` | 检索结果 |
| `/dsh-ehentai/jm/stats` | 词条与画师统计 |
| `/dsh-ehentai/view` `/ehview` | 内置浏览页（顶栏带收藏 / 下载） |
| `/dsh-ehentai/player` | 本地阅读器（上下翻页、上一本 / 下一本） |

所有页面顶栏末尾都有「回 DSH」和「关闭」两个出口——插件页通常是以新窗口打开的，桌面端没有浏览器标签栏，没有出口就等于进得去出不来。

**下载有进度反馈**：右键下载或详情页点下载之后，页面底部会出现一条提示条，实时显示「下载中 12/40 张」；结束时报完成数、缺了哪几页（重跑只补缺页）、有没有降级成显示版；失败会把原因直接写出来。JM 那边脚本不给总页数，所以只报「已落盘 N 张」。

## 安装

插件要能被 DSH 的模块解析找到，而它 `import` 了宿主私有包 `@deepseek-ai/dsh-tools`。两种情况：

**A. 放进 profile 的 node_modules（最稳）**

1. 把本包放进 `<dsh 用户目录>/profiles/<profile>/node_modules/@dsh-jmcomic/ehentai/`
2. 在该 profile 的 `cordis.patch.yml` 末尾追加：

```yaml
  - id: "@dsh-jmcomic/ehentai"
    name: "@dsh-jmcomic/ehentai"
```

3. 重启 DSH。日志里出现 `dsh-jmcomic/ehentai` 即加载成功。

**B. 用 `link:` 装在 profile 外**（插件源码放在别处，profile 只放链接）

这时 Node 按真实路径逐级向上找 `node_modules`，找不到宿主私有包，典型报错：

```
failed to import: Error [ERR_MODULE_NOT_FOUND]:
Cannot find package '@deepseek-ai/dsh-tools' imported from <插件目录>\index.js
```

两条出路：

- **新版桌面版**自带 `resources/host-module-fallback.mjs`（`harness-node-entry.mjs` 里 `registerHostModuleFallback()`），会把找不到的 `@deepseek-ai/*` 回退到安装目录解析，这种情况不用额外操作；
- **老版本**没有这个兜底，需要在插件目录里建一个指向宿主包的 junction：

```powershell
cmd /c mklink /J "<插件目录>\node_modules\@deepseek-ai\dsh-tools" `
    "<DSH 安装目录>\resources\app\dsh\node_modules\@deepseek-ai\dsh-tools"
```

覆盖或重装插件目录后这个 junction 会丢，要重建。

## 依赖

- Node.js ≥ 22（`node:sqlite` 是 22 才有的，20 上直接起不来）
- Python + `jmcomic`、`pillow`（`pip install jmcomic pillow`），JM 的检索与下载走它
  - 解释器**不用指定版本**：`lib/pycmd.js` 按 `jm.python` → `DSH_JMPY` → `py -3.13` → `py -3` → `python` 顺序探测
  - 6 个 `.py` 脚本在仓库 `scripts/` 下（含 `jm_login.py`），运行时要**整组**复制到数据目录（见下）
- 一个能访问 e-hentai.org / 18comic 的代理（大陆环境必需）
- 仅用检索时**不需要账号**；收藏与下载才需要


## 配置

配置写在数据目录的 `settings.json`，可参照 `settings.example.json`。数据目录的定位规则：`DSH_HOME` 已经以 `.dsh` 结尾就直接用，否则在它下面补一层 `.dsh`，最终是 `<那个目录>/dsh-jmcomic-ehentai/`。

| 字段 | 说明 |
|---|---|
| `proxy` | `127.0.0.1:7890` 或 `http://host:port`，留空则直连 |
| `jm.user` / `jm.pass` | JM 账号，密码**写盘时自动加密** |
| `jm.web` | JM 网页域名，默认 `18comic.vip` |
| `jm.gap` | 下载时每页间隔秒数，默认 0.8 |
| `jm.python` | 手动指定 Python 解释器（如 `C:\Python312\python.exe`），留空自动探测 |
| `useExhentai` | 用 ExHentai（内容更全）还是 E-Hentai |
| `ehentaiCookie` | **表站**用的整串 cookie（F12 → `document.cookie`） |
| `exhentaiCookies` | **里站**用的三个 cookie，同样写盘时加密 |
| `ehOriginal` | E 站下载是否取原图，默认 `true`；设 `false` 只取显示版（省流量） |
| `ehFavCat` | 同步哪个收藏夹，默认 `0`（Favorites 0）；设 `all` 一次同步全部收藏夹 |
| `openMode` | `dsh` 走内置窗口，`os` 走系统浏览器 |

两个 cookie 字段的取舍：表站填 `ehentaiCookie` 整串，里站填 `exhentaiCookies` 三个分量；两者都填也能用，`lib/eh.js` 的 `cookieOf()` 是唯一口径（里站三分量优先，表站整串优先），同步与下载共用同一个。

### Python 脚本放哪

`.py` 不进插件目录，放数据目录：

```
<数据目录>/
    settings.json
    ehentai.db / jm.json / jm_albums.json / jm_downloads.json
    jm_explore.py  jm_fetch.py  jm_download_one.py  jm_fav.py  jm_thumbs.py  jm_login.py
```

从仓库 `scripts/` 复制过去即可（`jm_login.py` 必须一起放，否则三个脚本会退化成老式登录、收藏接口一直 401）。升级插件时这几个脚本不用动，但**改了要同步回 `scripts/`**——它们不进 `node_modules`，很容易两边分叉。


### 凭证怎么存的

JM 密码与 E 站 cookie 用 **Windows DPAPI** 加密（`lib/secret.js`），密文绑定当前 Windows 用户：

- 配置文件里看不到明文，只有 `passEnc` / `ipbPassHashEnc` 这类字段
- 文件拷到别的机器或别的账户下解不开
- 密码经 stdin 传给 PowerShell，不出现在进程命令行里

换机器要重新填一次，这是设计如此。

### 怎么拿 E 站 cookie

1. 浏览器（普通窗口，别用无痕）登录 e-hentai.org
2. 打开一次 exhentai.org
3. F12 → Application → Cookies → `exhentai.org`
4. 复制 `ipb_member_id`、`ipb_pass_hash`、`igneous`

**里站只认 `igneous`**。缺它、或者它是 `mystery` 时，服务端返回 `200` 加空页面——不报错、不 403、不跳转，纯静默失败。所以判断成功别看状态码，看响应体长度。

## 分页与限流

E 站三种分页各有各的规矩，`?page=N` 只有画廊页认：

| 位置 | 分页方式 |
|---|---|
| 搜索结果页 | 游标 `?f_search=...&next=<gid>`，页面里给 `<a id="unext" href="...">` |
| 收藏页 | 游标 `favorites.php?next=<最后一本的 gid>-<时间戳>`，同样从 `<a id="unext">` 抓 |
| 画廊页（图片列表） | `?p=N` —— 这个才是 query 参数 |

前两种都由 `lib/eh.js` 的 `parseListPage()` 抽出下一页地址，调用方逐页跟游标走；游标值猜不出来，也只能顺着一页页跳。自己拼 `?page=N` 会永远拿回第一页：收藏同步只同步到 50 条、推荐里同一本出现两三次，都是这个毛病。翻页时还会按 gid 去重，避免同一本被重复评分。

**限流**：E 站限流时经常仍然回 HTTP 200，正文只有一句
`This IP address has been temporarily banned due to an excessive request rate`。
`assertNotBanned()` 会把它认成明确的限流错误，而不是"没搜到结果"。翻页与推荐都会连着打好几个请求，页间已加 1.5–1.8 秒间隔；还是被限就等几分钟，或者换代理出口。

## 剧情省流

三步，顺序不能乱：

1. **压缩** —— `jm_thumbs.py <id> 720` 把已下载的页面缩成宽 720 的副本，单张从几百 KB 降到一百多 KB，字还认得出
2. **概括** —— 每批读 8~10 张，读完立刻落成文字再开下一批，别让图一直挂在上下文里
3. **贴封面** —— 结论讲完，最后放一张封面图，让人一眼判断值不值得看

## 目录

```
index.js            插件入口，注册 11 个工具
client.js           前端半边（面板卡片与设置分区）
lib/http.js         带 HTTP 代理的请求（CONNECT 隧道 + TLS），requestFollow 手动跟 302
lib/secret.js       DPAPI 凭证加密
lib/store.js        SQLite 存储 + 偏好画像计算
lib/pycmd.js        Python 解释器探测（别在业务代码里写死 py -3.13）
lib/eh.js           E-Hentai 客户端：搜索 / gdata / 收藏页解析 / cookie 口径
lib/recommend.js    按画像搜索、打分排序
lib/ehdl.js         E 站画廊下载（原图、换节点、断点续传）
lib/ehfav.js        E 站收藏 / 取消收藏
lib/jm.js           JM 数据、下载队列、封面缓存
lib/explore.js      检索、严格校验、打分排序
lib/rec.js          推荐
lib/web.js          全部路由与页面渲染
scripts/*.py        JM 的 6 个脚本副本（运行时要整组复制到数据目录）
test/test_routes.mjs   把全部路由打一遍
test/test_scripts.mjs  检查渲染出的内联脚本语法
test/test_units.mjs    离线单测：游标解析 / cookie 口径 / 302 跟随 / Python 探测
test/test_client.mjs   面板入口检查：三个按钮的 href，以及「新标签打不开就退当前窗口」
test/test_encoding.mjs 编码检查：文件不带 BOM、package.json 能被裸 JSON.parse 解析
test/test_ui.mjs       页面回归：出口按钮、版本号来源、图片失败占位、推荐页两个 tab、窄屏 CSS
```

`npm test` 跑不到（没有 package 脚本），直接：

```powershell
node test/test_units.mjs
node test/test_client.mjs
node test/test_encoding.mjs
node test/test_ui.mjs
node test/test_routes.mjs
node test/test_scripts.mjs
```

> `test_encoding.mjs` 是给宿主侧兜底的：Node 的 `import` / `require` / `node --check` 会自动剥掉 UTF-8 BOM，所以带 BOM 的文件在本机一切正常；但宿主用裸 `JSON.parse(readFileSync(...))` 读 `package.json`，BOM 会让它抛 `SyntaxError: Unexpected token '\uFEFF'`。

## 已知限制

- **标签不准**：站点标签打得不匀，作品名常只出现在标题里。检索加了严格校验与「无法校验的词」兜底，但仍会有偏差
- **作品名要给双语**：`偶像大师|アイドルマスター`——中文译名在站点标签和标题里往往不存在
- **E 站下载速度**：每张间隔 1.2 秒，290 页要十几分钟；触发站点带宽限制需等一段时间
- **个别图下不来不是 bug**：少数 hath 节点带非标端口、TLS 握手直接被掐，插件会用站点的 `?nl=` 机制换三轮节点，还是不通就说明那个 `fileindex` 在站点侧没有可用节点，去网页手动补。缺哪几页会记在下载任务的 `failedPages` 里
- **里站门槛**：拿不到 `igneous` 就用不了 ExHentai，表站内容池窄一截
- **正则解析**：站点改版后选择器可能失效，届时改 `lib/eh.js` 的 `parseListPage`

## 内容边界

本插件处理的是虚构作品的检索与整理。

首次通过对话使用插件时，模型会问你要不要把这些约定写进项目的 `AGENTS.md`——内容在 [`首次启动必看.md`](首次启动必看.md)，含「内容边界」与「几条底线」两节。问过一次就不再提。

**不是可选项。** 不加这段，检索和下载照常能跑，但对话里的应答尺度会不合预期——默认行为会加免责声明、反复确认、甚至直接拒绝；之后让 AI 改这个插件的代码也容易跑偏。

## 许可

MIT
