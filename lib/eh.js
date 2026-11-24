/**
 * E-Hentai / ExHentai 客户端。
 *
 * 只做三件事：搜列表、gdata 批量取元数据、拉收藏页。
 * 解析一律用正则（E 站没有稳定 API 文档，DOM 会变，正则比 cheerio 更容易随手修）。
 */
import { getTextFollow, postJson } from './http.js'

export const EH = 'https://e-hentai.org'
export const EX = 'https://exhentai.org'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 组装 Cookie 串。**全站只此一处**，eh.js / ehd.js 共用同一口径。
 *
 *   · 里站（useExhentai）：三个分量（ipb_member_id / ipb_pass_hash / igneous）优先，
 *     缺 igneous 就是白页，所以这里只拼分量；实在没有分量才退回整串。
 *   · 表站：整串 ehentaiCookie 优先（设置面板里给表站的就这一个字段），
 *     整串为空时退回三个分量 —— 两处口径不一致会让"同步成功、下载却像没登录"。
 */
export function cookieOf(cfg) {
  const c = (cfg && cfg.exhentaiCookies) || {}
  const parts = []
  if (c.ipbMemberId) parts.push(`ipb_member_id=${c.ipbMemberId}`)
  if (c.ipbPassHash) parts.push(`ipb_pass_hash=${c.ipbPassHash}`)
  if (c.igneous) parts.push(`igneous=${c.igneous}`)
  const three = parts.join('; ')
  const whole = String((cfg && cfg.ehentaiCookie) || '').trim()
  return cfg && cfg.useExhentai ? three || whole : whole || three
}

/** 站点与 cookie 组装成请求头 */
export function buildCtx(cfg) {
  const useEx = !!cfg.useExhentai
  const base = useEx ? EX : EH
  const headers = {}
  const ck = cookieOf(cfg)
  if (ck) headers.Cookie = ck
  return { base, headers, proxy: cfg.proxy || null }
}

/**
 * 站点限流的识别。E 站在限流时经常仍然回 200，正文只有几百字节的
 * "This IP address has been temporarily banned due to an excessive request rate"，
 * 不认这一种就会被误报成"没搜到结果"。
 */
const BANNED_RE = /temporarily banned|excessive request rate|Image Limits|too many requests/i

function assertNotBanned(text) {
  if (BANNED_RE.test(String(text || ''))) {
    throw new Error(
      '被 E 站限流（excessive request rate）：等几分钟再试，或在设置里换代理出口。' +
        '翻页/推荐会连着打好几个请求，最容易触发。'
    )
  }
}

/** 相对地址 → 绝对地址 */
function absUrl(base, href) {
  const h = String(href || '').trim()
  if (!h) return ''
  if (/^https?:\/\//i.test(h)) return h
  return `${base}${h.startsWith('/') ? '' : '/'}${h}`
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]*>/g, '')).trim()
}

/**
 * 解析一个列表页（搜索结果页 / 收藏页共用同一套结构）
 *
 * 分页链接两种页面都有，锚点 id 都是 unext：
 *   · 收藏页：<a id="unext" href="https://e-hentai.org/favorites.php?next=4129408-1795518132">
 *   · 搜索页：<a id="unext" href="https://e-hentai.org/s/<searchkey>/1">
 * 所以统一从 href 里拿，不要自己拼参数（?page=N 站点两种页面都不认）。
 *
 * @returns {{items: Array, hasNext: boolean, nextUrl: string}}
 */
