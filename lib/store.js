/**
 * 本地存储（SQLite）+ 偏好画像计算。
 * 数据位置：<dshHome>/.dsh/dsh-ehentai/ehentai.db
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export function dataDir() {
  const d = join(process.env.DSH_HOME || homedir(), '.dsh', 'dsh-jmcomic-ehentai')
  mkdirSync(d, { recursive: true })
  return d
}

let _db = null
export function openDb() {
  if (_db) return _db
  const file = join(dataDir(), 'ehentai.db')
  const db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE IF NOT EXISTS galleries (
      gid        TEXT PRIMARY KEY,
      token      TEXT,
      title      TEXT,
      title_jpn  TEXT,
      category   TEXT,
      rating     REAL DEFAULT 0,
      posted     INTEGER DEFAULT 0,
      filecount  INTEGER DEFAULT 0,
      filesize   INTEGER DEFAULT 0,
      thumb      TEXT,
      uploader   TEXT,
      source     TEXT,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS gallery_tags (
      gid TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (gid, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_tags_tag ON gallery_tags(tag);
    CREATE TABLE IF NOT EXISTS profile (
      tag        TEXT PRIMARY KEY,
      weight     REAL,
      count      INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS seen_new (
      gid TEXT PRIMARY KEY,
      seen_at INTEGER
    );
  `)
  _db = db
  return db
}

/** 写入/更新一条画廊（连同 tags） */
export function upsertGallery(g, source = 'search') {
  const db = openDb()
  const now = Date.now()
  db.prepare(
    `INSERT INTO galleries (gid,token,title,title_jpn,category,rating,posted,filecount,filesize,thumb,uploader,source,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(gid) DO UPDATE SET
       token=excluded.token, title=excluded.title, title_jpn=excluded.title_jpn,
       category=excluded.category, rating=excluded.rating, posted=excluded.posted,
       filecount=excluded.filecount, filesize=excluded.filesize, thumb=excluded.thumb,
       uploader=excluded.uploader,
       source=CASE WHEN excluded.source='favorite' THEN 'favorite' ELSE galleries.source END,
       updated_at=excluded.updated_at`
  ).run(
    g.gid, g.token || '', g.title || '', g.titleJpn || '', g.category || '',
    Number(g.rating || 0), Number(g.posted || 0), Number(g.filecount || 0),
    Number(g.filesize || 0), g.thumb || '', g.uploader || '', source, now
  )
  const del = db.prepare('DELETE FROM gallery_tags WHERE gid = ?')
  del.run(g.gid)
  const ins = db.prepare('INSERT OR IGNORE INTO gallery_tags (gid, tag) VALUES (?, ?)')
  for (const t of g.tags || []) ins.run(g.gid, String(t))
  return true
}

export function countFavorites() {
  const db = openDb()
  return db.prepare("SELECT COUNT(*) AS n FROM galleries WHERE source='favorite'").get().n
}

export function knownGids() {
  const db = openDb()
  return new Set(db.prepare('SELECT gid FROM galleries').all().map((r) => r.gid))
}

/** 默认过滤掉的通用 tag：这些几乎每条都有，不代表个人喜好 */
export const DEFAULT_BLACKLIST = [
  'language:', 'category:', 'other:', 'rewrite:',
]

function isBlacklisted(tag, blacklist) {
  const t = String(tag).toLowerCase()
  return blacklist.some((p) => (p.endsWith(':') ? t.startsWith(p) : t === p))
}

/**
 * 计算偏好画像
 * 权重 = Σ over 收藏 ( rating 基准 × 时间衰减 )
 * @param {object} opt { halfLifeDays, minCount, topN, blacklist }
 */
