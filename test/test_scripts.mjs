import { readFileSync } from 'node:fs'
const safeJson = (f, d) => { try { return JSON.parse(readFileSync(dataPath + f, 'utf8').replace(/^\uFEFF/, '')) } catch { return d } }
const base = new URL('../lib/', import.meta.url).href
const W = await import(base + 'web.js')
const EX = await import(base + 'explore.js')
const { dataDir } = await import(base + 'store.js')
const dataPath = dataDir() + '/'
const jm = safeJson('jm.json', { updatedAt: Date.now(), items: [] })
const raw = safeJson('jm_explore_result.json', { query: 'test', items: [], candidates: 0 })
const downloads = safeJson('jm_downloads.json', {})
const ranked = EX.rankItems(raw.items, { noAi: true, minPages: 0 })

const pages = {
  jm: W.renderJm({ updatedAt: jm.updatedAt, items: jm.items.slice(0, 5) }, { root: 'D:\\jm\\eh', openMode: 'dsh', downloads }),
  eh: W.renderCollection([{ gid: '1', token: 'a', title: 't', category: 'M', rating: 4, filecount: 9, thumb: 'https://e/a.webp', tags: 'artist:y' }], { openMode: 'dsh' }),
  panel: W.renderPanel({}, {}),
  stats: W.renderStats(EX.jmStats ? EX.jmStats(jm.items) : { tags: [], authors: [], albums: 0, tagTotal: 0, tagKinds: 0, langSkipped: 0, authorKinds: 0 }, {}),
  explore: W.renderExplore({ raw, ranked: { items: ranked.items, skipped: [] }, query: raw.query, sort: 'match', strict: true, downloads: {}, openMode: 'dsh', webDomain: '18comic.vip' }),
  recommend: W.renderRecommend({ webDomain: '18comic.vip' }),
  player: W.renderPlayer({ id: '1', title: 't', tags: [], items: [], index: -1, images: [], dir: '', webDomain: '18comic.vip' }),
  view: W.renderView('1', { webDomain: '18comic.vip', favorited: false }),
}

let bad = 0
for (const [name, html] of Object.entries(pages)) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  if (!scripts.length) { console.log(`  ${name.padEnd(10)} 无内联脚本`); continue }
  scripts.forEach((s, i) => {
    try {
      new Function(s)
      console.log(`  ${name.padEnd(10)} 脚本#${i + 1} 语法 OK（${s.length} 字节）`)
    } catch (e) {
      bad++
      console.log(`  ${name.padEnd(10)} 脚本#${i + 1} 语法错误: ${e.message}`)
    }
  })
}
console.log(bad ? `\n${bad} 处脚本语法错误` : '\n内联脚本全部通过')