export function parseListPage(html) {
  const items = []
  // 每条画廊是一个 <tr class="gtr" ...> ... </tr>（收藏页）或 grid 里的 <div class="gl1t">
  // 统一做法：先按画廊链接切块
  const linkRe = /href="https?:\/\/(?:e-hentai|exhentai)\.org\/g\/(\d+)\/([0-9a-f]{10})\/?"/g
  const anchors = []
  let m
  while ((m = linkRe.exec(html))) {
    anchors.push({ gid: m[1], token: m[2], index: m.index })
  }
  // 去重（同一条画廊在页面里会出现两次链接：封面 + 标题）
  const seen = new Set()
  const uniq = []
  for (const a of anchors) {
    if (seen.has(a.gid)) continue
    seen.add(a.gid)
    uniq.push(a)
  }

  for (let i = 0; i < uniq.length; i++) {
    const start = uniq[i].index
    const end = i + 1 < uniq.length ? uniq[i + 1].index : Math.min(html.length, start + 6000)
    const block = html.slice(start, end)

    // 标题：<div class="glink">…</div> 或收藏页的 <a ... class="glink">
    let title = ''
    const t1 = block.match(/<div[^>]+class="[^"]*glink[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    if (t1) title = stripTags(t1[1])
    if (!title) {
      const t2 = block.match(/<a[^>]+class="[^"]*glink[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      if (t2) title = stripTags(t2[1])
    }

    // 分类：<div class="cs">…</div>
    const c = block.match(/<div[^>]+class="[^"]*\bcs\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    const category = c ? stripTags(c[1]) : ''

    // 列表页上的 tag（粗筛用，不一定全）
    const tags = []
    const tagRe = /<div[^>]+class="[^"]*\bgt[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
    let tm
    while ((tm = tagRe.exec(block))) {
      const v = stripTags(tm[1])
      if (v && !tags.includes(v)) tags.push(v)
    }

    // 缩略图
    const th = block.match(/<img[^>]+src="([^"]+)"[^>]*>/i)

    items.push({
      gid: uniq[i].gid,
      token: uniq[i].token,
      title,
      category,
      posted: 0,
      thumb: th ? th[1] : '',
      tags,
    })
  }

  // 下一页：优先取页面给的链接（游标），只有当页面上写着「下一頁」却没有链接时才算可疑
  let nextUrl = ''
  const unext = html.match(/<a[^>]*\bid="unext"[^>]*>/i)
  if (unext) {
    const h = unext[0].match(/href="([^"]+)"/i)
    if (h) nextUrl = decodeEntities(h[1])
  }
  const hasNext = !!nextUrl || /下一頁|Next Page/i.test(html)

  return { items, hasNext, nextUrl }
}

/**
 * 关键词搜索。
 *
 * 翻页两种方式都支持：
 *   · nextUrl：上一页解析出的 <a id="unext"> 链接，最可靠，优先用它；
 *   · page：从 0 起的页号。第二页的地址形如 `?f_search=...&next=<gid>`，游标值猜不出来，
 *     所以 page>0 时只能从第一页顺着 nextUrl 一页页跳过去（`?page=N` 站点直接忽略）。
 *
 * @param {number} page 0 起
 * @param {string} extraQuery 附加查询参数（不含前导 ?）
 * @param {string} nextUrl 上一页给的下一页地址
 */
export async function search(cfg, keyword, page = 0, extraQuery = '', nextUrl = '') {
  const { base, headers, proxy } = buildCtx(cfg)
  const opt = { headers, proxy, timeoutMs: 45000 }
  const q = extraQuery
    ? `${extraQuery}&f_search=${encodeURIComponent(keyword)}`
    : `f_search=${encodeURIComponent(keyword)}`

  let r = await getTextFollow(nextUrl ? absUrl(base, nextUrl) : `${base}/?${q}`, opt)
  assertNotBanned(r.text)

  // page > 0 且没给游标：站点没给可构造的第二页地址（搜索页的下一页就是
  // `?f_search=...&next=<gid>` 游标），只能从第一页顺着游标跳过去。
  if (page > 0 && !nextUrl) {
    let u = parseListPage(r.text).nextUrl
    for (let hop = 1; hop <= page; hop++) {
      if (!u) break // 已经到末页，停在这里
      await sleep(1500)
      r = await getTextFollow(absUrl(base, u), opt)
      assertNotBanned(r.text)
      u = parseListPage(r.text).nextUrl
    }
  }

  if (r.status === 403) throw new Error('403：可能需要配置 cookie 或代理，或站点反爬')
  if (r.status === 509) throw new Error('509：触发带宽限制（Image Limits），稍后再试')
  if (r.status !== 200) throw new Error(`搜索页 HTTP ${r.status}`)
  const parsed = parseListPage(r.text)
  if (!parsed.items.length && /You are viewing an offline|favorites\.php|log in/i.test(r.text)) {
    throw new Error('未取得结果：可能是未登录、收藏页需 cookie，或关键词无匹配')
  }
  return { ...parsed, url: r.url, page }
}

