/**
 * 离线单测：不需要网络、不需要 DSH 宿主，node test/test_units.mjs 直接跑。
 *
 * 覆盖这次修的几个点：
 *   · 列表页解析出下一页游标（收藏页 favorites.php?next=…、搜索页 /s/<key>/<n>）
 *   · Cookie 口径统一（表站整串 / 三分量、里站三分量）
 *   · requestFollow 手动跟 302，并在跨源时摘掉 Cookie
 *   · Python 解释器探测
 */
import http from 'node:http'

const lib = new URL('../lib/', import.meta.url).href
const { parseListPage, cookieOf, buildCtx } = await import(lib + 'eh.js')
const { requestFollow } = await import(lib + 'http.js')
const { isEhGalleryUrl } = await import(lib + 'ehdl.js')
const { pythonCmd, pythonCandidates } = await import(lib + 'pycmd.js')

let bad = 0
const ok = (cond, name, extra = '') => {
  if (cond) console.log(' ok  ' + name)
  else { bad++; console.log(' FAIL ' + name + (extra ? '  → ' + extra : '')) }
}

// ── 1. 收藏页：游标分页 ──
const favHtml = `
<html><body><table>
<tr class="gtr"><td><a href="https://e-hentai.org/g/1111/aaaaaaaaaa/"><img src="x.jpg"></a>
  <a class="glink" href="https://e-hentai.org/g/1111/aaaaaaaaaa/">T1</a><div class="cs">Doujinshi</div></td></tr>
<tr class="gtr"><td><a href="https://e-hentai.org/g/2222/bbbbbbbbbb/"><img src="y.jpg"></a>
  <a class="glink" href="https://e-hentai.org/g/2222/bbbbbbbbbb/">T2</a><div class="cs">Manga</div></td></tr>
</table>
<a id="unext" href="https://e-hentai.org/favorites.php?next=2222-1795518132">Next</a>
<a id="prev" href="https://e-hentai.org/favorites.php?prev=1">Prev</a>
</body></html>`
const fav = parseListPage(favHtml)
ok(fav.items.length === 2, '收藏页剥出 2 条', String(fav.items.length))
ok(fav.nextUrl === 'https://e-hentai.org/favorites.php?next=2222-1795518132', '收藏页取到 next 游标', fav.nextUrl)
ok(fav.hasNext === true, '收藏页 hasNext')

// ── 2. 搜索页：路径序号分页 ──
const searchHtml = `
<html><body>
<div class="gl1t"><a href="https://e-hentai.org/g/3333/cccccccccc/"><img src="z.jpg"></a>
<a class="glink" href="https://e-hentai.org/g/3333/cccccccccc/">T3</a><div class="cs">Artist CG</div></div>
<a id="unext" href="https://e-hentai.org/s/abcd1234/1">Next</a>
</body></html>`
const sr = parseListPage(searchHtml)
ok(sr.items.length === 1, '搜索页剥出 1 条', String(sr.items.length))
ok(sr.nextUrl === 'https://e-hentai.org/s/abcd1234/1', '搜索页取到路径游标', sr.nextUrl)

// 末页没有 unext
const lastPage = parseListPage('<html><body><a class="glink" href="https://e-hentai.org/g/4444/dddddddddd/">T4</a></body></html>')
ok(lastPage.nextUrl === '' && lastPage.hasNext === false, '末页没有下一页')

// ── 3. Cookie 口径 ──
const three = { ipbMemberId: '1', ipbPassHash: 'h', igneous: 'i' }
ok(
  cookieOf({ useExhentai: false, ehentaiCookie: 'a=1; b=2', exhentaiCookies: three }) === 'a=1; b=2',
  '表站：整串优先'
)
ok(
  cookieOf({ useExhentai: false, ehentaiCookie: '', exhentaiCookies: three }) ===
    'ipb_member_id=1; ipb_pass_hash=h; igneous=i',
  '表站：整串为空退回三分量'
)
ok(
  cookieOf({ useExhentai: true, ehentaiCookie: 'a=1', exhentaiCookies: three }) ===
    'ipb_member_id=1; ipb_pass_hash=h; igneous=i',
  '里站：三分量优先'
)
ok(buildCtx({ useExhentai: false, ehentaiCookie: '' }).headers.Cookie === undefined, '空 cookie 不塞空头')

// ── 4. requestFollow：跟 302 + 跨源摘 Cookie ──
const target = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end('cookie=' + (req.headers.cookie || '-') + ' ref=' + (req.headers.referer || '-'))
})
await new Promise((r) => target.listen(0, '127.0.0.1', r))
const targetPort = target.address().port

const jumper = http.createServer((req, res) => {
  res.writeHead(302, { location: `http://127.0.0.1:${targetPort}/img.webp` })
  res.end()
})
await new Promise((r) => jumper.listen(0, '127.0.0.1', r))
const jumperPort = jumper.address().port

const sameOrigin = http.createServer((req, res) => {
  if (req.url === '/a') {
    res.writeHead(302, { location: '/b' })
    res.end()
  } else {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('cookie=' + (req.headers.cookie || '-'))
  }
})
await new Promise((r) => sameOrigin.listen(0, '127.0.0.1', r))
const soPort = sameOrigin.address().port

const crossed = await requestFollow(`http://127.0.0.1:${jumperPort}/fullimg`, {
  headers: { Cookie: 'ipb_member_id=1' },
})
const crossText = crossed.body.toString('utf8')
ok(crossed.status === 200 && /cookie=-/.test(crossText), '跨源 302：Cookie 被摘掉', crossText)
ok(/ref=http:\/\/127\.0\.0\.1/.test(crossText), '跨源 302：Referer 落到上一跳站点', crossText)

const same = await requestFollow(`http://127.0.0.1:${soPort}/a`, {
  headers: { Cookie: 'ipb_member_id=1' },
})
ok(/cookie=ipb_member_id=1/.test(same.body.toString('utf8')), '同源 302：Cookie 保留')

target.close(); jumper.close(); sameOrigin.close()

// ── 5. 画廊地址判定（表站 / 里站都收） ──
ok(isEhGalleryUrl('https://e-hentai.org/g/123/abcdef0123/'), '表站画廊地址通过')
ok(isEhGalleryUrl('https://exhentai.org/g/123/abcdef0123/'), '里站画廊地址通过')
ok(!isEhGalleryUrl('https://example.com/g/1/x/'), '别的站拒绝')
ok(!isEhGalleryUrl('https://e-hentai.org/s/abc/1'), '非画廊地址（图片页）拒绝')

// ── 6. Python 探测 ──
const py = pythonCmd()
ok(py && typeof py.cmd === 'string', 'pythonCmd 返回可执行名', JSON.stringify(py))
console.log('    探测结果：' + JSON.stringify(pythonCandidates().filter((c) => c.usable)))

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
