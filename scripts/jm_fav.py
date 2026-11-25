"""收藏 / 取消收藏一个 JM 本子。

用法：python jm_fav.py <add|remove> <album_id> [代理]

凭证从环境变量取：JM_USER / JM_PASS（由插件注入口令）。
成功后打印 OK / REMOVED，失败打印 ERROR 行。
"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

action = sys.argv[1]
aid = sys.argv[2]
proxy = sys.argv[3] if len(sys.argv) > 3 else "127.0.0.1:7890"
if not proxy.startswith("http"):
    proxy = "http://" + proxy

os.environ["HTTP_PROXY"] = proxy
os.environ["HTTPS_PROXY"] = proxy

user = os.environ.get("JM_USER", "")
pwd = os.environ.get("JM_PASS", "")
if not user or not pwd:
    print("ERROR: 未配置 JM 账号")
    raise SystemExit(2)

import jmcomic  # noqa: E402

# 登录要补 uid / username 与 __cflb 粘性会话，否则收藏接口一直 401「請先登入會員」。
# 单独把这个脚本拷走时（旁边没有 jm_login.py）就退化成旧的直接登录，不至于跑不起来。
try:
    from jm_login import login_jm
except ImportError:  # noqa: BLE001
    def login_jm(client, user, pwd):
        client.login(user, pwd)
        return client


try:
    client = jmcomic.JmOption.default().new_jm_client()
    login_jm(client, user, pwd)
    if action == "add":
        client.add_favorite_album(aid, folder_id="0")
        print("OK", aid)
    elif action == "remove":
        client.delete_favorite_album(aid, folder_id="0")
        print("REMOVED", aid)
    else:
        print("ERROR: 未知动作", action)
        raise SystemExit(2)
except SystemExit:
    raise
except Exception as e:
    print("ERROR:", type(e).__name__, str(e)[:160])
    raise SystemExit(1)
