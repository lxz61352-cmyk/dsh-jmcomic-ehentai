/**
 * 推荐：从收藏里随机翻一本，或按喜好挑一本相关度与质量都高的。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { dataDir } from './store.js'
import { readJm, readDownloads, jmStats } from './jm.js'
import { rankItems } from './explore.js'

export function historyPath() {
  return join(dataDir(), 'jm_recommend_history.json')
}
export function readHistory() {
  try {
    const d = JSON.parse(readFileSync(historyPath(), 'utf8'))
    return d && typeof d === 'object' ? d : {}
  } catch {
    return {}
  }
}
function markHistory(id) {
  const all = readHistory()
  all[String(id)] = Date.now()
  try {
    writeFileSync(historyPath(), JSON.stringify(all), 'utf8')
  } catch {
    /* 记不上也不影响主流程 */
  }
}
export function albumCache() {
  try {
    return JSON.parse(readFileSync(join(dataDir(), 'jm_albums.json'), 'utf8'))
  } catch {
    return {}
  }
}

const DAY = 86400000

/** 拼一句话简介：站点没有简介字段，就用作者、篇幅、题材、热度攒一句 */
export function brief(it) {
  const parts = []
  if (it.author) parts.push(it.author)
  if (it.pages) parts.push(it.pages + ' 页')
  const tags = (it.tags || []).filter((t) => t && t.length <= 8).slice(0, 4)
  if (tags.length) parts.push(tags.join(' / '))
  if (it.likes) parts.push('点赞 ' + it.likes.toLocaleString())
  return parts.join(' · ')
}

function runExplore(query, pages, maxDetail, gap, cfg) {
  const cmdLine = process.platform === 'win32'
    ? { cmd: 'py', args: ['-3.13'] }
    : { cmd: 'python3', args: [] }
  try {
    spawnSync(cmdLine.cmd, [
      ...cmdLine.args,
      join(dataDir(), 'jm_explore.py'),
      query, String(pages), String(maxDetail), String(gap),
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 180000,
      env: {
        ...process.env,
        JM_USER: (cfg.jm && cfg.jm.user) || '',
        JM_PASS: (cfg.jm && cfg.jm.pass) || '',
        JM_PROXY: 'http://' + (cfg.proxy || '127.0.0.1:7890').replace(/^https?:\/\//, ''),
        PYTHONIOENCODING: 'utf-8',
      },
    })
  } catch {
    return null
  }
  try {
    return JSON.parse(readFileSync(join(dataDir(), 'jm_explore_result.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * @param {object} cfg 插件配置
 * @param {object} opts { mode: 'random'|'taste', excludeDownloaded, allowRepeat, gap }
 */
export function recommendOne(cfg = {}, opts = {}) {
  const r = recommendMany(cfg, { ...opts, count: 1 })
  if (!r.ok) return r
  return { ok: true, mode: r.mode, item: r.items[0], reason: r.reason, scanned: r.scanned }
}

export function recommendMany(cfg = {}, opts = {}) {
  const mode = opts.mode === 'random' ? 'random' : 'taste'
  const count = Math.max(1, Math.min(15, Number(opts.count) || 1))
  const jm = readJm()
  const items = jm.items || []
  const downloads = readDownloads() || {}
  const cache = albumCache()
  const history = readHistory()
  const web = (cfg.jm && cfg.jm.web) || '18comic.vip'

  if (mode === 'random') {
    if (!items.length) return { ok: false, msg: '收藏夹是空的，先去刷新数据' }

    const shuffled = items.slice()
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = shuffled[i]
      shuffled[i] = shuffled[j]
      shuffled[j] = tmp
    }

    const picked = []
    const taken = new Set()
    const accept = (showAll) => {
      for (const x of shuffled) {
        if (picked.length >= count) return
        const key = String(x.id)
        if (taken.has(key)) continue
        if (!showAll) {
          if (opts.excludeDownloaded && downloads[key]) continue
          if (!opts.allowRepeat) {
            const h = history[key]
            if (h && Date.now() - h < 7 * DAY) continue
          }
        }
        taken.add(key)
        picked.push(x)
      }
    }
    accept(false)
    if (picked.length < count) accept(true)

    for (const p of picked) markHistory(p.id)
    return {
      ok: true,
      mode,
      items: picked.map((p) => ({ ...(cache[String(p.id)] || p), web })),
      reason: '收藏夹里随机翻到',
    }
  }

  const st = jmStats(items)
  if (!st.tags.length) return { ok: false, msg: '画像为空，先同步收藏' }
  const top = st.tags.slice(0, 2).map((t) => t.tag)
  const query = top.join(' ')
  const gap = Math.max(0.2, Number((cfg.jm && cfg.jm.gap) || 0.35))
  const raw = runExplore(query, 2, Number(opts.maxDetail || 25), gap, cfg)
  if (!raw || !raw.items || !raw.items.length) {
    return { ok: false, msg: '按「' + query + '」没搜到候选' }
  }

  const favIds = new Set(items.map((x) => String(x.id)))
  const pool = (raw.items || []).filter((x) => !favIds.has(String(x.id)))
  const ranked = rankItems(pool, { noAi: true, minPages: 20 })
  let list = ranked.items.filter((x) => {
    const key = String(x.id)
    if (opts.excludeDownloaded && downloads[key]) return false
    if (!opts.allowRepeat) {
      const h = history[key]
      if (h && Date.now() - h < 7 * DAY) return false
    }
    return (x.tags || []).length >= 4
  })
  if (list.length < count) list = ranked.items

  const picked = list.slice(0, count)
  if (!picked.length) return { ok: false, msg: '候选全被过滤掉了' }
  for (const p of picked) markHistory(p.id)

  return {
    ok: true,
    mode,
    items: picked.map((p) => ({ ...p, web })),
    reason: '按画像「' + query + '」搜索，相关度与质量综合最高',
    scanned: raw.candidates || 0,
  }
}