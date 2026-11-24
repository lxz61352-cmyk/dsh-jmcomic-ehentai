"""下载单个 JM 本子（限速版）。

用法：python jm_download_one.py <album_id> <输出目录> [代理] [每页间隔秒]

限速手段：
  · 图片线程固定为 1（串行）
  · 每下载完一张图，按 gap 秒睡一次
"""
import os
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")

aid = sys.argv[1]
outdir = sys.argv[2]
proxy = sys.argv[3] if len(sys.argv) > 3 else "127.0.0.1:7890"
try:
    gap = float(sys.argv[4]) if len(sys.argv) > 4 else 0.8
except ValueError:
    gap = 0.8
gap = max(0.0, min(gap, 10.0))

if not proxy.startswith("http"):
    proxy = "http://" + proxy

os.environ["HTTP_PROXY"] = proxy
os.environ["HTTPS_PROXY"] = proxy

import jmcomic  # noqa: E402

_orig_after_image = jmcomic.JmDownloader.after_image


def _throttled_after_image(self, *args, **kwargs):
    result = _orig_after_image(self, *args, **kwargs)
    if gap > 0:
        time.sleep(gap)
    return result


jmcomic.JmDownloader.after_image = _throttled_after_image

base = outdir.replace("\\", "/")
opt = jmcomic.create_option_by_str(f"""
dir_rule:
  base_dir: {base}
client:
  impl: api
  retry_times: 5
  postman:
    meta_data:
      proxies:
        http: {proxy}
        https: {proxy}
download:
  threading:
    image: 1
""")

print("TARGET", base, "GAP", gap, flush=True)
jmcomic.download_album(aid, option=opt)
print("DONE", aid, flush=True)