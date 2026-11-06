/**
 * E-Hentai / ExHentai 客户端。
 *
 * 只做三件事：搜列表、gdata 批量取元数据、拉收藏页。
 * 解析一律用正则（E 站没有稳定 API 文档，DOM 会变，正则比 cheerio 更容易随手修）。
 */
import { getText, postJson } from './http.js'

export const EH = 'https://e-hentai.org'
export const EX = 'https://exhentai.org'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 站点与 cookie 组装成请求头 */
export function buildCtx(cfg) {
  const useEx = !!cfg.useExhentai
  const base = useEx ? EX : EH
  const headers = {}
  if (useEx) {
    const c = cfg.exhentaiCookies || {}
    const parts = []
    if (c.ipbMemberId) parts.push(`ipb_member_id=${c.ipbMemberId}`)
    if (c.ipbPassHash) parts.push(`ipb_pass_hash=${c.ipbPassHash}`)
    if (c.igneous) parts.push(`igneous=${c.igneous}`)
    if (parts.length) headers.Cookie = parts.join('; ')
  } else if (cfg.ehentaiCookie) {
    headers.Cookie = cfg.ehentaiCookie
  }
  return { base, headers, proxy: cfg.proxy || null }
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
 * @returns {{items: Array<{gid:string,token:string,title:string,category:string,posted:number,thumb:string,tags:string[]}>, hasNext:boolean}}
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

  const hasNext = /<a[^>]+id="unext"[^>]*>/.test(html) || /下一頁|Next/.test(html)
  return { items, hasNext }
}

/** 关键词搜索 */
export async function search(cfg, keyword, page = 0, extraQuery = '') {
  const { base, headers, proxy } = buildCtx(cfg)
  const q = extraQuery
    ? `${extraQuery}&f_search=${encodeURIComponent(keyword)}`
    : `f_search=${encodeURIComponent(keyword)}`
  const url = `${base}/?${q}&page=${page}`
  const r = await getText(url, { headers, proxy })
  if (r.status === 403) throw new Error('403：可能需要配置 cookie 或代理，或站点反爬')
  if (r.status === 509) throw new Error('509：触发带宽限制（Image Limits），稍后再试')
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`)
  const parsed = parseListPage(r.text)
  if (!parsed.items.length && /You are viewing an offline|favorites\.php|log in/i.test(r.text)) {
    throw new Error('未取得结果：可能是未登录、收藏页需 cookie，或关键词无匹配')
  }
  return parsed
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
 * 拉收藏页（需要 cookie）。返回该页条目与是否还有下一页。
 * @param {number} page 0 起
 */
export async function favoritesPage(cfg, page = 0) {
  const { base, headers, proxy } = buildCtx(cfg)
  if (!headers.Cookie) {
    throw new Error('收藏页需要登录 cookie：请在插件设置里填 ExHentai 三个 cookie（或 E-Hentai 的 Cookie 串）')
  }
  const url = `${base}/favorites.php?page=${page}`
  const r = await getText(url, { headers, proxy })
  if (r.status !== 200) throw new Error(`收藏页 HTTP ${r.status}`)
  if (/You are viewing an offline|Please log in|Login to continue/i.test(r.text) && !/favorites\.php/.test(r.text)) {
    throw new Error('未登录或 cookie 失效：请重新填写 cookie')
  }
  return parseListPage(r.text)
}

/** 画廊详情页链接 */
export function galleryUrl(gid, token) {
  return `${EH}/g/${gid}/${token}/`
}
