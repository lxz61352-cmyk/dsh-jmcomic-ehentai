/**
 * 推荐引擎：拿偏好画像去搜，再按 tag 重合度打分排序。
 */
import { search, gdata } from './eh.js'
import { knownGids, seenNewGids, markSeenNew } from './store.js'

/** 用画像里权重最高的一批 tag 组搜索式（AND 关系，取交集最准） */
export function buildQuery(profileTags, { topK = 3, minNorm = 0.35 } = {}) {
  const picked = profileTags
    .filter((t) => (t.norm == null ? true : t.norm >= minNorm))
    .slice(0, topK)
    .map((t) => (t.tag.includes(':') ? `"${t.tag}"` : t.tag))
  return picked.join(' ')
}

/** 余弦式打分：偏好吻合度 / sqrt(条目自身 tag 数)，避免 tag 多的条目占便宜 */
export function scoreGallery(galleryTags, profileMap) {
  if (!galleryTags || !galleryTags.length) return 0
  let hit = 0
  let hitCount = 0
  for (const t of galleryTags) {
    const p = profileMap.get(t)
    if (p) {
      hit += p
      hitCount++
    }
  }
  if (!hitCount) return 0
  return hit / Math.sqrt(galleryTags.length)
}

/**
 * 按偏好搜索并排序
 * @param {object} cfg 插件配置
 * @param {Array} profileTags buildProfile() 的结果
 * @param {object} opt { topK, pages, limit, excludeKnown }
 */
export async function recommend(cfg, profileTags, opt = {}) {
  const { topK = 3, pages = 2, limit = 20, excludeKnown = true } = opt
  if (!profileTags.length) throw new Error('偏好画像为空：先同步收藏并重建画像')

  const query = buildQuery(profileTags, { topK })
  if (!query) throw new Error('无法从画像生成搜索式')

  const profileMap = new Map(profileTags.map((t) => [t.tag, t.norm ?? 1]))

  // 1) 搜出候选
  const cand = []
  for (let p = 0; p < pages; p++) {
    const r = await search(cfg, query, p)
    cand.push(...r.items)
    if (!r.hasNext) break
  }
  if (!cand.length) return { query, items: [] }

  // 2) gdata 补全 tags 与评分
  const meta = await gdata(cfg, cand.map((x) => ({ gid: x.gid, token: x.token })))
  const known = excludeKnown ? knownGids() : new Set()

  // 3) 打分排序
  const scored = meta
    .filter((g) => !known.has(g.gid))
    .map((g) => ({
      gid: g.gid,
      token: g.token,
      title: g.title,
      titleJpn: g.titleJpn,
      category: g.category,
      rating: g.rating,
      posted: g.posted,
      filecount: g.filecount,
      tags: g.tags,
      score: scoreGallery(g.tags, profileMap),
      matched: g.tags.filter((t) => profileMap.has(t)),
    }))
    .filter((g) => g.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return { query, items: scored, scanned: meta.length }
}

/**
 * 找「最近发布 + 符合偏好」的新本
 * @param {number} days 回看天数
 */
export async function findNew(cfg, profileTags, opt = {}) {
  const { days = 30, topK = 3, pages = 3, limit = 20 } = opt
  if (!profileTags.length) throw new Error('偏好画像为空：先同步收藏并重建画像')

  const query = buildQuery(profileTags, { topK })
  const profileMap = new Map(profileTags.map((t) => [t.tag, t.norm ?? 1]))

  const cand = []
  for (let p = 0; p < pages; p++) {
    const r = await search(cfg, query, p)
    cand.push(...r.items)
    if (!r.hasNext) break
  }
  if (!cand.length) return { query, items: [] }

  const meta = await gdata(cfg, cand.map((x) => ({ gid: x.gid, token: x.token })))
  const since = Math.floor(Date.now() / 1000) - days * 86400
  const known = knownGids()
  const seen = seenNewGids()

  const fresh = meta
    .filter((g) => g.posted >= since && !known.has(g.gid) && !seen.has(g.gid))
    .map((g) => ({
      gid: g.gid,
      token: g.token,
      title: g.title,
      category: g.category,
      rating: g.rating,
      posted: g.posted,
      filecount: g.filecount,
      tags: g.tags,
      score: scoreGallery(g.tags, profileMap),
      matched: g.tags.filter((t) => profileMap.has(t)),
    }))
    .filter((g) => g.score > 0)
    .sort((a, b) => b.posted - a.posted)
    .slice(0, limit)

  return { query, items: fresh, days }
}

/** 标记已推送，避免下次重复提醒 */
export function ackNew(gids) {
  markSeenNew(gids)
}
