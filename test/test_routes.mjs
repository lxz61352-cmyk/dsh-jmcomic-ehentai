import { readFileSync } from 'node:fs'
const safeJson = (f, d) => { try { return JSON.parse(readFileSync(dataPath + f, 'utf8').replace(/^\uFEFF/, '')) } catch { return d } }
const base = new URL('../lib/', import.meta.url).href
const { registerWeb } = await import(base + 'web.js')
const EX = await import(base + 'explore.js')

const { dataDir } = await import(base + 'store.js')
const dataPath = dataDir() + '/'
const jm = safeJson('jm.json', { updatedAt: Date.now(), items: [] })
const exploreRaw = JSON.parse(readFileSync(dataPath + 'jm_explore_result.json', 'utf8'))
const downloads = safeJson('jm_downloads.json', {})

let handler = null
const ctx = {
  effect: (fn) => fn(),
  webServer: { register: (opts) => { handler = opts.handler } },
}
const settings = { proxy: '127.0.0.1:7890', openMode: 'dsh', jm: { web: '18comic.vip', user: 'x', pass: 'y', gap: 0.8 } }
const deps = {
  getSettings: () => settings,
  saveSettings: () => true,
  collectionRows: () => [],
  hasCookie: () => false,
  jmData: () => ({ updatedAt: jm.updatedAt, domain: 'www.cdnhjk.net', items: jm.items }),
  jmRootPath: () => 'D:\\jm\\eh',
  jmDownload: () => ({ ok: true, msg: 'queued', root: 'D:\\jm\\eh' }),
  jmRefresh: () => ({ ok: true, msg: 'refreshing' }),
  jmStatus: () => null,
  jmFav: () => ({ ok: true, msg: '已取消收藏' }),
  jmDownloads: () => downloads,
  jmImages: () => ({ ok: true, dir: 'D:\\jm\\eh\\x', list: [] }),
  jmImagePath: () => null,
  jmDeleteCache: () => ({ ok: true, msg: '已删除' }),
  jmRedownload: () => ({ ok: true, msg: 'redownload' }),
  coverPath: () => null,
  coverSave: () => null,
  coverStats: () => ({ dir: 'D:\\jm\\eh\\.covers', count: 0, mb: 0 }),
  pruneCovers: () => 0,
  favState: (id) => jm.items.some((x) => String(x.id) === String(id)),
  recOne: (opts) => ({ ok: true, mode: 'random', item: { id: '1198811', title: 't', tags: [], pages: 1, likes: 0, author: 'a' }, reason: 'mock' }),
  recBrief: (it) => 'mock brief',
  ehDownload: () => ({ ok: true, msg: 'mock dl' }),
  ehStatus: () => null,
  ehFavState: () => false,
  ehFav: async () => ({ ok: true, msg: 'mock fav' }),
  exploreRun: () => ({ ok: true, msg: 'started' }),
  exploreStatus: () => ({ status: 'idle' }),
  exploreResult: () => exploreRaw,
  exploreRank: EX.rankItems,
  exploreSort: EX.sortItems,
  exploreBasic: EX.filterBasic,
  exploreMatch: EX.matchQuery,
  exploreStrict: EX.strictFilter,
}
registerWeb(ctx, deps)
if (!handler) { console.log('路由未注册'); process.exit(1) }

async function call(path, method = 'GET', body) {
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v },
    end(chunk) { this.body = chunk == null ? '' : String(chunk) },
  }
  const req = {
    url: path, method,
    [Symbol.asyncIterator]: async function* () {
      if (body) yield Buffer.from(JSON.stringify(body))
    },
  }
  try { await handler(req, res) }
  catch (e) { return { statusCode: 599, body: 'THREW: ' + e.message } }
  return res
}

const cases = [
  ['/', 'GET'], ['/eh', 'GET'], ['/panel', 'GET'], ['/jm', 'GET'], ['/jm/stats', 'GET'],
  ['/explore', 'GET'], ['/explore?sort=latest&strict=1', 'GET'], ['/explore?sort=hot&strict=0', 'GET'],
  ['/player?id=1198811', 'GET'], ['/view?id=1198811', 'GET'], ['/local?id=1198811&n=x.webp', 'GET'],
  ['/cover?id=1486271', 'GET'],
  ['/recommend', 'GET'], ['/recommend/run', 'POST', { mode: 'random' }],
  ['/jm/author', 'POST', { author: 'karory' }],
  ['/eh/download', 'POST', { url: 'https://e-hentai.org/g/1/abc/' }], ['/eh/status', 'GET'],
  ['/ehview?gid=1&token=abc', 'GET'], ['/eh/fav', 'POST', { gid: '1', token: 'abc', action: 'remove' }],
  ['/explore/status', 'GET'], ['/jm/status?id=1', 'GET'], ['/jm/cover-stats', 'GET'],
  ['/explore/run', 'POST', { query: 'x' }], ['/jm/manage', 'POST', { id: '1', action: 'delcache' }],
  ['/jm/download', 'POST', { id: '1' }], ['/jm/refresh', 'POST', {}],
  ['/jm/clean-covers', 'POST', { days: 7 }], ['/panel', 'POST', { proxy: 'x' }],
]
let bad = 0
for (const [p, m, body] of cases) {
  const r = await call(p, m, body)
  const err = (typeof r.body === 'string' && r.body.includes('internal error')) || r.statusCode === 599
  if (err) bad++
  console.log(`${err ? 'FAIL' : ' ok '} ${String(r.statusCode).padEnd(3)} ${m.padEnd(4)} ${p}  len=${(r.body || '').length}`)
}
console.log(bad ? `\n${bad} 个路由出错` : '\n全部路由正常')