/**
 * gdata 批量取元数据（一次最多 25 个）
 * @param {Array<{gid:string,token:string}>} list
 */
export async function gdata(cfg, list) {
  const { base, headers, proxy } = buildCtx(cfg)
  const out = []
  const CHUNK = 25
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK)
    const payload = {
      method: 'gdata',
      gidlist: chunk.map((x) => [Number(x.gid), x.token]),
      namespace: 1,
    }
    const r = await postJson(`${base}/api.php`, payload, { headers, proxy })
    if (r.status !== 200 || !r.json) {
      throw new Error(`gdata 失败：HTTP ${r.status} ${String(r.text || '').slice(0, 120)}`)
    }
    for (const g of r.json.gmetadata || []) {
      out.push({
        gid: String(g.gid),
        token: g.token,
        title: decodeEntities(g.title || ''),
        titleJpn: decodeEntities(g.title_jpn || ''),
        category: g.category || '',
        rating: Number(g.rating || 0),
        posted: Number(g.posted || 0),
        filecount: Number(g.filecount || 0),
        filesize: Number(g.filesize || 0),
        tags: Array.isArray(g.tags) ? g.tags.slice() : [],
        thumb: g.thumb || '',
        uploader: g.uploader || '',
      })
    }
    // 每批之间停一下，别把站点打急
    if (i + CHUNK < list.length) await sleep(1200)
  }
  return out
}

/**
 * 拉收藏页（需要 cookie）。返回该页条目、下一页地址与是否还有下一页。
 *
 * 收藏页是**游标**翻页：`favorites.php?next=<最后一本的 gid>-<时间戳>`，
 * 猜不出来，只能从页面的 <a id="unext"> 里抓。传 `?page=N` 站点根本不认
 * （实测 page 0/1/2 返回同一份 HTML），以前就是栽在这。
 *
 * @param {number} page 0 起，仅用于记日志/兼容旧调用
 * @param {string} nextUrl 上一页解析出的下一页地址，空则取第一页
 */
export async function favoritesPage(cfg, page = 0, nextUrl = '') {
  const { base, headers, proxy } = buildCtx(cfg)
  if (!headers.Cookie) {
    throw new Error('收藏页需要登录 cookie：请在插件设置里填 ExHentai 三个 cookie（或 E-Hentai 的 Cookie 串）')
  }
  // 收藏夹编号：默认「Favorites 0」；设成 all 可以一次同步所有收藏夹。
  // 注意 favorites.php 不带参数时站点回的是同一份索引，显式带上 favcat 更稳。
  const cat = String((cfg && cfg.ehFavCat) || '0')
  const url = nextUrl
    ? absUrl(base, nextUrl)
    : `${base}/favorites.php?favcat=${encodeURIComponent(cat)}`
  const r = await getTextFollow(url, { headers, proxy, timeoutMs: 45000 })
  assertNotBanned(r.text)
  if (r.status !== 200) throw new Error(`收藏页 HTTP ${r.status}`)
  if (/You are viewing an offline|Please log in|Login to continue/i.test(r.text) && !/favorites\.php/.test(r.text)) {
    throw new Error('未登录或 cookie 失效：请重新填写 cookie')
  }
  return { ...parseListPage(r.text), url: r.url, page }
}

/** 画廊详情页链接 */
export function galleryUrl(gid, token) {
  return `${EH}/g/${gid}/${token}/`
}
