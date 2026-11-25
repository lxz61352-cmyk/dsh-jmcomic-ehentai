"""抓取 JM 收藏夹的封面 / 标题 / 作者 / tag，输出 jm.json 供插件页面读取。

凭证从环境变量取，不落盘：
    JM_USER / JM_PASS
输出：
    <本文件目录>/jm.json

增量设计（2026-11-21 改）：
- 收藏列表页拿到 id + 标题后，本地已有 tags 的条目直接复用，不再重拉详情
- 只有新增 / 缺详情的条目才请求 get_album_detail，用 3 线程并发
- 结果先写 .tmp 再原子替换，刷新中断不会留下半截文件
"""
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.stdout.reconfigure(encoding="utf-8")

PROXY = os.environ.get("JM_PROXY", "http://127.0.0.1:7890")
os.environ.setdefault("HTTP_PROXY", PROXY)
os.environ.setdefault("HTTPS_PROXY", PROXY)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "jm.json")
COVER = "https://cdn-msp.jmapinodeudzn.net/media/albums/{}.jpg"

import jmcomic  # noqa: E402

# 登录要补 uid / username 与 __cflb 粘性会话，否则收藏接口一直 401「請先登入會員」。
# 单独把这个脚本拷走时（旁边没有 jm_login.py）就退化成旧的直接登录，不至于跑不起来。
try:
    from jm_login import login_jm
except ImportError:  # noqa: BLE001
    def login_jm(client, user, pwd):
        client.login(user, pwd)
        return client


WORKERS = 3
LIST_WORKERS = 5


def load_old():
    """读上一版 jm.json，建 id -> 记录 的索引。"""
    try:
        with open(OUT, encoding="utf-8") as f:
            d = json.load(f)
        out = {}
        for it in d.get("items", []):
            aid = str(it.get("id") or "")
            if aid:
                out[aid] = it
        return out
    except Exception:
        return {}


def main():
    user = os.environ.get("JM_USER", "")
    pwd = os.environ.get("JM_PASS", "")
    if not user or not pwd:
        print("ERROR: JM_USER / JM_PASS 未设置")
        return 2

    old = load_old()
    stale = [k for k, v in old.items() if not v.get("tags")]
    print(f"本地缓存 {len(old)} 条（其中 {len(stale)} 条缺 tags 需补）", flush=True)

    client = jmcomic.JmOption.default().new_jm_client()
    login_jm(client, user, pwd)
    print("LOGIN OK", flush=True)

    # 第 1 页拿总页数，其余页并发抓；单页失败不影响整体
    first = client.favorite_folder(page=1, folder_id="0")
    page_count = max(1, int(getattr(first, "page_count", 1) or 1))
    pages = {1: list(first.iter_id_title())}
    print(f"收藏共 {page_count} 页", flush=True)

    def fetch_page(pg):
        try:
            p = client.favorite_folder(page=pg, folder_id="0")
            return pg, list(p.iter_id_title())
        except Exception as e:
            print(f"PAGE {pg} 失败: {e}", flush=True)
            return pg, []

    if page_count > 1:
        with ThreadPoolExecutor(max_workers=LIST_WORKERS) as ex:
            for pg, batch in ex.map(fetch_page, range(2, page_count + 1)):
                pages[pg] = batch
                total = sum(len(v) for v in pages.values())
                print(f"PAGE {pg}/{page_count} 累计 {total}", flush=True)

    ids = []
    for pg in range(1, page_count + 1):
        for aid, title in pages.get(pg, []):
            ids.append((str(aid), str(title)))

    # 需要拉详情的：本地没有、或本地缺 tags
    todo = [(aid, title) for aid, title in ids
            if not (aid in old and old[aid].get("tags"))]
    reuse = len(ids) - len(todo)
    print(f"收藏 {len(ids)} 本 · 复用 {reuse} · 需抓 {len(todo)}", flush=True)

    fresh = {}

    def fetch(item):
        aid, title = item
        rec = {
            "id": aid, "title": title, "author": "", "tags": [],
            "likes": 0, "views": 0, "update": "", "cover": COVER.format(aid),
        }
        try:
            d = client.get_album_detail(aid)
            rec["title"] = str(getattr(d, "name", "") or title)
            rec["author"] = str(getattr(d, "author", "") or "")
            rec["tags"] = [str(t) for t in (getattr(d, "tags", None) or [])]
            rec["likes"] = int(getattr(d, "likes", 0) or 0)
            rec["views"] = int(getattr(d, "views", 0) or 0)
            # jmcomic 2.7.12 里 AlbumDetail.update_date 恒为 0，
            # 真正的发布日期在 pub_date（jm_explore.py 用的也是它）
            rec["update"] = str(getattr(d, "pub_date", "") or getattr(d, "update_date", "") or "")
        except Exception as e:
            rec["error"] = str(e)[:120]
        return aid, rec

    if todo:
        done = 0
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futs = [ex.submit(fetch, it) for it in todo]
            for f in as_completed(futs):
                aid, rec = f.result()
                fresh[aid] = rec
                done += 1
                if done % 10 == 0 or done == len(todo):
                    print(f"详情 {done}/{len(todo)}", flush=True)

    # 按收藏页顺序重组；列表里没有的（取消收藏）自然被剔除
    rows = []
    for aid, title in ids:
        rec = fresh.get(aid) or old.get(aid)
        if rec is None:
            rec = {
                "id": aid, "title": title, "author": "", "tags": [],
                "likes": 0, "views": 0, "update": "", "cover": COVER.format(aid),
            }
        rows.append(rec)

    data = {"updatedAt": int(time.time() * 1000), "count": len(rows), "items": rows}
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, OUT)
    print(f"WROTE {OUT} count={len(rows)} 新抓={len(fresh)} 复用={len(rows) - len(fresh)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
