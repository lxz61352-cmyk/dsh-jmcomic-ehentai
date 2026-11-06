/**
 * JM（禁漫）收藏数据、下载队列与本地播放支持。
 *
 * · 数据：jm_fetch.py 生成的 jm.json
 * · 下载：单本排队串行，一次只跑一本，每页之间按 gap 秒限速
 * · 落盘：优先非 C 盘根目录下的 jm/eh
 * · 记录：jm_downloads.json 保存 id → 实际目录，供本地播放器取图
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync, statSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { dataDir } from './store.js'

export const JM_DOMAIN = 'www.cdnhjk.net'
const IMAGE_EXT = /\.(webp|jpe?g|png|gif|avif|bmp)$/i

export function jmDataPath() {
  return join(dataDir(), 'jm.json')
}
export function jmFetchScript() {
  return join(dataDir(), 'jm_fetch.py')
}
export function jmDownloadScript() {
  return join(dataDir(), 'jm_download_one.py')
}

export function jmFavScript() {
  return join(dataDir(), 'jm_fav.py')
}
export function jmDownloadsPath() {
  return join(dataDir(), 'jm_downloads.json')
}

export function readJm() {
  try {
    const d = JSON.parse(readFileSync(jmDataPath(), 'utf8'))
    const items = Array.isArray(d.items) ? d.items : []
    return {
      updatedAt: Number(d.updatedAt) || 0,
      domain: d.domain || JM_DOMAIN,
      count: items.length,
      items,
    }
  } catch {
    return { updatedAt: 0, domain: JM_DOMAIN, count: 0, items: [] }
  }
}

export function readDownloads() {
  try {
    const d = JSON.parse(readFileSync(jmDownloadsPath(), 'utf8'))
    return d && typeof d === 'object' ? d : {}
  } catch {
    return {}
  }
}

function saveDownloads(d) {
  try {
    mkdirSync(dataDir(), { recursive: true })
    writeFileSync(jmDownloadsPath(), JSON.stringify(d, null, 1), 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * 下载根目录。
 * 优先选已经有内容的 <盘>:\jm\eh（避免插了新盘之后旧文件找不到），
 * 其次第一个存在的非 C 盘，最后退回 C 盘。
 */
export function jmRoot() {
  // 1) 已有下载记录的盘优先，保证与 jm_downloads.json 指向同一处
  try {
    const all = readDownloads()
    for (const k of Object.keys(all)) {
      const d = all[k] && all[k].dir
      const m = d && /^([a-z]:)[\\/]jm[\\/]eh/i.exec(d)
      if (m) return join(m[1] + '\\', 'jm', 'eh')
    }
  } catch {
    /* 忽略 */
  }

  // 2) 退而求其次：找已经有内容的盘
  const candidates = []
  for (const ch of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = ch + ':\\'
    try {
      if (existsSync(root)) candidates.push(join(root, 'jm', 'eh'))
    } catch {
      /* 探测失败就跳过 */
    }
  }
  for (const p of candidates) {
    try {
      if (existsSync(p) && readdirSync(p).length > 0) return p
    } catch {
      /* 忽略 */
    }
  }
  if (candidates.length) return candidates[0]
  return join('C:\\', 'jm', 'eh')
}

function pythonCmd() {
  return process.platform === 'win32'
    ? { cmd: 'py', args: ['-3.13'] }
    : { cmd: 'python3', args: [] }
}

/** 运行中/已完成的任务：id -> { status, startedAt, ok, log } */
const jobs = new Map()
let current = null
const queue = []

export function jmJob(id) {
  const j = jobs.get(String(id))
  const running = current && current.id === String(id)
  const queuedAt = queue.findIndex((q) => q.id === String(id))
  if (!j && !running && queuedAt < 0) return null
  return {
    status: running ? 'running' : j ? j.status : 'queued',
    startedAt: j ? j.startedAt : null,
    ok: j ? j.ok : null,
    queuePosition: queuedAt >= 0 ? queuedAt + 1 : 0,
    log: j ? (j.log || '').slice(-600) : '',
  }
}

export function queueState() {
  return {
    running: current ? current.id : null,
    pending: queue.map((q) => q.id),
  }
}

