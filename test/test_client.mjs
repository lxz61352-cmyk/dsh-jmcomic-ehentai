/**
 * client.js 的离线检查：不需要 DSH 宿主，node test/test_client.mjs 直接跑。
 *
 * 它验证的是"面板能渲染出可点的入口"，不是"Electron 里真能弹出新标签"——
 * 后者只能在桌面版里手点。这里覆盖：
 *   · client bundle 能被 ModuleLoader 收下，id 与 factory 齐全
 *   · apply() 能在 settings.section 与 plugins.bundle.config 两处注册
 *   · 三个入口都是 <a>，href 指向正确的插件路由，onClick 会真的去开窗口
 *   · window.open 被拦（返回 null）时会退到 location.assign
 */
const opened = []
const assigned = []

globalThis.window = {
  open: (url, target) => {
    opened.push({ url, target })
    return globalThis.__OPEN_OK__ ? { opener: 'x' } : null
  },
  location: { href: 'http://127.0.0.1:43129/', assign: (u) => assigned.push(u) },
}
globalThis.location = globalThis.window.location
globalThis.document = {
  currentScript: null,
  baseURI: 'http://127.0.0.1:43129/',
  createElement: () => ({ style: {} }),
}

let bundle = null
globalThis.window.__ModuleLoader__ = { load: (mod) => { bundle = mod } }

await import(new URL('../client.js', import.meta.url).href)

let bad = 0
const ok = (cond, name, extra = '') => {
  if (cond) console.log(' ok  ' + name)
  else { bad++; console.log(' FAIL ' + name + (extra ? '  → ' + extra : '')) }
}

ok(!!bundle, 'ModuleLoader 收到 bundle')
ok(bundle && bundle.id === '@dsh-jmcomic/ehentai', 'bundle id 正确', bundle && bundle.id)

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
}
const mod = bundle.factory((name) => {
  if (name === 'react') return React
  throw new Error('未预期的依赖：' + name)
})
ok(typeof mod.apply === 'function', 'factory 导出 apply')

const registered = []
const ctx = {
  get: (k) => (k === 'slots'
    ? {
      inject: (name, fn) => fn(),
      register: (meta, comp) => { registered.push({ meta, comp }); return { dispose() {} } },
    }
    : undefined),
}
mod.apply(ctx)
ok(registered.length === 2, '两处 slot 都注册了', String(registered.length))
const slots = registered.map((r) => r.meta.name).sort().join(',')
ok(slots === 'plugins.bundle.config,settings.section', 'slot 名称正确', slots)

// 渲染第一个面板，找出三个入口
const tree = registered[0].comp()
const flat = []
const walk = (n) => {
  if (!n || typeof n !== 'object') return
  if (typeof n.type === 'function') {
    walk(n.type(n.props || {})) // 函数组件就地展开
    return
  }
  flat.push(n)
  for (const c of n.children || []) walk(c)
}
walk(tree)

const links = flat.filter((n) => n.type === 'a')
ok(links.length === 3, '三个入口', String(links.length))
const hrefs = links.map((l) => l.props.href)
ok(
  hrefs.join(' ') === '/dsh-ehentai/jm /dsh-ehentai/jm/stats /dsh-ehentai/',
  'href 指向插件路由',
  hrefs.join(' ')
)
ok(links.every((l) => l.props.target === '_blank' && l.props.href), '都是新标签打开')

// 点击：window.open 可用时不该走 location.assign
globalThis.__OPEN_OK__ = true
opened.length = 0
assigned.length = 0
let prevented = false
links[0].props.onClick({ preventDefault: () => { prevented = true } })
ok(prevented, 'onClick 拦掉了默认导航（由自己控制）')
ok(opened.length === 1 && opened[0].url.split('?')[0] === '/dsh-ehentai/jm', 'window.open 用了正确地址', JSON.stringify(opened))
ok(opened[0] && /[?&]win=1(&|$)/.test(opened[0].url || ''), '新窗口打开带 win=1（页面据此才显示关闭按钮）', JSON.stringify(opened))
ok(opened[0] && opened[0].target === '_blank', 'window.open 以新标签打开')
ok(assigned.length === 0, '正常时不该退到当前窗口')

// 点击：window.open 被拦（返回 null）时应退到 location.assign
globalThis.__OPEN_OK__ = false
opened.length = 0
assigned.length = 0
links[2].props.onClick({ preventDefault: () => {} })
ok(opened.length === 1 && assigned.length === 1, '被拦时退到当前窗口跳转', JSON.stringify({ opened, assigned }))
ok(assigned[0] === '/dsh-ehentai/', '兜底跳转地址正确', assigned[0])

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
