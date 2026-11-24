"""把已下载的本子缩成小图，供读图总结剧情时控制上下文开销。

用法：python jm_thumbs.py <album_id> [宽度=720]
输出：<下载根>/.thumbs/<id>/00001.jpg …
"""
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

from PIL import Image  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DL_PATH = os.path.join(HERE, "jm_downloads.json")
EXTS = (".webp", ".jpg", ".jpeg", ".png", ".gif", ".avif", ".bmp")

aid = str(sys.argv[1]).strip()
width = int(sys.argv[2]) if len(sys.argv) > 2 else 720

try:
    recs = json.load(open(DL_PATH, encoding="utf-8"))
except Exception:
    print("ERROR 读不到 jm_downloads.json")
    raise SystemExit(2)

rec = recs.get(aid)
if not rec or not rec.get("dir"):
    print("ERROR 这本没有下载记录，先 jm_download")
    raise SystemExit(2)

srcdir = rec["dir"]
if not os.path.isdir(srcdir):
    print("ERROR 目录不存在:", srcdir)
    raise SystemExit(2)

root = os.path.dirname(srcdir.rstrip("\\/"))
outdir = os.path.join(root, ".thumbs", aid)
os.makedirs(outdir, exist_ok=True)

files = sorted(f for f in os.listdir(srcdir) if f.lower().endswith(EXTS))
if not files:
    print("ERROR 目录里没有图片")
    raise SystemExit(2)

made = 0
skipped = 0
total = 0
for idx, name in enumerate(files, 1):
    target = os.path.join(outdir, "%05d.jpg" % idx)
    if os.path.exists(target):
        skipped += 1
        total += os.path.getsize(target)
        continue
    try:
        im = Image.open(os.path.join(srcdir, name))
        im = im.convert("RGB")
        w, h = im.size
        if w > width:
            im = im.resize((width, max(1, int(h * width / w))), Image.LANCZOS)
        im.save(target, "JPEG", quality=72, optimize=True)
        made += 1
        total += os.path.getsize(target)
    except Exception as e:
        print("SKIP", name, type(e).__name__, str(e)[:40])

print("SRC", srcdir)
print("OUT", outdir)
print("PAGES", len(files), "NEW", made, "EXIST", skipped, "SIZE", round(total / 1048576, 2), "MB")