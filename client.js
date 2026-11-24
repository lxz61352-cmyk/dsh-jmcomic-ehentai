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
        let w = null
        try {
          w = window.open(url, '_blank')
        } catch (e) {
          w = null
        }
        if (w) {
          try { w.opener = null } catch (e) { /* 跨源时设不了，无所谓 */ }
          return
        }
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

      function Panel() {
        return h('div', { style: S.wrap },
          h('div', { style: S.card },
            h('h3', { style: S.title }, 'dsh-jmcomic/ehentai'),
            h('p', { style: S.desc },
              'JM 收藏、E 站收藏、检索与偏好推荐都由插件自己的页面承载。',
              '点击下面的按钮会用新标签页打开，可以直接存书签。',
              '万一点了没反应，右键复制链接地址，或中键在新标签打开。'
            ),
            h('div', { style: S.row },
              pageLink('打开收藏', '/dsh-ehentai/jm'),
              pageLink('词条统计', '/dsh-ehentai/jm/stats', true),
              pageLink('打开设置页', '/dsh-ehentai/', true),
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
          { name: 'settings.section', id: 'ehentai', order: 26, label: 'dsh-jmcomic/ehentai' },
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
