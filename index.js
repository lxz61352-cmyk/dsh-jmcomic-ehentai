/**
 * dsh-ehentai — E-Hentai 检索 / 收藏分析 / 偏好推荐，独立插件。
 *
 * 设计要点：
 *   · 不依赖任何其他插件（不要求心跳、不要求 dsh-im）
 *   · 数据全在本地：<dshHome>/.dsh/dsh-ehentai/
 *   · 配置优先级：用户设置(settings.json) > patch config > 默认
 *   · 推送靠插件自己的定时器，到点把结果写进 outbox，再由 system-prompt
 *     注入一句提示，模型会主动提起——不碰别家的定时器。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'

import { search, gdata, favoritesPage, galleryUrl } from './lib/eh.js'
import {
  upsertGallery, countFavorites, buildProfile, getProfile,
  sampleFavorites, dataDir, openDb, collectionRows,
} from './lib/store.js'
import { recommend, findNew, ackNew } from './lib/recommend.js'
import { registerWeb } from './lib/web.js'
import { startExplore, exploreStatus, readExploreResult, rankItems, qPriorMap, sortItems, filterBasic, matchQuery, strictFilter } from './lib/explore.js'
import { recommendOne, brief } from './lib/rec.js'
import { startEhDownload, ehJob, deleteEhDownload } from './lib/ehdl.js'
import { setEhFavorite } from './lib/ehfav.js'
import { protect, unprotect } from './lib/secret.js'
import {
  readJm, jmRoot, startDownload, startRefresh, jmJob, jmFav,
  readDownloads, jmImages, jmImagePath, deleteCache, redownload,
  coverPath, saveCover, coverStats, pruneCovers, favState,
} from './lib/jm.js'

export const name = '@dsh-jmcomic/ehentai'
export const inject = ['tools', 'webServer']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 默认配置 */
const DEFAULTS = {
  useExhentai: false,
  exhentaiCookies: { ipbMemberId: '', ipbPassHash: '', igneous: '' },
  ehentaiCookie: '',
  proxy: '127.0.0.1:7890',
  profile: { halfLifeDays: 365, minCount: 2, topN: 60 },
  recommend: { topK: 3, pages: 2, limit: 20 },
  push: { enabled: false, intervalMinutes: 360, days: 7, maxItems: 10 },
  jm: { user: '', pass: '', web: '18comic.vip', gap: 0.8 },
  ehNoticeSeen: false,
}

function settingsPath() {
  return join(dataDir(), 'settings.json')
}

function loadSettings() {
  try {
    if (!existsSync(settingsPath())) return {}
    return JSON.parse(readFileSync(settingsPath(), 'utf8'))
  } catch {
    return {}
  }
}