export function buildProfile(opt = {}) {
  const {
    halfLifeDays = 365,
    minCount = 2,
    topN = 60,
    blacklist = DEFAULT_BLACKLIST,
  } = opt

  const db = openDb()
  const rows = db
    .prepare(
      `SELECT g.gid, g.rating, g.posted, t.tag
         FROM galleries g JOIN gallery_tags t ON t.gid = g.gid
        WHERE g.source='favorite'`
    )
    .all()

  if (!rows.length) {
    return { tags: [], total: 0, updatedAt: Date.now() }
  }

  // 评分基准：E 站是 1–5；未评分记 0，用所有已评分的均值补
  const rated = rows.filter((r) => r.rating > 0).map((r) => r.rating)
  const meanRating = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : 3
  const now = Date.now() / 1000
  const decay = (posted) => {
    if (!posted) return 1
    const ageDays = Math.max(0, (now - posted) / 86400)
    return Math.pow(0.5, ageDays / halfLifeDays)
  }

  const weight = new Map()
  const count = new Map()
  for (const r of rows) {
    if (isBlacklisted(r.tag, blacklist)) continue
    const base = r.rating > 0 ? r.rating : meanRating
    const w = base * decay(r.posted)
    weight.set(r.tag, (weight.get(r.tag) || 0) + w)
    count.set(r.tag, (count.get(r.tag) || 0) + 1)
  }

  let arr = [...weight.entries()]
    .map(([tag, w]) => ({ tag, weight: w, count: count.get(tag) || 0 }))
    .filter((x) => x.count >= minCount)
    .sort((a, b) => b.weight - a.weight)

  if (!arr.length) {
    // minCount 太严就退回不筛
    arr = [...weight.entries()]
      .map(([tag, w]) => ({ tag, weight: w, count: count.get(tag) || 0 }))
      .sort((a, b) => b.weight - a.weight)
  }

  const max = arr.length ? arr[0].weight : 1
  arr = arr.slice(0, topN).map((x) => ({ ...x, norm: x.weight / max }))

  // 落库
  db.exec('DELETE FROM profile')
  const ins = db.prepare('INSERT INTO profile (tag, weight, count, updated_at) VALUES (?,?,?,?)')
  const ts = Date.now()
  for (const x of arr) ins.run(x.tag, x.weight, x.count, ts)

  return { tags: arr, total: rows.length, updatedAt: ts }
}

export function getProfile() {
  const db = openDb()
  return db.prepare('SELECT tag, weight, count FROM profile ORDER BY weight DESC').all()
}

/** 收藏的标题 + tags，供人工核对画像是否合理 */
export function sampleFavorites(limit = 30) {
  const db = openDb()
  return db
    .prepare(
      `SELECT g.gid, g.title, g.rating, g.posted,
              (SELECT group_concat(tag, ', ') FROM gallery_tags WHERE gid = g.gid) AS tags
         FROM galleries g WHERE source='favorite'
        ORDER BY g.posted DESC LIMIT ?`
    )
    .all(limit)
}

/** 收藏页用：带缩略图、分类、页数与 tag 列表的完整行 */
export function collectionRows(limit = 300) {
  const db = openDb()
  return db
    .prepare(
      `SELECT g.gid, g.token, g.title, g.category, g.rating, g.posted,
              g.filecount, g.thumb,
              (SELECT group_concat(tag, ', ') FROM gallery_tags WHERE gid = g.gid) AS tags
         FROM galleries g
        WHERE g.source = 'favorite'
        ORDER BY g.posted DESC
        LIMIT ?`
    )
    .all(limit)
}

/** 收藏页用：不分来源，把所有本地条目列出来（示例数据也能看到） */
export function allGalleryRows(limit = 300) {
  const db = openDb()
  return db
    .prepare(
      `SELECT g.gid, g.token, g.title, g.category, g.rating, g.posted,
              g.filecount, g.thumb,
              (SELECT group_concat(tag, ', ') FROM gallery_tags WHERE gid = g.gid) AS tags
         FROM galleries g
        ORDER BY g.posted DESC
        LIMIT ?`
    )
    .all(limit)
}

export function markSeenNew(gids) {
  const db = openDb()
  const ins = db.prepare('INSERT OR IGNORE INTO seen_new (gid, seen_at) VALUES (?, ?)')
  const now = Date.now()
  for (const g of gids) ins.run(String(g), now)
}

export function seenNewGids() {
  const db = openDb()
  return new Set(db.prepare('SELECT gid FROM seen_new').all().map((r) => r.gid))
}
