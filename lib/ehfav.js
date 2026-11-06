/** E 站收藏 / 取消收藏（表站表单版）。 */
import { request } from './http.js'

function cookieOf(cfg) {
  const ck = (cfg && cfg.exhentaiCookies) || {}
  const parts = []
  if (ck.ipbMemberId) parts.push('ipb_member_id=' + ck.ipbMemberId)
  if (ck.ipbPassHash) parts.push('ipb_pass_hash=' + ck.ipbPassHash)
  if (ck.igneous) parts.push('igneous=' + ck.igneous)
  return parts.join('; ')
}

export async function setEhFavorite(cfg, gid, token, action) {
  const g = String(gid || '').replace(/[^\d]/g, '')
  const t = String(token || '').replace(/[^0-9a-z]/gi, '')
  if (!g || !t) return { ok: false, msg: 'gid / token 不合法' }

  const ck = cookieOf(cfg)
  const ref = 'https://e-hentai.org/g/' + g + '/' + t + '/'
  const act = action === 'remove' ? 'removefav' : 'addfav'
  const url = 'https://e-hentai.org/gallerypopups.php?gid=' + g + '&t=' + t + '&act=' + act

  try {
    await request(url, { proxy: cfg.proxy, headers: { Cookie: ck, Referer: ref }, timeoutMs: 30000 })
    const body = action === 'remove'
      ? 'favcat=0&favnote=&apply=Delete+from+Favorites'
      : 'favcat=0&favnote=&apply=Add+to+Favorites'
    const r = await request(url, {
      method: 'POST',
      proxy: cfg.proxy,
      headers: {
        Cookie: ck,
        Referer: ref,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      timeoutMs: 30000,
    })
    if (r.status !== 200) return { ok: false, msg: '站点返回 ' + r.status }
    return { ok: true, msg: action === 'remove' ? '已取消收藏' : '已收藏' }
  } catch (e) {
    return { ok: false, msg: '请求失败：' + e.message }
  }
}