/**
 * E 站画廊下载（表站版）。
 *
 * 只解析画廊页当前这一屏的 /s/ 链接，逐页取图落盘（超过一屏的用 ?p=N 收集）。
 *
 * 取图的几个要点，都是踩出来的：
 *   · 图片页里的 <img id="img"> 多数是 xres=1280 的显示版；原图在页面里的
 *     <a href=".../fullimg/<gid>/<page>/<showkey>/0.png">，请求它会 302 到 hath.network
 *     的 om/ 路径，那才是原始文件。有 fullimg 就走它，没有说明 <img> 本身就是原图。
 *   · 少数 hath 节点带非标端口，TLS 握手直接被掐，重试同一个地址没用。站点自己的
 *     做法是给图片页加 ?nl=<id> 让服务器重新分配节点（页面上 <a id="loadfail" onclick="nl('...')">）。
 *   · 文件名按页序编号（不是按成功顺序），中间有页失败也不会整本错位；重跑只补缺页。
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getText, requestFollow } from './http.js'
import { cookieOf } from './eh.js'
import { dataDir } from './store.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const jobs = new Map()

export function ehJob(url) {
  const j = jobs.get(String(url))
  if (!j) return null
  return {
    status: j.status,
    done: j.done,
    total: j.total,
    dir: j.dir,
    msg: j.msg,
    failedPages: j.failedPages ? j.failedPages.slice() : [],
    degraded: j.degraded || 0,
  }
}

export function isEhDownloading(url) {
  const j = jobs.get(String(url))
  return !!(j && j.status === 'running')
}

/** 按 content-type 定扩展名（hath 的 URL 末尾不一定可靠），兜底看后缀 */
function imgExtOf(url, headers) {
  const ct = String((headers && headers['content-type']) || '').toLowerCase()
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('png')) return 'png'
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg'
  if (ct.includes('gif')) return 'gif'
  if (ct.includes('avif')) return 'avif'
  if (ct.includes('bmp')) return 'bmp'
  const m = /\.(webp|png|jpe?g|gif|avif|bmp)(?:[?#]|$)/i.exec(String(url || ''))
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg'
}

/**
 * 取一张图。每次重试都从**原始地址**重新开始（不要接着上次 302 的 hath 地址重试，
 * 那个地址的 token 是一次性的，续着重试只会连错三次）。
 * requestFollow 负责跟 302，并在跨源时自动摘掉 Cookie。
 */
async function fetchImg(cfg, url, headers, referer) {
  let last = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await requestFollow(url, {
        proxy: cfg.proxy,
        headers: { ...headers, Referer: referer },
        timeoutMs: 90000,
        maxHops: 3,
      })
      if (r.status !== 200) throw new Error('HTTP ' + r.status)
      // fullimg 在未登录时会 302 到 bounce_login.php，回的是一页 HTML（一千多字节），
      // 光看大小会把它当图片写进去，所以必须认 content-type。
      const ct = String((r.headers && r.headers['content-type']) || '').toLowerCase()
      const looksImage = ct.startsWith('image/') || ct.includes('octet-stream') || ct === ''
      if (!looksImage) {
        throw new Error('返回的不是图片（' + ct + '），可能是没登录或节点给的错误页')
      }
      if (!r.body || r.body.length <= 1000) {
        throw new Error('拿到的文件太小（' + (r.body ? r.body.length : 0) + ' 字节）')
      }
      return { url: r.url, headers: r.headers, body: r.body }
    } catch (e) {
      last = e
      await sleep(1500 * (attempt + 1))
    }
  }
  throw last || new Error('下载失败')
}

/** 画廊地址判定：表站与里站都收（两个站点页面同构，只差域名） */
export function isEhGalleryUrl(url) {
  return /^https:\/\/(?:e-hentai|exhentai)\.org\/g\//.test(String(url || ''))
}