function saveSettings(patch) {
  const cur = loadSettings()
  const next = { ...cur, ...patch }

  // 密码不落明文：有明文就加密成 passEnc；传空串表示「不改，保留原值」
  if (next.jm && typeof next.jm === 'object') {
    const prev = cur.jm || {}
    const merged = { ...prev, ...next.jm }
    const plain = typeof next.jm.pass === 'string' ? next.jm.pass : ''
    delete merged.pass
    if (plain) {
      const enc = protect(plain)
      if (enc) merged.passEnc = enc
      else merged.pass = plain
    } else if (prev.pass && !merged.passEnc) {
      merged.pass = prev.pass
    }
    next.jm = merged
  }

  // E 站 cookie 同样不落明文
  if (next.exhentaiCookies && typeof next.exhentaiCookies === 'object') {
    const prevCk = cur.exhentaiCookies || {}
    const mergedCk = { ...prevCk, ...next.exhentaiCookies }
    for (const k of ['ipbMemberId', 'ipbPassHash', 'igneous']) {
      const v = typeof next.exhentaiCookies[k] === 'string' ? next.exhentaiCookies[k] : ''
      delete mergedCk[k]
      if (v) {
        const enc = protect(v)
        if (enc) mergedCk[k + 'Enc'] = enc
        else mergedCk[k] = v
      } else if (prevCk[k + 'Enc']) {
        mergedCk[k + 'Enc'] = prevCk[k + 'Enc']
      } else if (prevCk[k]) {
        mergedCk[k] = prevCk[k]
      }
    }
    next.exhentaiCookies = mergedCk
  }

  try {
    mkdirSync(dataDir(), { recursive: true })
    writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

function mergeCfg(config) {
  const s = loadSettings()
  const ckMerged = {
    ...DEFAULTS.exhentaiCookies,
    ...((config || {}).exhentaiCookies || {}),
    ...(s.exhentaiCookies || {}),
  }
  for (const k of ['ipbMemberId', 'ipbPassHash', 'igneous']) {
    if (!ckMerged[k] && ckMerged[k + 'Enc']) ckMerged[k] = unprotect(ckMerged[k + 'Enc'])
    delete ckMerged[k + 'Enc']
  }

  const jmMerged = { ...DEFAULTS.jm, ...((config || {}).jm || {}), ...(s.jm || {}) }
  if (!jmMerged.pass && jmMerged.passEnc) {
    jmMerged.pass = unprotect(jmMerged.passEnc)
  }
  delete jmMerged.passEnc
  return {
    ...DEFAULTS, ...(config || {}), ...s,
    exhentaiCookies: ckMerged,
    profile: { ...DEFAULTS.profile, ...((config || {}).profile || {}), ...(s.profile || {}) },
    recommend: { ...DEFAULTS.recommend, ...((config || {}).recommend || {}), ...(s.recommend || {}) },
    push: { ...DEFAULTS.push, ...((config || {}).push || {}), ...(s.push || {}) },
    jm: jmMerged,
  }
}

const fmtDate = (sec) =>
  sec ? new Date(sec * 1000).toISOString().slice(0, 10) : '—'

function fmtItem(it, idx) {
  const lines = []
  lines.push(`${idx}. ${it.title || '(无标题)'}`)
  const meta = []
  if (it.category) meta.push(it.category)
  if (it.rating) meta.push(`评分 ${Number(it.rating).toFixed(2)}`)
  if (it.filecount) meta.push(`${it.filecount} 页`)
  if (it.posted) meta.push(fmtDate(it.posted))
  if (meta.length) lines.push('   ' + meta.join(' · '))
  if (it.matched && it.matched.length) {
    lines.push('   命中偏好：' + it.matched.slice(0, 8).join(', '))
  } else if (it.tags && it.tags.length) {
    lines.push('   tags：' + it.tags.slice(0, 8).join(', '))
  }
  lines.push('   ' + galleryUrl(it.gid, it.token))
  return lines.join('\n')
}

export function apply(ctx, config) {
  const cfg = () => mergeCfg(config)

  // ────────────────────────────────────────────────
  // 工具 1：搜索
  // ────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'ehentai_search',
    description:
      '在 E-Hentai / ExHentai 上按关键词或 tag 搜索画廊，返回标题、分类、评分、页数与链接。' +
      '支持 E-Hentai 的搜索语法：多个词用空格（AND），tag 加引号如 "female:glasses"，用 -tag 排除。' +
      '可按作品种类(category)与最低评分(minRating)过滤——这两个条件由本地筛选实现（E 站已不支持分类参数），' +
      '所以会多翻几页候选再筛，比纯搜索慢一些。',
    parameters: {
      keyword: { type: 'string', description: '搜索词或 tag 表达式' },
      page: { type: 'number', description: '页码，从 0 开始（可选，默认 0）' },
      category: {
        type: 'string',
        description:
          '作品种类，可多个用逗号分隔。可选值：Doujinshi / Manga / Artist CG / Game CG / ' +
          'Western / Non-H / Image Set / Cosplay / Misc（可选，不填则不限）',
      },
      minRating: { type: 'number', description: '最低评分 0-5（可选，例如 4 表示只要 4 分以上）' },
      maxRating: { type: 'number', description: '最高评分 0-5（可选）' },
      pages: {
        type: 'number',
        description: '候选翻几页（默认 1；用了 category 或 minRating 时会自动至少翻 2 页以保证样本量）',
      },
      detail: { type: 'boolean', description: '是否额外拉完整 tags 与评分（更慢，默认 true）' },
      limit: { type: 'number', description: '返回条数（默认 15）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a, v) => [{ type: 'text', text: v.message }],
    },
    async execute(args) {
      const keyword = String(args.keyword || '').trim()
      const c = cfg()
      const catWanted = String(args.category || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
      const minR = typeof args.minRating === 'number' ? args.minRating : null
      const maxR = typeof args.maxRating === 'number' ? args.maxRating : null
      const limit = Number(args.limit || 15)

      // 有筛选条件时多翻页，否则候选不够筛
      const needFilter = catWanted.length > 0 || minR != null || maxR != null
      const pages = Math.max(1, Number(args.pages || (needFilter ? 3 : 1)))

      if (!keyword && !needFilter) return { ok: false, message: '请给出搜索词，或至少一个筛选条件' }

      try {
        // 1) 收集候选（翻页结果会重叠，必须按 gid 去重）
        const cand = []
        const seenGid = new Set()
        let hasNext = false
        const startPage = Number(args.page || 0)
        for (let i = 0; i < pages; i++) {
          const r = await search(c, keyword, startPage + i)
          for (const it of r.items) {
            if (seenGid.has(it.gid)) continue
            seenGid.add(it.gid)
            cand.push(it)
          }
          hasNext = r.hasNext
          if (!r.hasNext) break
        }
        if (!cand.length) return { ok: true, message: `「${keyword || '(无关键词)'}」没有搜索结果` }

        // 2) 拉元数据（分类、评分都来自这里）
        const meta = await gdata(c, cand.map((x) => ({ gid: x.gid, token: x.token })))
        for (const g of meta) upsertGallery(g, 'search')

        // 3) 本地筛选
        let items = meta
        const before = items.length
        if (catWanted.length) {
          items = items.filter((g) => catWanted.includes(String(g.category || '').toLowerCase()))
        }
        if (minR != null) items = items.filter((g) => Number(g.rating || 0) >= minR)
        if (maxR != null) items = items.filter((g) => Number(g.rating || 0) <= maxR)

        if (!items.length) {
          return {
            ok: true,
            message:
              `候选 ${before} 条，没有符合条件的结果。` +
              `\n筛选条件：${catWanted.length ? '分类=' + catWanted.join('/') : '不限分类'}` +
              `${minR != null ? '，评分 ≥ ' + minR : ''}${maxR != null ? '，评分 ≤ ' + maxR : ''}` +
              `\n可以放宽条件，或把 pages 调大（当前翻 ${pages} 页）再试。`,
          }
        }

        // 4) 按评分从高到低（有评分条件时）否则保持原序
        if (minR != null || maxR != null) items = items.slice().sort((a, b) => b.rating - a.rating)
        else items = items.slice().sort((a, b) => b.posted - a.posted)

        const shown = items.slice(0, limit)
        const body = shown.map((it, i) => fmtItem(it, i + 1)).join('\n\n')
        const cond = []
        if (catWanted.length) cond.push('分类=' + catWanted.join('/'))
        if (minR != null) cond.push(`评分≥${minR}`)
        if (maxR != null) cond.push(`评分≤${maxR}`)
        const condText = cond.length ? `（${cond.join('，')}）` : ''

        return {
          ok: true,
          message:
            `「${keyword || '(无关键词)'}」${condText} 候选 ${before} 条，筛出 ${items.length} 条` +
            `${hasNext ? '（还有下一页）' : ''}\n\n${body}`,
          items: shown,
          scanned: before,
          matched: items.length,
        }
      } catch (e) {
        return { ok: false, message: '搜索失败：' + e.message }
      }
    },
  }))

  // ────────────────────────────────────────────────
  // 工具 2：同步收藏
  // ────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'ehentai_sync_favorites',
    description:
      '把当前账号在 E-Hentai / ExHentai 的收藏同步到本地数据库，供偏好分析使用。' +
      '需要先在插件设置里填好 cookie（ExHentai 需三个 cookie）。会自动翻页并拉取完整 tags。',
    parameters: {
      maxPages: { type: 'number', description: '最多同步几页收藏（每页 25 条，默认 40）' },
      resync: { type: 'boolean', description: '是否重头全量同步（默认只增量补新）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a, v) => [{ type: 'text', text: v.message }],
    },
    async execute(args) {
      const c = cfg()
      const maxPages = Math.max(1, Math.min(200, Number(args.maxPages || 40)))
      let added = 0
      let page = 0
      try {
        for (; page < maxPages; page++) {
          const r = await favoritesPage(c, page)
          if (!r.items.length) break
          const meta = await gdata(c, r.items.map((x) => ({ gid: x.gid, token: x.token })))
          for (const g of meta) {
            upsertGallery(g, 'favorite')
            added++
          }
          await sleep(1500) // 收藏页翻页也要限速
          if (!r.hasNext) break
        }
      } catch (e) {
        return {
          ok: false,
          message: `同步中断（已完成 ${page} 页，写入 ${added} 条）：${e.message}`,
        }
      }
      const total = countFavorites()
      return {
        ok: true,
        message:
          `收藏同步完成：本次处理 ${page + 1} 页、写入 ${added} 条，本地收藏共 ${total} 条。` +
          `\n下一步可以重建偏好画像（ehentai_profile action=rebuild）。`,
        added,
        total,
      }
    },
  }))

  // ────────────────────────────────────────────────
  // 工具 3：偏好画像
  // ────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'ehentai_profile',
    description:
      '基于已同步的收藏计算 tag 偏好画像（按评分与时间衰减加权），或查看现有画像。' +
      'action=view 查看，action=rebuild 重新计算，action=sample 看几条收藏样本以便核对画像是否合理。',
    parameters: {
      action: { type: 'string', description: 'view | rebuild | sample（默认 view）' },
      topN: { type: 'number', description: '画像保留多少个 tag（可选）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a, v) => [{ type: 'text', text: v.message }],
    },
    async execute(args) {
      const action = String(args.action || 'view')
      const c = cfg()

      if (action === 'sample') {
        const rows = sampleFavorites(20)
        if (!rows.length) return { ok: false, message: '本地还没有收藏数据，先跑 ehentai_sync_favorites' }
        const body = rows
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.tags || ''}`)
          .join('\n\n')
        return { ok: true, message: `最近 ${rows.length} 条收藏（核对画像用）：\n\n${body}` }
      }

      if (action === 'rebuild') {
        const p = buildProfile({
          halfLifeDays: c.profile.halfLifeDays,
          minCount: c.profile.minCount,
          topN: Number(args.topN || c.profile.topN),
        })
        if (!p.tags.length) {
          return { ok: false, message: '没有可分析的收藏数据，先同步收藏' }
        }
        const body = p.tags
          .slice(0, 30)
          .map((t, i) => `${String(i + 1).padStart(2)}. ${t.tag}  权重 ${t.weight.toFixed(1)}（${t.count} 次）`)
          .join('\n')
        return {
          ok: true,
          message: `偏好画像已重建：基于 ${p.total} 条收藏 tag 记录，保留 ${p.tags.length} 个 tag。\n\n${body}`,
          tags: p.tags,
        }
      }

      const cur = getProfile()
      if (!cur.length) {
        return { ok: false, message: '还没有偏好画像，先同步收藏再 rebuild' }
      }
      const body = cur
        .slice(0, 30)
        .map((t, i) => `${String(i + 1).padStart(2)}. ${t.tag}  权重 ${Number(t.weight).toFixed(1)}（${t.count} 次）`)
        .join('\n')
      return { ok: true, message: `当前偏好画像（${cur.length} 个 tag）：\n\n${body}`, tags: cur }
    },
  }))

  // ────────────────────────────────────────────────
  // 工具 4：按偏好推荐
  // ────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'ehentai_recommend',
    description:
      '按偏好画像搜索并推荐画廊：用画像里权重最高的几个 tag 组搜索式，' +
      '再按 tag 吻合度打分排序，已收藏过的会自动排除。',
    parameters: {
      topK: { type: 'number', description: '用几个高权重 tag 组搜索式（默认 3）' },
      pages: { type: 'number', description: '翻几页候选（默认 2）' },
      limit: { type: 'number', description: '返回条数（默认 20）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a, v) => [{ type: 'text', text: v.message }],
    },
    async execute(args) {
      const c = cfg()
      const prof = getProfile().map((t) => ({
        tag: t.tag,
        weight: t.weight,
        count: t.count,
        norm: t.weight / (getProfile()[0]?.weight || 1),
      }))
      if (!prof.length) {
        return { ok: false, message: '偏好画像为空，先同步收藏并 rebuild 画像' }
      }
      try {
        const r = await recommend(c, prof, {
          topK: Number(args.topK || c.recommend.topK),
          pages: Number(args.pages || c.recommend.pages),
          limit: Number(args.limit || c.recommend.limit),
        })
        if (!r.items.length) {
          return { ok: true, message: `按画像搜索「${r.query}」没有找到未收藏的新条目` }
        }
        const body = r.items.map((it, i) => fmtItem(it, i + 1)).join('\n\n')
        return {
          ok: true,
          message: `按画像推荐（搜索式：${r.query}），候选 ${r.scanned} 条，筛出 ${r.items.length} 条：\n\n${body}`,
          items: r.items,
        }
      } catch (e) {
        return { ok: false, message: '推荐失败：' + e.message }
      }
    },
  }))

  // ────────────────────────────────────────────────
  // 工具 5：新本检查
  // ────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'ehentai_new',
    description:
      '检查最近发布的新画廊里，有哪些符合你的偏好（按 tag 吻合度筛）。' +
      '可指定回看天数与是否标记为已推送。',
    parameters: {
      days: { type: 'number', description: '回看天数（默认 30）' },
      limit: { type: 'number', description: '返回条数（默认 20）' },
      ack: { type: 'boolean', description: '是否标记为已推送，避免下次重复（默认 false）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a, v) => [{ type: 'text', text: v.message }],
    },
    async execute(args) {
      const c = cfg()
      const cur = getProfile()
      if (!cur.length) {
        return { ok: false, message: '偏好画像为空，先同步收藏并 rebuild 画像' }
      }
      const max = cur[0].weight || 1
      const prof = cur.map((t) => ({
        tag: t.tag, weight: t.weight, count: t.count, norm: t.weight / max,
      }))
      try {
        const r = await findNew(c, prof, {
          days: Number(args.days || 30),
          topK: c.recommend.topK,
          limit: Number(args.limit || 20),
        })
        if (!r.items.length) {
          return { ok: true, message: `最近 ${r.days} 天没有符合偏好的新条目（搜索式：${r.query}）` }
        }
        const body = r.items.map((it, i) => fmtItem(it, i + 1)).join('\n\n')
        if (args.ack) ackNew(r.items.map((x) => x.gid))
        return {
          ok: true,
          message: `最近 ${r.days} 天符合偏好的新条目 ${r.items.length} 条（搜索式：${r.query}）：\n\n${body}`,
          items: r.items,
        }
      } catch (e) {
        return { ok: false, message: '检查失败：' + e.message }
      }
    },
  }))

  // ────────────────────────────────────────────────
  // ────────────────────────────────────────────────
  // 工具 6：对话里直接搜 JM（带封面）
  // ────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'jm_search',
    description:
      '在 JM（禁漫）上按题材、tag、作者或标题片段检索本子，返回标题、作者、页数、链接和封面图。' +
      'sort 支持：latest（最新）、hot（最热，按点赞）、match（最贴近已有收藏口味，默认）。' +
      '详情有本地缓存，同一批候选第二次查询几乎是瞬时的；首次会逐本抓取，需要十几到几十秒。',
    parameters: {
      query: { type: 'string', description: '要找的内容：题材 / tag / 作者 / 标题片段。空格=取交集，竖线=同义任一（如 偶像大师|アイドルマスター）。作品名务必同时给中文和日文/英文变体，否则本地校验对不上。' },
      sort: { type: 'string', description: 'latest=最新  hot=最热  match=最符合收藏口味（默认）' },
      limit: { type: 'number', description: '返回几本（默认 5）' },
      pages: { type: 'number', description: '搜索翻几页候选（默认 2）' },
      maxDetail: { type: 'number', description: '本轮最多补抓多少本详情（默认 25）' },
      minPages: { type: 'number', description: '小于多少页的过滤掉（默认 12）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a, v) => [{ type: 'text', text: v.message }],
    },
    async execute(args) {
      const c = cfg()
      const query = String(args.query || '').trim()
      if (!query) return { ok: false, message: '请说明要找什么内容' }

      const sort = ['latest', 'hot', 'match'].includes(String(args.sort)) ? String(args.sort) : 'match'
      const limit = Math.max(1, Math.min(20, Number(args.limit || 5)))
      const pages = Math.max(1, Math.min(10, Number(args.pages || 2)))
      const maxDetail = Math.max(0, Math.min(120, Number(args.maxDetail || 25)))
      const minPages = Math.max(0, Number(args.minPages || 12))
      const web = (c.jm && c.jm.web) || '18comic.vip'

      const cmdLine = process.platform === 'win32'
        ? { cmd: 'py', args: ['-3.13'] }
        : { cmd: 'python3', args: [] }

      let out = ''
      try {
        const r = spawnSync(cmdLine.cmd, [
          ...cmdLine.args,
          join(dataDir(), 'jm_explore.py'),
          query, String(pages), String(maxDetail),
          String(Math.max(0.2, Number((c.jm && c.jm.gap) || 0.35))),
        ], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 180000,
          env: {
            ...process.env,
            JM_USER: (c.jm && c.jm.user) || '',
            JM_PASS: (c.jm && c.jm.pass) || '',
            JM_PROXY: 'http://' + (c.proxy || '127.0.0.1:7890').replace(/^https?:\/\//, ''),
            PYTHONIOENCODING: 'utf-8',
          },
        })
        out = ((r.stdout || '') + (r.stderr || ''))
      } catch (e) {
        return { ok: false, message: '检索失败：' + e.message }
      }

      let raw = null
      try {
        raw = JSON.parse(readFileSync(join(dataDir(), 'jm_explore_result.json'), 'utf8'))
      } catch {
        return { ok: false, message: '检索没有产出结果：' + out.slice(-200) }
      }

      const ranked = rankItems(raw.items || [], { noAi: true, minPages })
      const qPrior = qPriorMap(ranked.items)
      let picked = ranked.items
      if (sort === 'hot') {
        picked = picked.slice().sort((a, b) => (b.likes || 0) - (a.likes || 0))
      } else if (sort === 'latest') {
        const order = new Map((raw.items || []).map((x, idx) => [String(x.id), idx]))
        picked = picked.slice().sort((a, b) => (order.get(String(a.id)) ?? 999) - (order.get(String(b.id)) ?? 999))
      }
      picked = picked.slice(0, limit)

      if (!picked.length) {
        return {
          ok: true,
          message: `「${query}」没有找到符合的条目（候选 ${raw.candidates || 0} 条，淘汰 ${(ranked.skipped || []).length} 条）。`,
          items: [],
        }
      }

      const label = sort === 'hot' ? '最热' : sort === 'latest' ? '最新' : '最贴近口味'
      const lines = [`「${query}」按${label}，找到 ${picked.length} 本：`]
      picked.forEach((it, i2) => {
        const meta = [it.author || '未知作者', (it.pages || 0) + ' 页', '点赞 ' + (it.likes || 0)]
        if (it.reasons && it.reasons.length) meta.push(it.reasons.join(' / '))
        lines.push('')
        lines.push(`${i2 + 1}. ${it.title}`)
        lines.push('   ' + meta.join(' · '))
        lines.push('   质量先验 Q0=' + (qPrior.get(String(it.id)) || 0))
        lines.push(`   ![封面](https://cdn-msp.jmapinodeudzn.net/media/albums/${it.id}.jpg)`)
        lines.push(`   https://${web}/album/${it.id}/`)
      })

      return {
        ok: true,
        message: lines.join('\n'),
        items: picked.map((x) => ({
          id: x.id, title: x.title, author: x.author, pages: x.pages,
          likes: x.likes, score: x.score, url: `https://${web}/album/${x.id}/`,
          cover: `https://cdn-msp.jmapinodeudzn.net/media/albums/${x.id}.jpg`,
        })),
        scanned: raw.candidates || 0,
      }
    },
  }))
  // ────────────────────────────────────────────────
  // 工具 7：三段裁决（相关度 / 质量 / 证据）
  // ────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'jm_rank',
    description:
      '按三段口径裁决 JM 候选：先剔除违反硬约束、相关度或质量不达标的，把证据不足的标为待核实，' +
      '再按综合分 S = wR×R + wQ×Q 排序。入参是 jm_search 的候选加上模型判断的 R / Q / 约束状态。' +
      'R、Q 由模型给（R 看是否真对得上查询意图，Q 参考质量先验 Q0 与内容证据），门槛与排序由程序执行，便于事后定位误推。',
    parameters: {
      verdicts: {
        type: 'string',
        description:
          'JSON 数组字符串，每项 {"id":"123456","R":0.9,"Q":0.8,"constraint":"ok|violated|unknown","note":"判断依据"}。' +
          'constraint 表示用户明确要求（如不要百合、只要全彩）是否被满足。',
      },
      minR: { type: 'number', description: '相关度门槛，默认 0.6' },
      minQ: { type: 'number', description: '质量门槛，默认 0.5' },
      minS: { type: 'number', description: '综合分门槛，默认 0.75' },
      wR: { type: 'number', description: '相关度权重，默认 0.65' },
      wQ: { type: 'number', description: '质量权重，默认 0.35' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a, v) => [{ type: 'text', text: v.message }],
    },
    async execute(args) {
      const c = cfg()
      const web = (c.jm && c.jm.web) || '18comic.vip'
      let list = []
      try {
        list = JSON.parse(String(args.verdicts || '[]'))
      } catch {
        return { ok: false, message: 'verdicts 不是合法 JSON 数组' }
      }
      if (!Array.isArray(list) || !list.length) return { ok: false, message: '没有可裁决的条目' }

      const minR = Number(args.minR != null ? args.minR : 0.6)
      const minQ = Number(args.minQ != null ? args.minQ : 0.5)
      const minS = Number(args.minS != null ? args.minS : 0.75)
      const wR = Number(args.wR != null ? args.wR : 0.65)
      const wQ = Number(args.wQ != null ? args.wQ : 0.35)

      let cache = {}
      try {
        cache = JSON.parse(readFileSync(join(dataDir(), 'jm_albums.json'), 'utf8'))
      } catch { /* 没缓存就只用传进来的字段 */ }
      const jm = readJm()
      const byId = new Map((jm.items || []).map((x) => [String(x.id), x]))

      const rec = []
      const unk = []
      const rej = []
      for (const v of list) {
        const id = String(v.id || '')
        const meta = cache[id] || byId.get(id) || {}
        const R = Number(v.R)
        const Q = Number(v.Q)
        const cs = String(v.constraint || 'ok')
        const base = {
          id, title: meta.title || v.title || ('JM' + id), author: meta.author || '',
          pages: meta.pages || 0, likes: meta.likes || 0, R, Q, note: v.note || '',
        }
        if (cs === 'violated') { rej.push({ ...base, why: '违反明确约束' }); continue }
        if (!Number.isFinite(R)) { unk.push({ ...base, why: '相关度未判断' }); continue }
        if (R < minR) { rej.push({ ...base, why: '相关度 ' + R + ' < ' + minR }); continue }
        if (!Number.isFinite(Q)) { unk.push({ ...base, why: '质量证据不足' }); continue }
        if (Q < minQ) { rej.push({ ...base, why: '质量 ' + Q + ' < ' + minQ }); continue }
        if (cs === 'unknown') { unk.push({ ...base, why: '关键约束无法确认' }); continue }
        const S = Math.round((wR * R + wQ * Q) * 100) / 100
        if (S < minS) { rej.push({ ...base, S, why: '综合分 ' + S + ' < ' + minS }); continue }
        rec.push({ ...base, S })
      }
      rec.sort((a, b) => b.S - a.S)

      const card = (x, withS) => {
        const meta = [x.author || '未知作者', (x.pages || 0) + ' 页', '点赞 ' + (x.likes || 0)]
        if (withS && x.S != null) meta.push('S=' + x.S)
        meta.push('R=' + x.R, 'Q=' + x.Q)
        return x.title + '\n   ' + meta.join(' · ')
          + '\n   ![封面](https://cdn-msp.jmapinodeudzn.net/media/albums/' + x.id + '.jpg)'
          + '\n   https://' + web + '/album/' + x.id + '/'
      }

      const parts = []
      parts.push('推荐 ' + rec.length + ' 本' + (rec.length ? '：' : '。'))
      if (rec.length) parts.push(rec.map((x, idx) => (idx + 1) + '. ' + card(x, true)).join('\n\n'))
      if (unk.length) {
        parts.push('\n待核实 ' + unk.length + ' 本：')
        parts.push(unk.map((x) => '· ' + x.title + '（' + x.why + '）').join('\n'))
      }
      if (rej.length) {
        parts.push('\n淘汰 ' + rej.length + ' 本：')
        parts.push(rej.map((x) => '· ' + x.title + '（' + x.why + '）').join('\n'))
      }

      return {
        ok: true,
        message: parts.join('\n'),
        recommended: rec,
        uncertain: unk,
        rejected: rej,
      }
    },
  }))
  // ────────────────────────────────────────────────
  // 工具 8：推荐一本
  // ────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'jm_recommend',
    description:
      '推荐一本 JM 本子。mode=random 从收藏夹里随机翻一本（不做质量判断）；' +
      'mode=taste 按收藏画像搜索，挑相关度与质量综合最高的新本。' +
      '返回封面、标题、作者、页数、tag、拼出来的简介和链接。',
    parameters: {
      mode: { type: 'string', description: 'random=收藏随机  taste=按喜好（默认 taste）' },
      excludeDownloaded: { type: 'boolean', description: '是否排除已下载过的（默认 false）' },
      allowRepeat: { type: 'boolean', description: '是否允许 7 天内重复推荐同一本（默认 false）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a, v) => [{ type: 'text', text: v.message }],
    },
    async execute(args) {
      const c = cfg()
      const r = recommendOne(c, {
        mode: String(args.mode || 'taste') === 'random' ? 'random' : 'taste',
        excludeDownloaded: !!args.excludeDownloaded,
        allowRepeat: !!args.allowRepeat,
      })
      if (!r.ok) return { ok: false, message: r.msg }

      const it = r.item
      const web = (c.jm && c.jm.web) || '18comic.vip'
      const port = Number(c.webPort || 43127)
      const viewUrl = 'http://127.0.0.1:' + port + '/dsh-ehentai/view?id=' + it.id
      const lines = [
        r.mode === 'random' ? '收藏夹里随机翻到这本：' : '按你的口味挑了这本：',
        '',
        it.title,
        '   ' + brief(it),
        '   ![](https://cdn-msp.jmapinodeudzn.net/media/albums/' + it.id + '.jpg)',
        '   内置页（带收藏／下载）：' + viewUrl,
        '   原网页：https://' + web + '/album/' + it.id + '/',
      ]
      if (r.reason) lines.push('', '（' + r.reason + '）')

      return {
        ok: true,
        message: lines.join('\n'),
        item: { ...it, viewUrl, url: 'https://' + web + '/album/' + it.id + '/' },
      }
    },
  }))
  // ────────────────────────────────────────────────
  // 工具 9：查一本的详情（含本地状态与图片路径）
  // ────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'jm_album',
    description:
      '查一本 JM 本子的详情：标题、作者、全部 tag、页数、点赞、是否已收藏、是否已下载，' +
      '下载过的话还会给出本地图片目录与文件清单，供逐页查看或做剧情省流。',
    parameters: {
      id: { type: 'string', description: '作品 id，例如 1198811' },
      maxFiles: { type: 'number', description: '返回多少个图片文件名（默认 12，用于抽读）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a, v) => [{ type: 'text', text: v.message }],
    },
    async execute(args) {
      const c = cfg()
      const id = String(args.id || '').replace(/[^\d]/g, '')
      if (!id) return { ok: false, message: '请给出作品 id' }
      const n = Math.max(1, Math.min(60, Number(args.maxFiles || 12)))

      let meta = {}
      try {
        meta = JSON.parse(readFileSync(join(dataDir(), 'jm_albums.json'), 'utf8'))[id] || {}
      } catch { /* 没缓存就空着 */ }
      const jm = readJm()
      const fav = (jm.items || []).find((x) => String(x.id) === id) || {}
      const item = Object.keys(meta).length ? meta : fav
      if (!item || !item.title) {
        return { ok: false, message: '本地没有 JM' + id + ' 的记录，可以先用 jm_search 把它抓一次' }
      }

      const online = favState(id)
      const imgs = jmImages(id)
      const downloaded = !!(imgs && imgs.ok && imgs.list && imgs.list.length)
      const web = (c.jm && c.jm.web) || '18comic.vip'

      const lines = [item.title, '   ' + brief(item)]
      lines.push('   tag：' + (item.tags || []).join(' / '))
      lines.push('   状态：' + (online ? '已收藏' : '未收藏') + ' · ' + (downloaded ? ('本地 ' + imgs.list.length + ' 张') : '未下载'))
      lines.push('   原网页：https://' + web + '/album/' + id + '/')
      if (downloaded) {
        lines.push('   本地目录：' + imgs.dir)
        lines.push('   图片：' + imgs.list.slice(0, n).join(', ') + (imgs.list.length > n ? ' …' : ''))
      }

      return {
        ok: true,
        message: lines.join('\n'),
        item: {
          ...item, id, favorited: online, downloaded,
          dir: downloaded ? imgs.dir : '',
          files: downloaded ? imgs.list.slice(0, n) : [],
          url: 'https://' + web + '/album/' + id + '/',
          cover: 'https://cdn-msp.jmapinodeudzn.net/media/albums/' + id + '.jpg',
        },
      }
    },
  }))

  // ────────────────────────────────────────────────
  // 工具 10：收藏 / 取消收藏
  // ────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'jm_fav',
    description: '在 JM 账号里收藏或取消收藏一本（action: add 收藏 / remove 取消）。会同步记下本地状态。',
    parameters: {
      id: { type: 'string', description: '作品 id' },
      action: { type: 'string', description: 'add=收藏  remove=取消收藏' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a, v) => [{ type: 'text', text: v.message }],
    },
    async execute(args) {
      const c = cfg()
      const id = String(args.id || '').replace(/[^\d]/g, '')
      if (!id) return { ok: false, message: '请给出作品 id' }
      const act = String(args.action || 'add') === 'remove' ? 'remove' : 'add'
      const r = jmFav(id, act, c)
      return { ok: r.ok, message: r.ok ? ('JM' + id + ' ' + r.msg) : r.msg }
    },
  }))

  // ────────────────────────────────────────────────
  // 工具 11：下载（入队，一次一本）
  // ────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'jm_download',
    description:
      '把一本 JM 本子加入下载队列，落到本地 jm/eh 目录。队列串行、一次只跑一本，图片线程 1 并带节流。',
    parameters: {
      id: { type: 'string', description: '作品 id' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a, v) => [{ type: 'text', text: v.message }],
    },
    async execute(args) {
      const c = cfg()
      const id = String(args.id || '').replace(/[^\d]/g, '')
      if (!id) return { ok: false, message: '请给出作品 id' }
      const r = startDownload(id, c)
      return { ok: r.ok, message: r.ok ? ('JM' + id + ' ' + r.msg + '，目录 ' + r.root) : r.msg }
    },
  }))
  // Web：收藏页 + 设置页 + 封面代理
  // ────────────────────────────────────────────────
  const webOk = registerWeb(ctx, {
    getSettings: () => cfg(),
    saveSettings,
    collectionRows: () => collectionRows(300),
    hasCookie: () => {
      const c = cfg()
      const ck = c.exhentaiCookies || {}
      return !!(c.ehentaiCookie || (ck.ipbMemberId && ck.ipbPassHash))
    },
    // ── JM（禁漫）──
    jmData: () => readJm(),
    jmRootPath: () => jmRoot(),
    jmDownload: (id, c) => startDownload(id, c),
    jmRefresh: (c) => startRefresh(c),
    jmStatus: (id) => jmJob(id),
    jmFav: (id, action, c) => jmFav(id, action, c),
    jmDownloads: () => readDownloads(),
    jmImages: (id) => jmImages(id),
    jmImagePath: (id, name) => jmImagePath(id, name),
    jmDeleteCache: (id) => deleteCache(id),
    jmRedownload: (id, c) => redownload(id, c),
    coverPath: (id) => coverPath(id),
    coverSave: (id, buf) => saveCover(id, buf),
    coverStats: () => coverStats(),
    pruneCovers: (days) => pruneCovers(days),
    favState: (id) => favState(id),
    recOne: (opts, c) => recommendOne(c, opts),
    recBrief: (it) => brief(it),
    ehDownload: (url, c) => startEhDownload(c, url, join(jmRoot(), '..', 'eh_site')),
    ehStatus: (url) => ehJob(url),
    ehFavState: (gid) => {
      try {
        const row = openDb().prepare('SELECT source FROM galleries WHERE gid = ?').get(String(gid))
        return !!(row && row.source === 'favorite')
      } catch {
        return false
      }
    },
    ehFav: async (gid, token, action, c) => {
      const r = await setEhFavorite(c, gid, token, action)
      if (!r.ok) return r
      try {
        openDb().prepare('UPDATE galleries SET source = ? WHERE gid = ?')
          .run(action === 'remove' ? 'search' : 'favorite', String(gid))
      } catch { /* 库里没有这条也无妨 */ }
      if (action === 'remove') {
        const d = deleteEhDownload(gid)
        if (d.ok) r.msg = r.msg + '，' + d.msg
      }
      return r
    },
    exploreRun: (opts, c) => startExplore(c, opts),
    exploreStatus: () => exploreStatus(),
    exploreResult: () => readExploreResult(),
    exploreRank: (items, opts) => rankItems(items, opts),
    exploreSort: (items, sort, order) => sortItems(items, sort, order),
    exploreBasic: (items) => filterBasic(items),
    exploreMatch: (it, query) => matchQuery(it, query),
    exploreStrict: (items, query) => strictFilter(items, query),
  })

  // ────────────────────────────────────────────────
  // 可选：插件自带的定时检查（不依赖心跳）
  // ────────────────────────────────────────────────
  const pushCfg = () => cfg().push
  let timer = null
  const outboxFile = () => join(dataDir(), 'outbox.json')

  const runPushCheck = async () => {
    const p = pushCfg()
    if (!p.enabled) return
    try {
      const cur = getProfile()
      if (!cur.length) return
      const max = cur[0].weight || 1
      const prof = cur.map((t) => ({ tag: t.tag, weight: t.weight, count: t.count, norm: t.weight / max }))
      const r = await findNew(cfg(), prof, { days: p.days, limit: p.maxItems })
      if (!r.items.length) return
      writeFileSync(
        outboxFile(),
        JSON.stringify({ at: Date.now(), query: r.query, items: r.items }, null, 2),
        'utf8'
      )
      ackNew(r.items.map((x) => x.gid))
    } catch {
      /* 静默：定时任务失败不打扰用户 */
    }
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const p = pushCfg()
      if (!p.enabled) return () => {}
      const ms = Math.max(30, Number(p.intervalMinutes || 360)) * 60 * 1000
      timer = setInterval(runPushCheck, ms)
      // 启动后先跑一次（延迟 60s，避开启动高峰）
      const first = setTimeout(runPushCheck, 60000)
      return () => {
        if (timer) clearInterval(timer)
        clearTimeout(first)
      }
    })
  }

  // 有 outbox 待推时，在系统提示里补一句，让模型主动提起
  if (typeof ctx.on === 'function') {
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const res = await next()
      try {
        if (!existsSync(outboxFile())) return res
        const box = JSON.parse(readFileSync(outboxFile(), 'utf8'))
        const ageH = (Date.now() - box.at) / 3600000
        if (ageH > 24 || !box.items?.length) return res
        const brief = box.items
          .slice(0, 5)
          .map((x, i) => `${i + 1}. ${x.title}`)
          .join('；')
        const note =
          `\n\n[E-Hentai 新收录] 有 ${box.items.length} 条符合用户偏好的新条目尚未提及：${brief}。` +
          `可以在合适时机顺口提一句；用户问起时用 ehentai_new 取详情。`
        if (typeof res === 'string') return res + note
        return res
      } catch {
        return res
      }
    })
  }
}