/** 从日志里解析出实际落盘目录 */
function parseTargetDir(log) {
  const re = /→\s*\[(.+?)[\\/][^\\/\]]+\.(?:webp|jpe?g|png|gif|avif|bmp)\]/gi
  let m
  let last = null
  while ((m = re.exec(log))) last = m[1]
  return last ? last.replace(/\//g, '\\') : null
}

function runNext() {
  const job = queue.shift()
  if (!job) {
    current = null
    return
  }
  current = job
  const { id, cfg } = job
  const rec = { status: 'running', startedAt: Date.now(), ok: null, log: '' }
  jobs.set(id, rec)

  const { cmd, args } = pythonCmd()
  const proxy = cfg.proxy || '127.0.0.1:7890'
  const gap = Number(cfg.jm && cfg.jm.gap) || 0.8
  
  let child
  try {
    child = spawn(cmd, [...args, jmDownloadScript(), id, jmRoot(), proxy, String(gap)], {
      windowsHide: true,
      timeout: 45 * 60 * 1000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
  } catch (e) {
    rec.status = 'error'
    rec.ok = false
    rec.log += '\n' + e.message
    current = null
    runNext()
    return
  }

  const collect = (b) => {
    rec.log += b.toString('utf8')
    if (rec.log.length > 40000) rec.log = rec.log.slice(-20000)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  child.on('error', (e) => {
    rec.status = 'error'
    rec.ok = false
    rec.log += '\nspawn error: ' + e.message
  })
  child.on('close', (code) => {
    rec.status = code === 0 ? 'done' : 'error'
    rec.ok = code === 0
    if (code === 0) {
      const dir = parseTargetDir(rec.log)
      if (dir) {
        const all = readDownloads()
        let pages = 0
        try {
          pages = readdirSync(dir).filter((f) => IMAGE_EXT.test(f)).length
        } catch {
          pages = 0
        }
        all[id] = { dir, at: Date.now(), pages }
        saveDownloads(all)
      }
    }
    current = null
    runNext()
  })
}

/** 入队下载（一次只跑一本） */
export function startDownload(id, cfg = {}) {
  const aid = String(id || '').trim()
  if (!/^\d+$/.test(aid)) return { ok: false, msg: '作品 id 不合法' }
  if (current && current.id === aid) return { ok: false, msg: '这本正在下载中', root: jmRoot() }
  if (queue.some((q) => q.id === aid)) return { ok: false, msg: '这本已经在队列里', root: jmRoot() }

  queue.push({ id: aid, cfg })
  if (!current) runNext()
  const ahead = (current ? 1 : 0) + queue.length - (current && current.id === aid ? 1 : 0)
  return {
    ok: true,
    msg: current ? `已排队，前面还有 ${ahead} 本` : '已开始下载',
    root: jmRoot(),
    id: aid,
  }
}

/** 重新抓取收藏数据 */
export function startRefresh(cfg = {}) {
  const user = (cfg.jm && cfg.jm.user) || ''
  const pass = (cfg.jm && cfg.jm.pass) || ''
  if (!user || !pass) return { ok: false, msg: '先在设置页填 JM 账号，才能刷新数据' }
  const { cmd, args } = pythonCmd()
  try {
    const child = spawn(cmd, [...args, jmFetchScript()], {
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      env: {
        ...process.env,
        JM_USER: user,
        JM_PASS: pass,
        JM_PROXY: 'http://' + (cfg.proxy || '127.0.0.1:7890').replace(/^https?:\/\//, ''),
        PYTHONIOENCODING: 'utf-8',
      },
    })
    let out = ''
    child.stdout.on('data', (b) => { out += b.toString('utf8') })
    child.stderr.on('data', (b) => { out += b.toString('utf8') })
    child.on('error', () => {})
    jobs.set('__refresh__', { status: 'running', startedAt: Date.now(), log: '' })
    child.on('close', (code) => {
      jobs.set('__refresh__', {
        status: code === 0 ? 'done' : 'error',
        startedAt: Date.now(),
        ok: code === 0,
        log: out,
      })
    })
  } catch (e) {
    return { ok: false, msg: '刷新失败：' + e.message }
  }
  return { ok: true, msg: '已开始刷新收藏数据，稍后刷新页面查看' }
}

/** 收藏 / 取消收藏（同步执行） */
export function jmFav(id, action, cfg = {}) {
  const aid = String(id || '').trim()
  const act = action === 'remove' ? 'remove' : 'add'
  if (!/^\d+$/.test(aid)) return { ok: false, msg: '作品 id 不合法' }

  const user = (cfg.jm && cfg.jm.user) || ''
  const pass = (cfg.jm && cfg.jm.pass) || ''
  if (!user || !pass) return { ok: false, msg: '先在设置里填 JM 账号' }

  const { cmd, args } = pythonCmd()
  const proxy = cfg.proxy || '127.0.0.1:7890'
  let out = ''
  try {
    const r = spawnSync(cmd, [...args, jmFavScript(), act, aid, proxy], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60000,
      env: { ...process.env, JM_USER: user, JM_PASS: pass, PYTHONIOENCODING: 'utf-8' },
    })
    out = ((r.stdout || '') + (r.stderr || '')).trim()
    if (r.status === 0 && /\bOK\b|\bREMOVED\b/.test(out)) {
      setFavOverride(aid, act === 'add')
      return { ok: true, msg: act === 'add' ? '已收藏' : '已取消收藏', favorited: act === 'add' }
    }
    return { ok: false, msg: '操作失败：' + (out.split('\n').pop() || '未知原因') }
  } catch (e) {
    return { ok: false, msg: '执行失败：' + e.message }
  }
}

/** 某本已下载的图片清单 */
export function jmImages(id) {
  const aid = String(id || '')
  const all = readDownloads()
  const rec = all[aid]
  if (!rec || !rec.dir) return { ok: false, msg: '这本还没有下载', list: [] }
  let files = []
  try {
    files = readdirSync(rec.dir).filter((f) => IMAGE_EXT.test(f)).sort()
  } catch {
    return { ok: false, msg: '目录已不存在', list: [] }
  }
  return { ok: true, dir: rec.dir, list: files, pages: files.length }
}

/** 取一页图片的绝对路径（防路径穿越：只认文件名，不认目录） */
export function jmImagePath(id, name) {
  const aid = String(id || '')
  const file = String(name || '')
  if (!/^[\w\-. ]+$/.test(file) || !IMAGE_EXT.test(file)) return null
  const all = readDownloads()
  const rec = all[aid]
  if (!rec || !rec.dir) return null
  // 只认落在某个盘的 jm\eh 之下的路径，防止记录被改成任意位置
  if (!/^[a-z]:[\\/]jm[\\/]eh[\\/]/i.test(rec.dir)) return null
  const full = join(rec.dir, file)
  return existsSync(full) ? full : null
}

/** 删除某本缓存目录 */
export function deleteCache(id) {
  const aid = String(id || '')
  const all = readDownloads()
  const rec = all[aid]
  if (!rec || !rec.dir) return { ok: false, msg: '没有这本的缓存记录' }
  try {
    rmSync(rec.dir, { recursive: true, force: true })
  } catch (e) {
    return { ok: false, msg: '删除失败：' + e.message }
  }
  delete all[aid]
  saveDownloads(all)
  return { ok: true, msg: '缓存已删除' }
}

/** 重新下载：先清缓存，再入队 */
export function redownload(id, cfg = {}) {
  const aid = String(id || '')
  const d = deleteCache(aid)
  const r = startDownload(aid, cfg)
  return { ok: r.ok, msg: (d.ok ? '缓存已清，' : '') + r.msg, root: r.root }
}

/** 语言/译本、版本、制作侧、场次类 tag —— 统计时剔除 */
const IGNORE_WORDS = [
  '中文', '中字', '中譯', '中译', '日文', '日語', '日语', '日本語', '英文', '英語', '英语',
  '韩文', '韓文', '韩语', '韓語', '漢化', '汉化', '翻譯', '翻译', '機翻', '机翻',
  '生肉', '熟肉', '雙語', '双语', 'language',
  'english', 'chinese', 'japanese', 'korean', 'spanish', 'translated',
  '無修正', '无修正', 'uncensored',
  'dl版', '數位版', '数字版', '電子版', '电子版',
  '全彩',
  '書庫', '书库', '漢化組', '汉化组', '掃圖', '扫图', '去碼', '去码',
  '紳士倉庫', '绅士仓库',
  '同人誌', '同人志', '單行本', '单行本', '雜誌', '杂志',
]

const IGNORE_RE = /^c\d{2,3}$/i

export function isIgnoredTag(tag) {
  const s = String(tag || '').toLowerCase().trim()
  if (!s) return true
  if (IGNORE_RE.test(s)) return true
  return IGNORE_WORDS.some((w) => s.includes(w))
}

export const isLangTag = isIgnoredTag

export function jmStats(items) {
  const tagMap = new Map()
  const authorMap = new Map()
  let tagTotal = 0
  let langSkipped = 0

  for (const it of items || []) {
    for (const raw of it.tags || []) {
      const key = String(raw || '').trim()
      if (!key) continue
      if (isIgnoredTag(key)) {
        langSkipped++
        continue
      }
      tagMap.set(key, (tagMap.get(key) || 0) + 1)
      tagTotal++
    }
    const a = String(it.author || '').trim()
    if (a) authorMap.set(a, (authorMap.get(a) || 0) + 1)
  }

  const tags = [...tagMap]
    .map(([tag, count]) => ({ tag, count }))
    .sort((x, y) => y.count - x.count || x.tag.localeCompare(y.tag))
  const authors = [...authorMap]
    .map(([author, count]) => ({ author, count }))
    .sort((x, y) => y.count - x.count || x.author.localeCompare(y.author))

  return {
    albums: (items || []).length,
    tagTotal,
    tagKinds: tags.length,
    langSkipped,
    authorKinds: authors.length,
    tags,
    authors,
  }
}
// ── 封面缓存：放在下载根目录下的 .covers，定期清理 ──

export function coverCacheDir() {
  return join(jmRoot(), '.covers')
}

export function coverPath(id) {
  const aid = String(id || '').replace(/[^\d]/g, '')
  if (!aid) return null
  for (const ext of ['jpg', 'webp', 'png']) {
    const p = join(coverCacheDir(), aid + '.' + ext)
    try {
      if (existsSync(p)) return { path: p, ext }
    } catch {
      /* 忽略 */
    }
  }
  return null
}

export function saveCover(id, buf) {
  const aid = String(id || '').replace(/[^\d]/g, '')
  if (!aid) return null
  const dir = coverCacheDir()
  try {
    mkdirSync(dir, { recursive: true })
    const p = join(dir, aid + '.jpg')
    writeFileSync(p, buf)
    return p
  } catch {
    return null
  }
}

export function coverStats() {
  const dir = coverCacheDir()
  try {
    const files = readdirSync(dir)
    let bytes = 0
    for (const f of files) {
      try { bytes += statSync(join(dir, f)).size } catch { /* 忽略 */ }
    }
    return { dir, count: files.length, mb: Math.round((bytes / 1048576) * 10) / 10 }
  } catch {
    return { dir, count: 0, mb: 0 }
  }
}

/** 清理超过 days 天的封面缓存；days<=0 表示全清 */
export function pruneCovers(days = 7) {
  const dir = coverCacheDir()
  if (!existsSync(dir)) return 0
  const cutoff = days > 0 ? Date.now() - days * 86400000 : Number.MAX_SAFE_INTEGER
  let n = 0
  for (const f of readdirSync(dir)) {
    try {
      const st = statSync(join(dir, f))
      if (days <= 0 || st.mtimeMs < cutoff) {
        rmSync(join(dir, f), { force: true })
        n++
      }
    } catch {
      /* 忽略 */
    }
  }
  return n
}
// ── 收藏状态：本地操作过的以本地为准，否则按收藏夹快照 ──

export function favOverridePath() {
  return join(dataDir(), 'jm_fav_overrides.json')
}

export function readFavOverrides() {
  try {
    const d = JSON.parse(readFileSync(favOverridePath(), 'utf8'))
    return d && typeof d === 'object' ? d : {}
  } catch {
    return {}
  }
}

export function setFavOverride(id, favorited) {
  const all = readFavOverrides()
  all[String(id)] = { v: !!favorited, at: Date.now() }
  try {
    writeFileSync(favOverridePath(), JSON.stringify(all), null, 0)
    return true
  } catch {
    return false
  }
}

/** 这本到底收没收藏 */
export function favState(id) {
  const key = String(id || '')
  const all = readFavOverrides()
  if (all[key]) return !!all[key].v
  const jm = readJm()
  return (jm.items || []).some((x) => String(x.id) === key)
}
