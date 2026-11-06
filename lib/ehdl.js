/**
 * E 站画廊下载（表站版）。
 *
 * 只解析画廊页当前这一屏的 /s/ 链接（最多 40 张），逐页取原图落盘。
 * 遇到分页超过 40 张的画廊需要点「Show all」，这里暂不处理。
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { request, getText } from './http.js'
import { dataDir } from './store.js'

function cookieOf(cfg) {
  const ck = (cfg && cfg.exhentaiCookies) || {}
  const parts = []
  if (ck.ipbMemberId) parts.push('ipb_member_id=' + ck.ipbMemberId)
  if (ck.ipbPassHash) parts.push('ipb_pass_hash=' + ck.ipbPassHash)
  if (ck.igneous) parts.push('igneous=' + ck.igneous)
  return parts.join('; ')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const jobs = new Map()

export function ehJob(url) {
  const j = jobs.get(String(url))
  return j ? { status: j.status, done: j.done, total: j.total, dir: j.dir, msg: j.msg } : null
}

export function isEhDownloading(url) {
  const j = jobs.get(String(url))
  return !!(j && j.status === 'running')
}

export function startEhDownload(cfg, url, outDir, maxPages) {
  const key = String(url || '')
  if (!/^https:\/\/e-hentai\.org\/g\//.test(key)) return { ok: false, msg: '不是有效的画廊地址' }
  if (isEhDownloading(key)) return { ok: false, msg: '这本正在下载' }

  const rec = { status: 'running', done: 0, total: 0, dir: '', msg: '' }
  jobs.set(key, rec)

  ;(async () => {
    const headers = { Cookie: cookieOf(cfg) }
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
        for (const mm of html.matchAll(/href="(https:\/\/e-hentai\.org\/s\/[^"]+)"/g)) {
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

      for (const sUrl of queue) {
        let imgUrl = null
        try {
          const pg = await tryGet(
            () => getText(sUrl, { proxy: cfg.proxy, headers, timeoutMs: 45000 }), 3)
          const imgM = /id="img"[^>]*src="([^"]+)"/.exec(pg.text)
          if (!imgM) { rec.msg = '有页面取不到原图，已跳过'; continue }
          imgUrl = imgM[1]
        } catch (e) {
          rec.msg = '取图页失败：' + e.message
          continue
        }

        try {
          const r = await tryGet(() => request(imgUrl, {
            proxy: cfg.proxy,
            headers: { ...headers, Referer: sUrl },
            timeoutMs: 60000,
          }), 3)
          if (r.status === 200 && r.body && r.body.length > 1000) {
            rec.done++
            const ext = (imgUrl.split('?')[0].split('.').pop() || 'jpg').toLowerCase()
            writeFileSync(join(dir, String(rec.done).padStart(3, '0') + '.' + ext), r.body)
          }
        } catch (e) {
          rec.msg = '取图失败：' + e.message
        }
        await sleep(1200)
      }
      const gidM = /\/g\/(\d+)\//.exec(key)
      if (rec.done > 0 && gidM) recordDir(gidM[1], dir, rec.done)
      rec.status = rec.done > 0 ? 'done' : 'error'
      if (!rec.done) rec.msg = '一张都没下下来'
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
