"""JM 检索 + 详情缓存。

用法：
    python jm_explore.py <query> <pages> <max_detail> <gap>

流程：
  1. 关键词/标签搜索，翻 pages 页拿候选 id
  2. 详情走本地缓存 jm_albums.json，只补未缓存的，最多补 max_detail 本
  3. 结果写到 jm_explore_result.json

缓存是效率的关键：同一批候选第二次跑不再请求站点。
"""
import json
import os
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")

query = sys.argv[1] if len(sys.argv) > 1 else ""
pages = max(1, min(10, int(sys.argv[2]) if len(sys.argv) > 2 else 3))
max_detail = max(0, min(300, int(sys.argv[3]) if len(sys.argv) > 3 else 60))
try:
    gap = float(sys.argv[4]) if len(sys.argv) > 4 else 0.35
except ValueError:
    gap = 0.35

mode = (sys.argv[5] if len(sys.argv) > 5 else "site").strip().lower()

proxy = os.environ.get("JM_PROXY", "http://127.0.0.1:7890")
user = os.environ.get("JM_USER", "")
pwd = os.environ.get("JM_PASS", "")
os.environ["HTTP_PROXY"] = proxy
os.environ["HTTPS_PROXY"] = proxy

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "jm_albums.json")
OUT = os.path.join(HERE, "jm_explore_result.json")
COVER = "https://cdn-msp.jmapinodeudzn.net/media/albums/{}.jpg"

import jmcomic  # noqa: E402


def load_cache():
    try:
        with open(CACHE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def main():
    cache = load_cache()
    client = jmcomic.JmOption.default().new_jm_client()
    if user and pwd:
        client.login(user, pwd)

    # 1) 候选：query 支持用 | 分隔多路召回（同义、别名、错别字变体），
    #    各路分别搜索再合并去重——JM 的搜索是 AND，没法在一次里表达 OR。
    variants = [q.strip() for q in query.split("|") if q.strip()] or [query]
    ids = []
    seen = set()
    for vq in variants:
        for page in range(1, pages + 1):
            try:
                if mode == "author":
                    p = client.search_author(vq, page=page)
                else:
                    p = client.search_site(vq, page=page)
            except Exception as e:
                print("SEARCH_ERR", str(e)[:120], flush=True)
                break
            items = list(p.iter_id_title()) if hasattr(p, "iter_id_title") else []
            if not items:
                break
            for aid, title in items:
                if str(aid) in seen:
                    continue
                seen.add(str(aid))
                ids.append((str(aid), str(title)))
            if page >= getattr(p, "page_count", page):
                break
            time.sleep(max(0.3, gap))
        if len(variants) > 1:
            time.sleep(max(0.3, gap))

    print(f"CANDIDATES {len(ids)}", flush=True)

    # 2) 补详情（先缓存，后抓取，限量）
    fetched = 0
    for aid, title in ids:
        if aid in cache:
            continue
        if fetched >= max_detail:
            break
        rec = {"id": aid, "title": title, "author": "", "tags": [], "likes": 0,
               "views": 0, "pages": 0, "update": "", "cover": COVER.format(aid)}
        try:
            d = client.get_album_detail(aid)
            rec["title"] = str(getattr(d, "name", "") or title)
            rec["author"] = str(getattr(d, "author", "") or "")
            rec["tags"] = [str(t) for t in (getattr(d, "tags", None) or [])]
            rec["likes"] = int(getattr(d, "likes", 0) or 0)
            rec["views"] = int(getattr(d, "views", 0) or 0)
            rec["pages"] = int(getattr(d, "page_count", 0) or 0)
            rec["update"] = str(getattr(d, "pub_date", "") or "")
        except Exception as e:
            rec["error"] = str(e)[:100]
        cache[aid] = rec
        fetched += 1
        if fetched % 20 == 0:
            print(f"FETCHED {fetched}", flush=True)
        time.sleep(gap)

    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)

    rows = [cache[a] for a, _ in ids if a in cache]
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({
            "query": query,
            "at": int(time.time() * 1000),
            "candidates": len(ids),
            "fetched": fetched,
            "cacheSize": len(cache),
            "items": rows,
        }, f, ensure_ascii=False, indent=1)

    print(f"DONE rows={len(rows)} fetched={fetched} cache={len(cache)}", flush=True)


if __name__ == "__main__":
    main()