export function startEhDownload(cfg, url, outDir, maxPages) {
  const key = String(url || '')
  // 只认 e-hentai.org 时，里站用户点下载会直接得到「不是有效的画廊地址」，看着就像没反应
  if (!isEhGalleryUrl(key)) {
    return { ok: false, msg: '不是有效的画廊地址（要 https://e-hentai.org/g/… 或 https://exhentai.org/g/…）' }
  }
  if (isEhDownloading(key)) return { ok: false, msg: '这本正在下载' }

  const rec = { status: 'running', done: 0, total: 0, dir: '', msg: '', failedPages: [], degraded: 0 }
  jobs.set(key, rec)

  ;(async () => {
    const ck = cookieOf(cfg)
    const headers = ck ? { Cookie: ck } : {}
    // 原图走 fullimg，而 fullimg 需要登录态（未登录会 302 到 bounce_login.php），
    // 所以没 cookie 时直接取显示版，省一次必然失败的请求。
    // 设置里 ehOriginal=false 也可以强制只取显示版（省流量）。
    const wantOriginal = cfg.ehOriginal !== false && !!ck
    try {
      const g = await getText(key, { proxy: cfg.proxy, headers })
      if (g.status !== 200) throw new Error('画廊页 HTTP ' + g.status)

      const t = /<h1 id="gn">([^<]+)<\/h1>/.exec(g.text)
      const rawTitle = t ? t[1] : 'eh_' + Date.now()
      const title = rawTitle
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/^[.\s]+|[.\s]+$/g, '')
        .slice(0, 80) || ('eh_' + Date.now())

      // 分页：画廊页每屏 20 张，用 ?p=N 翻页；先读总数再逐页收集
      const tryGet = async (fn, times) => {
        let last = null
        for (let i = 0; i < times; i++) {
          try { return await fn() } catch (e) { last = e; await sleep(1200) }
        }
        throw last || new Error('failed')
      }
      const linkSet = new Set()
      const collect = (html) => {
        // 表站与里站的图片页地址只差域名，两个都要认
        for (const mm of html.matchAll(/href="(https:\/\/(?:e-hentai|exhentai)\.org\/s\/[^"]+)"/g)) {
          linkSet.add(mm[1])
        }
      }
      collect(g.text)

      const totalM = /Showing\s+\d+\s*-\s*\d+\s+of\s+([\d,]+)\s+images/i.exec(g.text)
      const totalPages = totalM ? Number(totalM[1].replace(/,/g, '')) : 0
      const perPage = 20
      const pageCount = totalPages ? Math.ceil(totalPages / perPage) : 1
      rec.total = totalPages || linkSet.size

      const baseUrl = key.split('?')[0]
      for (let pi = 1; pi < pageCount; pi++) {
        try {
          const pg = await tryGet(
            () => getText(baseUrl + '?p=' + pi, { proxy: cfg.proxy, headers, timeoutMs: 45000 }), 3)
          collect(pg.text)
        } catch (e) {
          rec.msg = '第 ' + (pi + 1) + ' 屏取失败：' + e.message
        }
        await sleep(900)
      }

      const uniq = [...linkSet]
      if (!uniq.length) throw new Error('没找到图片页链接')
      rec.total = uniq.length
      const dir = join(outDir, title)
      mkdirSync(dir, { recursive: true })
      rec.dir = dir

      const limit = Number(maxPages) > 0 ? Math.min(Number(maxPages), uniq.length) : uniq.length
      const queue = uniq.slice(0, limit)
      rec.total = queue.length

      for (let qi = 0; qi < queue.length; qi++) {
        const sUrl = queue[qi]
        // 文件名按页序走（不是按成功顺序），这样中间有页失败也不会整体错位
        const seq = String(qi + 1).padStart(3, '0')

        // 断点续传：已经有这一页且不是半截文件就跳过，重跑只补缺的
        try {
          const hit = readdirSync(dir).find(
            (f) => f.startsWith(seq + '.') && statSync(join(dir, f)).size > 1024
          )
          if (hit) { rec.done++; continue }
        } catch {
          /* 目录刚建，读不到就正常往下走 */
        }

        let cur = sUrl
        let got = null
        let lastErr = ''
        for (let round = 0; round < 3 && !got; round++) {
          let fullUrl = null
          let dispUrl = null
          let nlId = ''
          try {
            const pg = await tryGet(
              () => getText(cur, { proxy: cfg.proxy, headers, timeoutMs: 45000 }), 3)
            // 原图优先：有 fullimg 链接就走它（302 到 hath 的 om/ 原始文件）；
            // 没有 fullimg 的页面，<img id="img"> 本身就是 xres=org，直接用。
            const fullM = /href="(https:\/\/(?:e-hentai|exhentai)\.org\/fullimg\/[^"]+)"/.exec(pg.text)
            const imgM = /id="img"[^>]*src="([^"]+)"/.exec(pg.text)
            fullUrl = fullM ? fullM[1].replace(/&amp;/g, '&') : null
            dispUrl = imgM ? imgM[1].replace(/&amp;/g, '&') : null
            nlId = (/nl\('([^']+)'\)/.exec(pg.text) || [])[1] || ''
            if (!fullUrl && !dispUrl) { lastErr = '页面里没有图片地址'; break }
          } catch (e) {
            lastErr = '取图页失败：' + e.message
            break
          }

          const tries = []
          if (wantOriginal && fullUrl) tries.push([fullUrl, '原图'])
          if (dispUrl && dispUrl !== fullUrl) tries.push([dispUrl, '显示版'])
          if (!tries.length && fullUrl) tries.push([fullUrl, '原图'])
          for (const [u, tag] of tries) {
            try {
              got = await fetchImg(cfg, u, headers, cur)
              got.kind = tag
              break
            } catch (e) {
              lastErr = tag + '失败：' + e.message
            }
          }
          // 拿不到就让站点换个 hath 节点（?nl=<id>），最多换三轮
          if (got || !nlId) break
          cur = sUrl + (sUrl.includes('?') ? '&' : '?') + 'nl=' + nlId
          await sleep(1500)
        }

        if (got) {
          rec.done++
          const ext = imgExtOf(got.url, got.headers)
          writeFileSync(join(dir, seq + '.' + ext), got.body)
          if (got.kind === '显示版') rec.degraded++
        } else {
          // 失败也占住页序，UI 上能看出是第几页缺
          rec.failedPages.push(qi + 1)
          rec.msg = '第 ' + (qi + 1) + ' 页没下下来：' + lastErr
        }
        await sleep(1200)
      }

      const gidM = /\/g\/(\d+)\//.exec(key)
      if (rec.done > 0 && gidM) recordDir(gidM[1], dir, rec.done)
      rec.status = rec.done > 0 ? 'done' : 'error'
      if (rec.failedPages.length) {
        rec.msg =
          '缺 ' + rec.failedPages.length + ' 页（第 ' + rec.failedPages.join('、') + ' 页），' +
          '多半是 hath 那几页的节点不通，可以去网页手动补；重跑只补缺页。' +
          (rec.msg ? ' 最后一次错误：' + rec.msg : '')
      } else if (rec.degraded > 0) {
        rec.msg =
          '有 ' + rec.degraded + ' 页只拿到显示版（xres=1280）' +
          (ck ? '，原图那条路失败了。' : '：没配 cookie 时 fullimg 原图接口会跳登录页，填上 cookie 才能取原图。')
      }
      if (!rec.done) rec.msg = '一张都没下下来：' + (rec.msg || '未知原因')
    } catch (e) {
      rec.status = 'error'
      rec.msg = e.message
    }
  })()

  return { ok: true, msg: '已开始下载，落盘到 ' + outDir }
}
// ── gid → 本地目录索引，取消收藏时按它删文件 ──

