/**
 * 页面 UI 回归检查：node test/test_ui.mjs
 *
 * 对应外部反馈里那几条界面问题，改动容易被后续重构回退，所以固化成检查：
 *   · 每页 header 里有「回 DSH」和「关闭」两个出口
 *   · 顶部版本号来自 package.json，不是硬编码
 *   · 封面加载失败时有占位提示（全局 error 监听）
 *   · 推荐页有 JM / E 站两个 tab，且 E 站 tab 打的是 /recommend/eh
 *   · 收藏页 notice 是中性文案
 */
const lib = new URL('../lib/', import.meta.url).href
const { registerWeb, renderCollection, renderRecommend, renderJm } = await import(lib + 'web.js')

let bad = 0
const ok = (cond, name, extra = '') => {
  if (cond) console.log(' ok  ' + name)
  else { bad++; console.log(' FAIL ' + name + (extra ? '  → ' + extra : '')) }
}

// registerWeb 会把版本号注入模块，供 page() 使用
const ctx = { effect: (fn) => fn(), webServer: { register: () => {} } }
const registered = registerWeb(ctx, { version: '9.9.9-test' })
ok(registered === true, 'registerWeb 成功')

const rows = [{
  gid: '1', token: 'abcdef0123', title: '标题', category: 'Doujinshi',
  rating: 4.5, filecount: 40, posted: 0,
  thumb: 'https://ehgt.org/w/02/767/67309-1w8dcx1e.webp', tags: 'artist:x, tag:a',
}]
const fav = renderCollection(rows, { hasCookie: true, showNotice: true })

ok(fav.includes('9.9.9-test'), '顶栏版本号来自 package.json', fav.slice(0, 0))
ok(!/b1108a/.test(fav), '没有硬编码的旧版本号')
ok(fav.includes('回 DSH'), '有「回 DSH」出口')
ok(fav.includes('id="exitBtn"'), '有「关闭」按钮')
ok(/window\.close/.test(fav), '关闭按钮会尝试 window.close')
ok(/addEventListener\('error'/.test(fav), '有全局图片加载失败监听')
ok(/封面取不到/.test(fav), '图片失败时有占位文案')
ok(fav.includes('./thumb?u='), 'E 站封面走 /thumb 代理')
ok(!/铸币/.test(fav), 'notice 文案已中性化')
ok(fav.includes('igneous'), 'notice 说明了里站需要 igneous')

// 下载反馈：提示条 + 进度轮询要覆盖所有页面（曾经点下载只有一句"已开始下载"）
ok(fav.includes("id = 'dlToast'") || fav.includes('id="dlToast"'), '页面注入了下载提示条')
ok(fav.includes('window.dlWatchEh'), 'E 站下载有进度轮询')
ok(fav.includes('window.dlWatchJm'), 'JM 下载有进度轮询')
ok(/dlWatchEh\(cur\.url/.test(fav), 'E 站收藏页下载后接上了轮询')
ok(fav.includes("fetch('./eh/download'"), 'E 站收藏页仍然接下载接口')

const jmPage = renderJm(
  { items: [{ id: '1198811', title: 't', tags: ['tag:a'], author: 'a', pages: 10, likes: 1 }], updatedAt: Date.now() },
  { webDomain: '18comic.vip' }
)
ok(/dlWatchJm\(cur\.id/.test(jmPage), 'JM 收藏页右键下载后接上了轮询')

const rec = renderRecommend({ webDomain: '18comic.vip' })
ok(rec.includes('id="tabJm"') && rec.includes('id="tabEh"'), '推荐页有 JM / E 站两个 tab')
ok(rec.includes("fetch('./recommend/eh'"), 'E 站 tab 请求 /recommend/eh')
ok(rec.includes("fetch('./recommend/run'"), 'JM tab 仍然请求 /recommend/run')
ok(rec.includes('id="panelEh"'), 'E 站面板存在')
ok(/header nav a,header nav button/.test(rec), '样式表已渲染')

// 窄窗口：header 必须能换行、子项必须能收缩
ok(/header\{[^}]*flex-wrap:wrap/.test(rec), 'header 允许换行')
ok(/header \.sub\{[^}]*min-width:0/.test(rec), '.sub 允许收缩（min-width:0）')
ok(/@media \(max-width:860px\)/.test(rec), '有窄屏媒体查询')

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
