/**
 * dsh-ehentai — 前端半边（dsh.client bundle）。
 *
 * 只做入口：在「设置 → E-Hentai」和「插件 → dsh-ehentai」两处各挂一个面板，
 * 提供跳转到收藏页 / 设置页的按钮。真正的界面是插件自己的 HTTP 路由
 * （/dsh-ehentai/ 与 /dsh-ehentai/panel），用浏览器打开即可。
 *
 * 注册 id 必须等于 loader entry 名（dsh-ehentai），否则 ModuleLoader 会报
 * "loaded without registering dsh-ehentai"。
 */
window.__ModuleLoader__.load((() => {
  // 子路径部署时（反代 /app/xxx/），站内绝对路径要补上前缀
  const detectAppBase = (doc, href) => {
    const strip = (p) => String(p || '').replace(/\/+$/, '')
    if (!doc) return ''
    try {
      const src = doc.currentScript && doc.currentScript.src
      if (src) {
        const m = /^(.*?)\/plugins\//.exec(new URL(src, doc.baseURI || href).pathname)
        if (m) return strip(m[1])
      }
    } catch (e) { /* 非浏览器环境 */ }
    return ''
  }
  const APP_BASE = detectAppBase(
    typeof document === 'undefined' ? null : document,
    typeof location === 'undefined' ? '' : location.href,
  )
  const absAppPath = (u) => {
    const s = String(u == null ? '' : u)
    if (!s || s[0] !== '/' || s[1] === '/') return s
    if (!APP_BASE || s === APP_BASE || s.indexOf(APP_BASE + '/') === 0) return s
    return APP_BASE + s
  }

  return {
    id: '@dsh-jmcomic/ehentai',
    factory: (require) => {
      var module = { exports: {} }
      var exports = module.exports
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

      const React = require('react')
      const h = React.createElement

      const S = {
        wrap: { padding: '4px 0 12px' },
        card: {
          border: '1px solid var(--dsh-border, #2b2f3a)',
          borderRadius: 10,
          padding: '16px 18px',
          background: 'var(--dsh-surface, #1c1f27)',
          marginBottom: 12,
        },
        title: { margin: '0 0 6px', fontSize: 14, fontWeight: 600 },
        desc: {
          margin: '0 0 14px',
          fontSize: 12.5,
          lineHeight: 1.6,
          color: 'var(--dsh-text-secondary, #8b8f9a)',
        },
        row: { display: 'flex', gap: 10, flexWrap: 'wrap' },
        btn: {
          padding: '7px 18px',
          borderRadius: 6,
          border: 'none',
          cursor: 'pointer',
          fontSize: 13,
          fontFamily: 'inherit',
          background: '#d8694a',
          color: '#fff',
        },
        btnGhost: {
          padding: '7px 18px',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 13,
          fontFamily: 'inherit',
          background: 'transparent',
          color: 'var(--dsh-text, #e6e2d8)',
          border: '1px solid var(--dsh-border, #2b2f3a)',
        },
        btnSm: {
          padding: '5px 13px',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 12.5,
          fontFamily: 'inherit',
          background: 'transparent',
          color: 'var(--dsh-text, #e6e2d8)',
          border: '1px solid var(--dsh-border, #2b2f3a)',
          whiteSpace: 'nowrap',
        },
        kv: {
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '6px 14px',
          fontSize: 12.5,
          color: 'var(--dsh-text-secondary, #8b8f9a)',
          marginTop: 12,
        },
        code: {
          fontFamily: 'ui-monospace, Consolas, monospace',
          fontSize: 12,
          color: 'var(--dsh-text, #e6e2d8)',
        },
      }

      /**
       * 打开插件自己的页面。
       *
       * 两个坑都踩过了：
       *   1. 别给 window.open 传第三个 features 参数（`'noopener'`）。带特性串时
       *      浏览器会按"弹窗"处理，Electron 桌面版的 windowOpenHandler 常常直接
       *      deny，表现就是按钮点了没有任何反应。要断开 opener 用 w.opener = null。
       *   2. 被拦时 window.open 返回 null 而不是抛错，所以必须有兜底：退成当前
       *      窗口跳转，至少打得开，用户用后退就能回 DSH。
       */
      const openPage = (p) => {
        const url = absAppPath(p)
        // win=1 只在「真的开了新窗口」时带：页面据此才显示「关闭」按钮。
        // 退成当前窗口跳转时不带——那种情况下 window.close() 会把整个 DSH 一起关掉。
        const winUrl = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'win=1'
        let w = null
        try {
          w = window.open(winUrl, '_blank')
        } catch (e) {
          w = null
        }
        if (w) {
          try { w.opener = null } catch (e) { /* 跨源时设不了，无所谓 */ }
          return
        }
        // 退成当前窗口跳转：先抹掉「这是新窗口」的标记，否则页面会显示一个
        // 会把整个 DSH 关掉的「关闭」按钮。
        try { sessionStorage.removeItem('jm_new_win') } catch (e) { /* 拿不到就算了 */ }
        try { window.location.assign(url) } catch (e) { /* 都不行就只能手动复制地址 */ }
      }

      /** 用 <a> 而不是 <button>：中键 / 右键"在新标签打开"走浏览器原生行为 */
      const pageLink = (label, p, ghost) => h('a', {
        href: absAppPath(p),
        target: '_blank',
        rel: 'noopener noreferrer',
        style: Object.assign({}, ghost ? S.btnGhost : S.btn, {
          display: 'inline-block',
          textDecoration: 'none',
          lineHeight: '1.35',
        }),
        onClick: (e) => {
          e.preventDefault()
          openPage(p)
        },
      }, label)

      /** 切换查看栏里显示的页面：只改 iframe 的 src，不开新窗口 */
      const viewBtn = (label, p) => h('button', {
        type: 'button',
        style: S.btnSm,
        onClick: () => {
          try {
            const f = document.querySelector('iframe[name="jmview"]')
            if (!f) return
            const url = absAppPath(p) + (p.indexOf('?') >= 0 ? '&' : '?') + 'embed=1'
            // 先把旧页面卸掉再挂新的：上一个页面还在跑请求时直接换 src，
            // 有时候会把整个框一起拖住，看起来就像卡死了。
            f.src = 'about:blank'
            setTimeout(() => { try { f.src = url } catch (e) { /* 挂不上就算了 */ } }, 30)
          } catch (e) { /* 环境不支持就当作没点 */ }
        },
      }, label)

      function Panel() {
        return h('div', { style: S.wrap },
          h('div', { style: S.card },
            h('h3', { style: S.title }, 'JM / EH'),
            h('p', { style: S.desc },
              '下面那块就是插件界面。按钮和内容都排在 DSH 自己的顶栏下方，',
              '不会盖住窗口的关闭键。'
            ),
            h('div', { style: S.row },
              viewBtn('JM 收藏', '/dsh-ehentai/jm'),
              viewBtn('E 站收藏', '/dsh-ehentai/eh'),
              viewBtn('推荐', '/dsh-ehentai/recommend'),
              viewBtn('检索', '/dsh-ehentai/explore'),
              viewBtn('设置', '/dsh-ehentai/'),
            ),
            h('div', { style: S.kv },
              h('span', null, 'JM 收藏'),
              h('span', { style: S.code }, '/dsh-ehentai/jm'),
              h('span', null, 'E 站收藏'),
              h('span', { style: S.code }, '/dsh-ehentai/'),
              h('span', null, '词条统计'),
              h('span', { style: S.code }, '/dsh-ehentai/jm/stats'),
              h('span', null, '设置'),
              h('span', { style: S.code }, '/dsh-ehentai/'),
            )
          ),
          h('div', {
            style: {
              border: '1px solid var(--dsh-border, #2b2f3a)',
              borderRadius: 8,
              overflow: 'hidden',
              background: '#0e1014',
              marginBottom: 12,
            },
          },
            h('iframe', {
              name: 'jmview',
              src: absAppPath('/dsh-ehentai/jm') + '?embed=1',
              title: 'dsh-jmcomic/ehentai 查看栏',
              loading: 'lazy',
              style: {
                width: '100%',
                height: 'min(78vh, 860px)',
                minHeight: 460,
                border: '0',
                display: 'block',
              },
            })
          ),
          h('div', { style: S.card },
            h('h3', { style: S.title }, '想开独立窗口'),
            h('p', { style: S.desc },
              '要更大空间或想存书签，就用这几个按钮新标签打开；',
              '万一点了没反应，右键复制链接地址，或中键在新标签打开。'
            ),
            h('div', { style: S.row },
              pageLink('打开收藏', '/dsh-ehentai/jm'),
              pageLink('词条统计', '/dsh-ehentai/jm/stats', true),
              pageLink('打开设置页', '/dsh-ehentai/', true),
            )
          ),
          h('div', { style: S.card },
            h('h3', { style: S.title }, '在对话里用'),
            h('p', { style: S.desc },
              '也可以直接说：',
              h('span', { style: S.code }, ' 搜一下 xxx '),
              '、',
              h('span', { style: S.code }, ' 只要 4 分以上的 Doujinshi '),
              '、',
              h('span', { style: S.code }, ' 同步收藏 '),
              '。'
            ),
            h('p', { style: { ...S.desc, marginBottom: 0 } },
              '按作品种类和评分筛选时，因为 E 站已不支持分类参数，',
              '插件会多翻几页候选再本地过滤，比纯搜索慢一些。'
            )
          )
        )
      }

      const inject = ['slots']

      function apply(ctx) {
        const slots = ctx.get('slots')
        if (slots === undefined) return

        // 设置页分区：设置 → JM / EH
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'ehentai', order: 26, label: 'jm/eh' },
          () => React.createElement(Panel, { ctx }),
        ))

        // 插件详情页：插件 → dsh-ehentai
        slots.inject('plugins.bundle.config', () => slots.register(
          { name: 'plugins.bundle.config', key: '@dsh-jmcomic/ehentai' },
          () => React.createElement(Panel, { ctx }),
        ))
      }

      exports.apply = apply
      exports.inject = inject
      return module.exports
    },
  }
})())
