/**
 * JM 检索与推荐：打分、过滤、任务派发。
 *
 * 思路：
 *   候选由 jm_explore.py 抓（带详情缓存），这里只做本地打分排序，
 *   所以同一批候选第二次起几乎是瞬时的。
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { dataDir } from './store.js'
import { isIgnoredTag, readJm, readDownloads, jmStats } from './jm.js'

export function exploreScript() {
  return join(dataDir(), 'jm_explore.py')
}
export function exploreResultPath() {
  return join(dataDir(), 'jm_explore_result.json')
}

export function readExploreResult() {
  try {
    return JSON.parse(readFileSync(exploreResultPath(), 'utf8'))
  } catch {
    return null
  }
}

/** AI 作画标记（AI 翻译不算） */
const AI_TAGS = ['ai生成', 'ai繪圖', 'ai绘图', 'ai作画', 'ai作品', 'ai-generated', 'aiart', 'ai繪']
const AI_TRANS = /ai漢化|ai汉化|ai翻譯|ai翻译|gemini|gpt|機翻|机翻|deepseek|claude|sakura/i

export function isAiArt(tags) {
  for (const raw of tags || []) {
    const s = String(raw || '').toLowerCase().trim()
    if (!s) continue
    if (AI_TRANS.test(s)) continue
    if (AI_TAGS.some((w) => s.includes(w))) return true
  }
  return false
}

/** 建一份打分上下文（偏好权重、画师、已收藏、已下载） */
export function buildContext() {
  const jm = readJm()
  const st = jmStats(jm.items)
  const tagWeight = new Map(st.tags.map((t) => [t.tag, t.count]))
  const maxTagWeight = st.tags.length ? st.tags[0].count : 1
  const authorCount = new Map(st.authors.map((a) => [a.author, a.count]))
  const favIds = new Set((jm.items || []).map((x) => String(x.id)))
  const dlIds = new Set(Object.keys(readDownloads() || {}))
  return { tagWeight, maxTagWeight, authorCount, favIds, dlIds }
}

/** 单本打分；skip 表示直接淘汰 */
export function scoreAlbum(it, ctx, opts = {}) {
  const { maxTagWeight = 1, tagWeight, authorCount, favIds, dlIds } = ctx
  const tags = (it.tags || []).map((t) => String(t))
  const lower = tags.map((t) => t.toLowerCase())

  if (lower.some((t) => t === '非h' || t === 'non-h' || t === 'nonh')) return { skip: '非 H' }
  if (opts.noAi !== false && isAiArt(tags)) return { skip: 'AI 作画' }
  if (opts.minPages && (it.pages || 0) < opts.minPages) return { skip: '页数不足' }
  if (lower.some((t) => /^(試看|预览|預覽)$/.test(t))) return { skip: '试看' }

  const reasons = []
  let score = 0

  // 1) 词条匹配
  const hits = []
  let tagScore = 0
  for (const t of tags) {
    if (isIgnoredTag(t)) continue
    const w = tagWeight.get(t) || 0
    if (w > 0) {
      tagScore += w / maxTagWeight
      hits.push(t)
    }
  }
  score += tagScore * 45
  if (hits.length) reasons.push('命中 ' + hits.slice(0, 4).join('/'))

  // 2) 画师熟悉度
  const ac = authorCount.get(it.author) || 0
  if (ac > 0) {
    score += Math.min(ac, 8) * 3.5
    reasons.push('收藏过这位 ' + ac + ' 本')
  }

  // 3) 热度
  const likes = Number(it.likes || 0)
  score += Math.min(Math.log10(likes + 1) * 5, 16)
  if (likes >= 800) reasons.push('点赞 ' + likes)

  // 4) 篇幅适中加分
  const pg = Number(it.pages || 0)
  if (pg >= 20 && pg <= 120) score += 4

  // 5) 已收藏 / 已下载
  if (favIds.has(String(it.id))) reasons.push('已收藏')
  if (dlIds.has(String(it.id))) reasons.push('已下载')

  return { score: Math.round(score * 10) / 10, reasons, hits }
}

/** 对结果集打分排序 */
export function rankItems(items, opts = {}) {
  const ctx = buildContext()
  const out = []
  const skipped = []
  for (const it of items || []) {
    const r = scoreAlbum(it, ctx, opts)
    if (r.skip) {
      skipped.push(it.id)
      continue
    }
    out.push({ ...it, score: r.score, reasons: r.reasons })
  }
  out.sort((a, b) => b.score - a.score)
  return { items: out, skipped }
}

