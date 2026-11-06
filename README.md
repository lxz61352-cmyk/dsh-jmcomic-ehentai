# dsh-jmcomic/ehentai

DeepSeek Harness 插件：检索 E-Hentai / ExHentai，同步收藏、分析 tag 偏好、按偏好推荐与推送新本。

**独立插件**，不依赖心跳、不依赖 IM 通道，也不往任何外部服务器发数据——所有分析都在本地做。

## 它做什么

| 工具 | 作用 |
|---|---|
| `ehentai_search` | 按关键词 / tag 搜索，返回标题、分类、评分、页数、链接 |
| `ehentai_sync_favorites` | 把账号收藏同步到本地库（需要 cookie） |
| `ehentai_profile` | 计算 / 查看 tag 偏好画像 |
| `ehentai_recommend` | 按画像推荐未收藏过的条目，按 tag 吻合度排序 |
| `ehentai_new` | 查最近发布且符合偏好的新条目 |

## 依赖

- Node.js ≥ 20（`node:sqlite` 需要较新的版本）
- 一个能访问 e-hentai.org 的代理（大陆环境必需）
- 仅使用小功能时**不需要 cookie**；同步收藏才需要

## 安装

1. 把本包放进 `<dsh 用户目录>/profiles/<profile>/node_modules/@dsh-jmcomic/ehentai/`

2. 在该 profile 的 `cordis.patch.yml` 末尾追加：

```yaml
  - id: "@dsh-jmcomic/ehentai"
    name: "@dsh-jmcomic/ehentai"
```

3. 重启 DSH。日志里出现 dsh-jmcomic/ehentai 即加载成功。

## 配置

配置写在 `~/.dsh/dsh-jmcomic-ehentai/settings.json`（Windows 为 `%DSH_HOME%\.dsh\dsh-ehentai\`）。
可参照 `settings.example.json`。

| 字段 | 说明 |
|---|---|
| `proxy` | `127.0.0.1:7890` 或 `http://host:port`，留空则直连 |
| `useExhentai` | 用 ExHentai（内容更全）还是 E-Hentai |
| `exhentaiCookies` | ExHentai 三个 cookie，见下 |
| `ehentaiCookie` | 用 E-Hentai 时填整条 Cookie 串 |
| `profile.halfLifeDays` | 收藏权重的时间半衰期（天）。越小越看重近期收藏 |
| `profile.minCount` | 一个 tag 至少要出现几次才进画像 |
| `push.enabled` | 是否开启插件自带的定时检查 |
| `push.intervalMinutes` | 定时检查间隔（分钟） |

### 怎么拿 ExHentai 的 cookie

1. 浏览器登录 exhentai.org
2. F12 → Application → Cookies → `exhentai.org`
3. 复制 `ipb_member_id`、`ipb_pass_hash`、`igneous` 三个值

`igneous` 会定期失效，换了重新填。

## 偏好算法

对每条收藏：

```
权重 = 评分基准 × 时间衰减
时间衰减 = 0.5 ^ (收藏距今天数 / 半衰期)
评分基准 = 该条评分（未评分时取全部收藏的均值）
```

按 tag 累加权重，过滤掉 `language:` `category:` `other:` 这类通用 tag
（它们几乎每条都有，代表不了个人口味），取权重最高的 N 个作为画像。

推荐时用画像里 top-3 的 tag 组搜索式，命中结果按

```
吻合度 = Σ(命中 tag 的画像权重) / sqrt(该条 tag 总数)
```

排序——除以 `sqrt` 是为了不让 tag 特别多的本子占便宜。

## 已知限制

- **没有分页 UI**：一次最多翻几页（`recommend.pages`），更深的要手动调大
- **收藏同步依赖 cookie**：cookie 过期会中断，返回已完成页数
- **正则解析**：E 站改版后选择器可能失效，届时改 `lib/eh.js` 里的 `parseListPage`
- **速率限制**：翻页与 gdata 之间都加了延时；触发 509（带宽限制）需等一段时间
- **推送只到 DSH 界面**：通过 system-prompt 提示模型主动提起，不依赖任何通知渠道

## 目录

```
index.js            插件入口，注册 5 个工具 + 定时检查
lib/http.js         带 HTTP 代理的请求（CONNECT 隧道 + TLS）
lib/eh.js           E-Hentai 客户端：搜索 / gdata / 收藏页 / 页面解析
lib/store.js        SQLite 存储 + 偏好画像计算
lib/recommend.js    推荐与新本筛选
test.mjs            冒烟测试（node test.mjs）
```

## 许可

MIT
