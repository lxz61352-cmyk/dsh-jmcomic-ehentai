"""JM 登录：把 jmcomic 的 login() 补成真正能用的状态。

jmcomic（2.7.x）的 `login()` 有两个坑，都会让收藏接口一直返回 401「請先登入會員」：

1. 它只把登录响应里的 `AVS` 塞进 cookies，而服务器同时要求 cookies 里有
   `uid` 与 `username`（这两个值登录响应里本来就有）。只补其中一个仍然 401，
   两个都必须补。
2. 站点的 Cloudflare 用 `__cflb` 做粘性会话：第一次登录的响应常常不带它，
   后续请求一旦被分到别的后端节点，登录态就丢了。再登录一次，把两次的 cookie
   合并起来就能拿到稳定的那份。

用法：

    from jm_login import login_jm
    login_jm(client, user, pwd)

只需要 `import jmcomic` 之后、请求收藏接口之前调用一次。
"""


def _cookies_of(client):
    try:
        return dict(client['cookies'] or {})
    except Exception:
        return {}


def login_jm(client, user, pwd):
    """登录并修好 cookie（uid / username / __cflb）。返回 client，方便链式调用。"""
    r1 = client.login(user, pwd)
    c1 = _cookies_of(client)

    merged = dict(c1)
    data = (getattr(r1, "res_data", None) or {})

    # 第二次：拿 __cflb（粘性会话）。失败不影响主流程，第一次的 cookie 还在。
    try:
        r2 = client.login(user, pwd)
        merged.update(_cookies_of(client))
        data = (getattr(r2, "res_data", None) or data)
    except Exception:
        pass

    if data.get("uid") is not None:
        merged["uid"] = str(data["uid"])
    if data.get("username"):
        merged["username"] = str(data["username"])

    client['cookies'] = merged
    return client