function indexPath() {
  return join(dataDir(), 'eh_downloads.json')
}

export function readEhDownloads() {
  try {
    const d = JSON.parse(readFileSync(indexPath(), 'utf8'))
    return d && typeof d === 'object' ? d : {}
  } catch {
    return {}
  }
}

function recordDir(gid, dir, pages) {
  const all = readEhDownloads()
  all[String(gid)] = { dir, pages, at: Date.now() }
  try {
    writeFileSync(indexPath(), JSON.stringify(all, null, 1), 'utf8')
  } catch {
    /* 记不上不影响下载 */
  }
}

export function ehDownloadOf(gid) {
  const all = readEhDownloads()
  return all[String(gid)] || null
}

/** 删除某本的本地文件（取消收藏时用） */
export function deleteEhDownload(gid) {
  const rec = ehDownloadOf(gid)
  if (!rec || !rec.dir) return { ok: false, msg: '没有本地文件记录' }
  // 只删 eh_site 下的一层子目录，记录被改坏也不会误删别处
  const parts = String(rec.dir).split(/[\\/]/).filter(Boolean)
  const base = parts[parts.length - 1] || ''
  const parent = parts[parts.length - 2] || ''
  if (parent.toLowerCase() !== 'eh_site' || !base || base === '..' || base === '.') {
    return { ok: false, msg: '目录不在 eh_site 下，拒绝删除' }
  }
  try {
    if (existsSync(rec.dir)) rmSync(rec.dir, { recursive: true, force: true })
    const all = readEhDownloads()
    delete all[String(gid)]
    writeFileSync(indexPath(), JSON.stringify(all, null, 1), 'utf8')
    return { ok: true, msg: '本地文件已删除' }
  } catch (e) {
    return { ok: false, msg: '删除失败：' + e.message }
  }
}
