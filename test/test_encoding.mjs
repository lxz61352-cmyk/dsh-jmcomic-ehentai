/**
 * 编码检查：node test/test_encoding.mjs
 *
 * 踩过的坑：package.json 被存成带 UTF-8 BOM，宿主侧 `dsh plugin list` 直接
 * `JSON.parse(readFileSync(pkg, 'utf8'))` 会抛
 * `SyntaxError: Unexpected token '\uFEFF'`，插件在列表里直接报错。
 *
 * 为什么本机容易漏：Node 的 ESM/CJS 加载器会自己剥掉 BOM，`import`、
 * `require`、`node --check` 全都照常通过，只有**裸 JSON.parse** 会炸。
 * 所以这里专门按宿主的读法校验一遍。
 *
 * 顺带盯住一类常见的 BOM 来源：PowerShell 的 `Set-Content -Encoding utf8`
 * （5.1 默认带 BOM）改写文件会把 BOM 写回去。
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const BIN_EXT = /\.(png|jpe?g|webp|gif|avif|ico|zip|gz|mp3|mp4|woff2?|ttf|pdf)$/i
const hasBom = (b) => b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf

let bad = 0
const ok = (cond, name, extra = '') => {
  if (cond) console.log(' ok  ' + name)
  else { bad++; console.log(' FAIL ' + name + (extra ? '  → ' + extra : '')) }
}

const files = execSync('git ls-files', { cwd: process.cwd() })
  .toString()
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((f) => !BIN_EXT.test(f))

const withBom = []
for (const f of files) {
  let buf
  try {
    buf = readFileSync(f)
  } catch {
    continue // 被删除/未落盘的文件不算
  }
  if (hasBom(buf)) withBom.push(f)
}
ok(withBom.length === 0, '被跟踪的文本文件都不带 BOM', withBom.join(', '))

// 模拟宿主：裸 JSON.parse，不剥 BOM
const raw = readFileSync('package.json')
ok(!hasBom(raw), 'package.json 无 BOM', [...raw.slice(0, 4)].map((x) => x.toString(16)).join(' '))
let pkg = null
let err = ''
try {
  pkg = JSON.parse(raw.toString('utf8'))
} catch (e) {
  err = e.message
}
ok(!!pkg, 'package.json 能被裸 JSON.parse 解析', err)
if (pkg) {
  ok(pkg.name === '@dsh-jmcomic/ehentai', 'name 正确', pkg.name)
  ok(typeof pkg.version === 'string' && /^\d+\.\d+\.\d+/.test(pkg.version), 'version 形如 x.y.z', pkg.version)
}

// settings.example.json 同理会被人拷成 settings.json 再解析
const ex = readFileSync('settings.example.json')
ok(!hasBom(ex), 'settings.example.json 无 BOM')
try {
  JSON.parse(ex.toString('utf8'))
  ok(true, 'settings.example.json 能被裸 JSON.parse 解析')
} catch (e) {
  ok(false, 'settings.example.json 能被裸 JSON.parse 解析', e.message)
}

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
