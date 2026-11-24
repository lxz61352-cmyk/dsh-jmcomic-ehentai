# 更新记录

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