let exploreJob = null

export function exploreStatus() {
  if (!exploreJob) return { status: 'idle' }
  return {
    status: exploreJob.status,
    startedAt: exploreJob.startedAt,
    ok: exploreJob.ok,
    log: (exploreJob.log || '').slice(-500),
  }
}

/** 启动一次检索（后台跑，前端轮询） */
export function startExplore(cfg = {}, opts = {}) {
  if (exploreJob && exploreJob.status === 'running') {
    return { ok: false, msg: '上一次检索还在跑' }
  }
  const query = String(opts.query || '').trim()
  if (!query) return { ok: false, msg: '请填写关键词或 tag' }

  const pages = Math.max(1, Math.min(10, Number(opts.pages || 3)))
  const maxDetail = Math.max(0, Math.min(300, Number(opts.maxDetail || 60)))
  const gap = Math.max(0.15, Math.min(5, Number(opts.gap || (cfg.jm && cfg.jm.gap) || 0.35)))
  const mode = opts.mode === 'author' ? 'author' : 'site'

  const { cmd, args } = process.platform === 'win32'
    ? { cmd: 'py', args: ['-3.13'] }
    : { cmd: 'python3', args: [] }

  exploreJob = { status: 'running', startedAt: Date.now(), ok: null, log: '' }
  let child
  try {
    child = spawn(cmd, [...args, exploreScript(), query, String(pages), String(maxDetail), String(gap), mode], {
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      env: {
        ...process.env,
        JM_USER: (cfg.jm && cfg.jm.user) || '',
        JM_PASS: (cfg.jm && cfg.jm.pass) || '',
        JM_PROXY: 'http://' + (cfg.proxy || '127.0.0.1:7890').replace(/^https?:\/\//, ''),
        PYTHONIOENCODING: 'utf-8',
      },
    })
  } catch (e) {
    exploreJob = { status: 'error', startedAt: Date.now(), ok: false, log: e.message }
    return { ok: false, msg: '启动失败：' + e.message }
  }

  const collect = (b) => {
    exploreJob.log += b.toString('utf8')
    if (exploreJob.log.length > 8000) exploreJob.log = exploreJob.log.slice(-4000)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  child.on('error', (e) => {
    exploreJob.status = 'error'
    exploreJob.ok = false
    exploreJob.log += '\n' + e.message
  })
  child.on('close', (code) => {
    exploreJob.status = code === 0 ? 'done' : 'error'
    exploreJob.ok = code === 0
  })

  return { ok: true, msg: `已开始检索：${query}` }
}
/**
 * 质量先验 Q0：把点赞数当"有效评价数"，用同批候选的分位数当"内容分"，
 * 再做一次小样本修正：
 *     Q0 = (n × 分位 + k × 0.5) / (n + k)，n = min(likes, 50)，k = 10
 * 点赞少的不至于被两三个赞抬到满分，点赞多的会靠近真实分位。
 */
export function qPriorMap(items) {
  const likes = (items || []).map((x) => Number(x.likes || 0)).sort((a, b) => a - b)
  const total = likes.length || 1
  const pct = (v) => {
    let c = 0
    for (const x of likes) if (x <= v) c++
    return total ? c / total : 0.5
  }
  const out = new Map()
  for (const it of items || []) {
    const lk = Number(it.likes || 0)
    const n = Math.min(lk, 50)
    const p = pct(lk)
    out.set(String(it.id), Math.round(((n * p + 10 * 0.5) / (n + 10)) * 100) / 100)
  }
  return out
}
/**
 * 三种排序：
 *   latest —— 纯按发布时间倒序（缓存里没有时间就退回搜索返回顺序）
 *   hot    —— 按点赞数
 *   match  —— 按偏好拟合分（默认）
 */
export function sortItems(items, sort = 'match', order = new Map()) {
  const arr = (items || []).slice()
  if (sort === 'hot') {
    arr.sort((a, b) => (Number(b.likes) || 0) - (Number(a.likes) || 0))
  } else if (sort === 'latest') {
    arr.sort((a, b) => {
      const pa = Number(a.update) || 0
      const pb = Number(b.update) || 0
      if (pa && pb && pa !== pb) return pb - pa
      return (order.get(String(a.id)) ?? 9999) - (order.get(String(b.id)) ?? 9999)
    })
  } else {
    arr.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
  }
  return arr
}
/** 常见词的同义写法：站点标签繁简/日英不一，靠这张表兜一层 */
const SYN_GROUPS = [
  ['蘿莉', '萝莉', 'loli', 'ロリ'],
  ['校服', '制服', '學生制服', '学生制服', '水手服', 'jk'],
  ['女僕', '女仆', 'メイド', 'maid'],
  ['巨乳', '爆乳', '大胸'],
  ['百合', 'yuri', 'ゆり', '百合向'],
  ['後輩', '后辈', '後輩女子'],
  ['催眠', '催眠術', 'hypnosis'],
  ['眼鏡', '眼镜', 'メガネ'],
  ['過膝襪', '过膝袜', 'ニーソ', '过膝'],
  ['黑肉', '黑肉肌肤', '褐色'],
]

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '')

function variantsOf(word) {
  const w = norm(word)
  const out = new Set([w])
  for (const g of SYN_GROUPS) {
    if (g.some((x) => norm(x) === w)) g.forEach((x) => out.add(norm(x)))
  }
  return [...out]
}

/**
 * 查询语法：空格 = AND（都要满足），竖线 = OR（组内任一即可）。
 * 例：`萝莉|loli 校服|制服` → (萝莉 或 loli) 且 (校服 或 制服)
 */
export function queryGroups(query) {
  return String(query || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((g) => g.split('|').map((s) => s.trim()).filter(Boolean))
    .filter((g) => g.length > 0)
}

/**
 * 命中判定：tags 或标题里出现对应写法都算。
 * · 内容词（萝莉、校服）通常打在标签上
 * · 作品名（偶像大师、アイドルマスター）往往只出现在标题里，标签里根本没有
 * 所以两边都看。组内是 OR，组间是 AND。
 */
export function matchQuery(it, query) {
  const groups = queryGroups(query)
  if (!groups.length) return { ok: true, hit: 0, total: 0, missing: [] }
  const tags = (it.tags || []).map(norm)
  const title = norm(it.title)
  const author = norm(it.author)
  let hit = 0
  const missing = []
  for (const group of groups) {
    const ok = group.some((word) =>
      variantsOf(word).some((v) =>
        tags.some((tag) => tag.includes(v))
        || (title && title.includes(v))
        || (author && author.includes(v))))
    if (ok) hit++
    else missing.push(group.join('|'))
  }
  return { ok: hit === groups.length, hit, total: groups.length, missing }
}

/** 基础垃圾过滤：非 H、AI 作画 */
export function filterBasic(items) {
  return (items || []).filter((it) => {
    const lower = (it.tags || []).map((t) => String(t).toLowerCase().trim())
    if (lower.some((t) => t === '非h' || t === 'non-h' || t === 'nonh')) return false
    if (isAiArt(it.tags)) return false
    return true
  })
}
/**
 * 严格过滤，但有个兜底：
 * 如果某个词在整批候选里命中率低于 2%，说明本地标签和标题都没法校验它
 * （典型是作品名——站点用的是日文名，用户写的是中文译名）。
 * 这种情况下不拿它一票否决，而是记下来告诉调用方"这个词没校验成"。
 */
export function strictFilter(items, query) {
  const groups = queryGroups(query)
  if (!groups.length || !items.length) return { items: items || [], ignored: [] }

  const perItem = (items || []).map((it) => {
    const tags = (it.tags || []).map(norm)
    const title = norm(it.title)
    const author = norm(it.author)
    return groups.map((g) =>
      g.some((w) => variantsOf(w).some((v) =>
        tags.some((tag) => tag.includes(v))
        || (title && title.includes(v))
        || (author && author.includes(v)))))
  })

  const hitRate = groups.map((_, gi) =>
    perItem.filter((r) => r[gi]).length / perItem.length)

  const keep = groups.map((_, i) => i).filter((i) => hitRate[i] >= 0.02)
  const ignored = groups
    .map((g, i) => ({ g, i }))
    .filter((x) => hitRate[x.i] < 0.02)
    .map((x) => x.g.join('|'))

  if (!keep.length) return { items, ignored }
  const out = items.filter((_, idx) => keep.every((gi) => perItem[idx][gi]))
  return { items: out, ignored }
}
