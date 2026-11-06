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
| `/dsh-ehentai/recommend` | 推荐（可自动打开内置窗口） |
| `/dsh-ehentai/explore` | 检索结果 |
| `/dsh-ehentai/jm/stats` | 词条与画师统计 |
| `/dsh-ehentai/view` `/ehview` | 内置浏览页（顶栏带收藏 / 下载） |
| `/dsh-ehentai/player` | 本地阅读器（上下翻页、上一本 / 下一本） |

## 安装

1. 把本包放进 `<dsh 用户目录>/profiles/<profile>/node_modules/@dsh-jmcomic/ehentai/`

2. 在该 profile 的 `cordis.patch.yml` 末尾追加：

```yaml
  - id: "@dsh-jmcomic/ehentai"
    name: "@dsh-jmcomic/ehentai"
```

3. 重启 DSH。日志里出现 `dsh-jmcomic/ehentai` 即加载成功。

## 依赖

- Node.js ≥ 20（`node:sqlite` 需要较新版本）
- Python 3.13 + `jmcomic`（`pip install jmcomic`），JM 的检索与下载走它
- 一个能访问 e-hentai.org / 18comic 的代理（大陆环境必需）
- 仅用检索时**不需要账号**；收藏与下载才需要

## 配置

配置写在 `~/.dsh/dsh-jmcomic-ehentai/settings.json`（Windows 为 `%DSH_HOME%\.dsh\dsh-jmcomic-ehentai\`），可参照 `settings.example.json`。

| 字段 | 说明 |
|---|---|
| `proxy` | `127.0.0.1:7890` 或 `http://host:port`，留空则直连 |
| `jm.user` / `jm.pass` | JM 账号，密码**写盘时自动加密** |
| `jm.web` | JM 网页域名，默认 `18comic.vip` |
| `jm.gap` | 下载时每页间隔秒数，默认 0.8 |
| `useExhentai` | 用 ExHentai（内容更全）还是 E-Hentai |
| `exhentaiCookies` | 三个 cookie，同样写盘时加密 |
| `openMode` | `dsh` 走内置窗口，`os` 走系统浏览器 |

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

## 剧情省流

三步，顺序不能乱：

1. **压缩** —— `jm_thumbs.py <id> 720` 把已下载的页面缩成宽 720 的副本，单张从几百 KB 降到一百多 KB，字还认得出
2. **概括** —— 每批读 8~10 张，读完立刻落成文字再开下一批，别让图一直挂在上下文里
3. **贴封面** —— 结论讲完，最后放一张封面图，让人一眼判断值不值得看

## 目录

```
index.js            插件入口，注册 11 个工具
client.js           前端半边（面板卡片与设置分区）
lib/http.js         带 HTTP 代理的请求（CONNECT 隧道 + TLS）
lib/secret.js       DPAPI 凭证加密
lib/store.js        SQLite 存储 + 偏好画像计算
lib/eh.js           E-Hentai 客户端：搜索 / gdata / 收藏页解析
lib/ehdl.js         E 站画廊下载（含分页）
lib/ehfav.js        E 站收藏 / 取消收藏
lib/jm.js           JM 数据、下载队列、封面缓存
lib/explore.js      检索、严格校验、打分排序
lib/rec.js          推荐
lib/web.js          全部路由与页面渲染
test/test_routes.mjs   把全部路由打一遍
test/test_scripts.mjs  检查渲染出的内联脚本语法
```

## 已知限制

- **标签不准**：站点标签打得不匀，作品名常只出现在标题里。检索加了严格校验与「无法校验的词」兜底，但仍会有偏差
- **作品名要给双语**：`偶像大师|アイドルマスター`——中文译名在站点标签和标题里往往不存在
- **E 站下载速度**：每张间隔 1.2 秒，290 页要十几分钟；触发站点带宽限制需等一段时间
- **里站门槛**：拿不到 `igneous` 就用不了 ExHentai，表站内容池窄一截
- **正则解析**：站点改版后选择器可能失效，届时改 `lib/eh.js` 的 `parseListPage`

## 内容边界

本插件处理的是虚构作品的检索与整理。使用本插件、或在此仓库上让 AI 代写代码时，内容边界的完整约定见 [AGENTS.md](AGENTS.md)。

## 许可

MIT
