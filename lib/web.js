/**
 * 插件的 Web 部分：收藏页、设置页、封面代理。
 *
 * 路由都挂在 webServer 前缀 /dsh-ehentai 下：
 *   GET  /dsh-ehentai/            → E 站收藏页
 *   GET  /dsh-ehentai/jm          → JM 收藏页（封面 / 标题 / 作者 / tag）
 *   GET  /dsh-ehentai/panel       → 设置页
 *   GET  /dsh-ehentai/thumb?u=... → E 站封面代理
 *   GET  /dsh-ehentai/jmthumb?u=  → JM 封面代理
 *   POST /dsh-ehentai/jm/download → 触发下载（{id}）
 *   POST /dsh-ehentai/jm/refresh  → 重新抓取 JM 收藏
 *   GET  /dsh-ehentai/jm/status   → 下载任务状态（?id=）
 *   POST /dsh-ehentai/panel       → 保存设置
 */
import { readFileSync, existsSync } from 'node:fs'
import { request } from './http.js'
import { galleryUrl } from './eh.js'
import { jmStats } from './jm.js'

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const CSS = `
:root{
  --bg:#14161b; --panel:#1c1f27; --line:#2b2f3a; --text:#e6e2d8;
  --dim:#8b8f9a; --accent:#d8694a; --ok:#5f9e6b;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
header{padding:18px 26px;border-bottom:1px solid var(--line);display:flex;flex-wrap:nowrap;
  align-items:center;gap:14px;background:var(--panel);position:sticky;top:0;z-index:9}
header h1{font-size:16px;margin:0;font-weight:600;letter-spacing:.5px}
header .sub{color:var(--dim);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header nav{margin-left:auto;display:flex;gap:8px;align-items:center}
header nav a,header nav button{color:var(--dim);text-decoration:none;padding:5px 12px;
  border-radius:6px;border:1px solid transparent;font-size:13px;background:transparent;
  cursor:pointer;font-family:inherit}
header nav a:hover,header nav button:hover{color:var(--text);border-color:var(--line)}
header nav a.on{color:var(--text);background:#252932;border-color:var(--line)}
main{padding:22px 26px 60px;max-width:1500px;margin:0 auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;
  overflow:hidden;transition:transform .12s,border-color .12s;position:relative;cursor:pointer}
.card:hover{transform:translateY(-2px);border-color:#4a5262;z-index:6}
.card a{color:inherit;text-decoration:none;display:block}
.cover{width:100%;aspect-ratio:3/4;object-fit:cover;background:#0e1014;display:block}
.cover-ph{width:100%;aspect-ratio:3/4;background:#0e1014;display:flex;
  align-items:center;justify-content:center;color:#333a47;font-size:12px}
.meta{padding:10px 12px 12px}
.title{font-size:13px;line-height:1.45;margin:0 0 6px;font-weight:500;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.row{display:flex;gap:8px;align-items:center;color:var(--dim);font-size:11.5px;flex-wrap:wrap}
.cat{background:#252932;padding:1px 7px;border-radius:3px;font-size:11px}
.rate{color:#d9a441;font-weight:600}
.tags{margin-top:7px;color:var(--dim);font-size:11px;line-height:1.5;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
/* 统计页 */
.statbar{display:flex;gap:14px;flex-wrap:wrap;margin:0 0 20px}
.statbar .k{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 18px;min-width:128px}
.statbar .k b{display:block;font-size:20px;color:var(--text);line-height:1.35}
.statbar .k span{color:var(--dim);font-size:11.5px}
.cols{display:grid;grid-template-columns:1fr 380px;gap:20px;align-items:start}
@media (max-width:980px){.cols{grid-template-columns:1fr}}
.box{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px}
.box h2{font-size:12.5px;margin:0 0 14px;color:var(--dim);font-weight:600;letter-spacing:.5px}
.bar{display:grid;grid-template-columns:1fr 42px;gap:8px;align-items:center;padding:3px 0;font-size:12.5px}
.bar .t{position:relative;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:2px 0}
.bar .fill{position:absolute;left:0;top:0;bottom:0;background:#2e3644;border-radius:3px;z-index:0}
.bar .t span.tx{position:relative;z-index:1}
.bar .c{color:var(--dim);font-size:11.5px;text-align:right}
.rank{display:inline-block;width:24px;color:#6d7381;font-size:11px;font-style:normal}
.artline{display:grid;grid-template-columns:24px 1fr auto;gap:8px;padding:6px 0;font-size:13px;border-bottom:1px solid #23272f}
.artline:last-child{border-bottom:none}
.artline .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.artline .c{color:var(--accent);font-weight:600;font-size:12px;white-space:nowrap}
.dlbadge{background:#1d3324;border:1px solid #2f5c3a;color:#9fd2a8;padding:0 6px;border-radius:3px;font-size:10.5px}
.notice{margin:0 0 18px;padding:12px 16px;border-radius:8px;background:#332b18;
  border:1px solid #6b552a;color:#e8c98a;font-size:13px;line-height:1.65}
.cardmenu{position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:6px;
  background:rgba(10,12,16,.72);color:#cfd3dc;border:1px solid #3a4150;font-size:15px;
  line-height:1;cursor:pointer;z-index:7;display:flex;align-items:center;justify-content:center;
  font-family:inherit;padding:0}
.cardmenu:hover{background:rgba(38,44,54,.95);color:#fff}
.tabs{display:flex;gap:6px}
.tabs .tab{padding:5px 14px;border-radius:6px;border:1px solid var(--line);color:var(--dim);
  text-decoration:none;font-size:12.5px;background:transparent}
.tabs .tab:hover{color:var(--text)}
.tabs .tab.on{background:#252932;border-color:#3a4150;color:var(--text)}
/* 推荐卡 */
.recgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.recgrid .rec{flex-direction:column;gap:12px}
.recgrid .reccover{width:100%}
.rec{display:flex;gap:20px;background:var(--panel);border:1px solid var(--line);
  border-radius:12px;padding:18px;max-width:880px;align-items:flex-start}
.reccover{width:210px;border-radius:8px;flex:0 0 auto;background:#0e1014}
.recbody{flex:1;min-width:0}
.rectitle{margin:0 0 8px;font-size:15px;line-height:1.5}
.recbrief{margin:0 0 10px;color:var(--dim);font-size:12.5px}
.rectags{margin:0 0 12px}
.rectags .tg{display:inline-block;background:#252932;border-radius:3px;padding:1px 6px;
  margin:2px 4px 0 0;font-size:11.5px;color:#98a0ae}
.recrow{display:flex;gap:8px;flex-wrap:wrap}
.recbtn{padding:7px 16px;border-radius:6px;background:var(--accent);color:#fff;
  text-decoration:none;font-size:12.5px;border:none;cursor:pointer;font-family:inherit}
.recbtn.ghost{background:transparent;border:1px solid var(--line);color:var(--text)}
.recwhy{margin:12px 0 0;color:#6d7381;font-size:11.5px}
/* 检索遮罩 */
.mask{position:fixed;inset:0;background:rgba(10,12,16,.78);display:none;align-items:center;
  justify-content:center;z-index:200;backdrop-filter:blur(2px)}
.mask.on{display:flex}
.maskbox{text-align:center;color:var(--text);font-size:14px}
.masksub{color:var(--dim);font-size:12px;margin-top:8px}
.spin{width:34px;height:34px;margin:0 auto 14px;border:3px solid #2b2f3a;border-top-color:var(--accent);
  border-radius:50%;animation:sp 900ms linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
/* 本地播放器 */
.pbar{position:fixed;top:0;left:0;right:0;height:52px;display:flex;align-items:center;gap:8px;
  padding:0 14px;background:var(--panel);border-bottom:1px solid var(--line);z-index:30}
.pbar button,.pbar a{padding:6px 12px;font-size:12.5px;border-radius:6px;background:#252932;
  color:var(--text);border:1px solid var(--line);cursor:pointer;text-decoration:none;font-family:inherit}
.pbar button:disabled{opacity:.35;cursor:default}
.pbar .ptitle{flex:1;color:var(--dim);font-size:12.5px;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;margin:0 6px}
.pages{padding:62px 0 40px;background:#0b0d11}
.pg{display:block;width:100%;max-width:920px;margin:0 auto 2px;background:#0e1014}
.pbox{position:fixed;left:50%;top:62px;transform:translateX(-50%);width:min(600px,92vw);max-height:72vh;
  overflow:auto;background:var(--panel);border:1px solid #3a4150;border-radius:10px;
  padding:14px 16px;z-index:40;display:none;box-shadow:0 14px 40px rgba(0,0,0,.55)}
.pbox.on{display:block}
.pbox h3{margin:0 0 10px;font-size:13px;color:var(--text)}
.pbox .row2{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}
.pbox .tg{display:inline-block;background:#252932;border-radius:3px;padding:1px 6px;
  margin:3px 4px 0 0;font-size:11.5px;color:#98a0ae}
.pbox button{padding:7px 14px;font-size:12.5px}
.pbox .danger{background:#7a3427}
.pbox .cap{color:var(--dim);font-size:11.5px;margin:0 0 10px;line-height:1.5}
/* 内置浏览页 */
.vbar{position:fixed;top:0;left:0;right:0;height:52px;display:flex;align-items:center;gap:10px;
  padding:0 16px;background:var(--panel);border-bottom:1px solid var(--line);z-index:20;font-size:13px}
.vbar .vt{color:var(--dim);font-size:12px;margin-right:auto}
.vbar button{padding:7px 16px;font-size:12.5px}
.vbar .vfav{background:#252932;color:var(--text);border:1px solid var(--line)}
.vbar .vfav.on{background:#3a2a44;border-color:#6d4a7d;color:#e0c8ea}
.vbar .vopen{color:var(--dim);text-decoration:none;padding:6px 10px;border:1px solid var(--line);border-radius:6px;font-size:12px}
#host{position:fixed;top:52px;left:0;right:0;bottom:0;background:#fff}
#host iframe,#host webview{width:100%;height:100%;border:none;display:flex;background:#fff}
.vhint{position:fixed;top:52px;left:0;right:0;padding:10px 16px;background:#332b1d;color:#d8c48a;
  font-size:12.5px;z-index:19;border-bottom:1px solid #4a3f28}
.empty{padding:70px 20px;text-align:center;color:var(--dim)}
.empty code{background:var(--panel);padding:2px 7px;border-radius:4px;color:var(--accent)}
form.panel{max-width:640px}
fieldset{border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin:0 0 18px;
  background:var(--panel)}
legend{padding:0 8px;color:var(--dim);font-size:12px;letter-spacing:.5px}
label.f{display:block;margin:0 0 14px}
label.f span{display:block;color:var(--dim);font-size:12px;margin-bottom:5px}
input[type=text],input[type=password],input[type=number],select{
  width:100%;padding:8px 10px;background:#0f1116;border:1px solid var(--line);
  border-radius:6px;color:var(--text);font-size:13px;font-family:inherit}
input:focus,select:focus{outline:none;border-color:var(--accent)}
.chk{display:flex;align-items:center;gap:9px;margin:0 0 12px;cursor:pointer}
.chk input{width:16px;height:16px;accent-color:var(--accent);cursor:pointer}
.chk span{color:var(--text);font-size:13px}
.hint{color:var(--dim);font-size:11.5px;margin:-6px 0 14px;line-height:1.5}
button{padding:9px 22px;background:var(--accent);border:none;border-radius:6px;
  color:#fff;font-size:13px;cursor:pointer;font-family:inherit}
button:hover{filter:brightness(1.1)}
.toast{padding:9px 14px;border-radius:6px;background:#1d3324;border:1px solid #2f5c3a;
  color:#9fd2a8;margin:0 0 18px;font-size:13px}
/* 悬停浮层：作者 + tag */
.tip{position:absolute;left:8px;right:8px;bottom:8px;padding:8px 10px;
  background:rgba(8,10,14,.94);border:1px solid #3a4150;border-radius:8px;
  font-size:11.5px;line-height:1.5;color:#c3c8d2;opacity:0;transform:translateY(5px);
  transition:opacity .14s,transform .14s;pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.45)}
.card:hover .tip{opacity:1;transform:translateY(0)}
.tip .au{color:#f0ece2;font-weight:600;margin-bottom:5px;font-size:12px}
.tip .tg span{display:inline-block;background:#252932;border-radius:3px;padding:0 5px;
  margin:2px 3px 0 0;color:#98a0ae;font-size:10.5px}
.tip .nu{color:#6d7381;font-size:10.5px;margin-top:5px}
/* 右键菜单 */
#ctx{position:fixed;display:none;background:#1c1f27;border:1px solid #3a4150;
  border-radius:8px;padding:6px;z-index:99;min-width:170px;
  box-shadow:0 10px 28px rgba(0,0,0,.5)}
#ctx button{display:block;width:100%;text-align:left;background:transparent;
  color:var(--text);border:none;padding:7px 10px;border-radius:5px;font-size:12.5px;
  cursor:pointer;font-family:inherit}
#ctx button:hover{background:#252932}
#ctx .danger{color:#e0805f}
#ctx .cap{padding:5px 10px 7px;font-size:11.5px;color:var(--dim);line-height:1.4}
#pop{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);display:none;
  padding:10px 18px;background:#1d3324;border:1px solid #2f5c3a;border-radius:8px;
  color:#9fd2a8;font-size:13px;z-index:120;box-shadow:0 8px 24px rgba(0,0,0,.45)}
`

function page(title, body, active = '', extraHead = '') {
  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<base href="/dsh-ehentai/">
<title>${esc(title)} · dsh-jmcomic/ehentai</title><style>${CSS}</style>${extraHead}</head><body>
<header>
  <h1>dsh-jmcomic/ehentai</h1>
  <span class="sub">dsh-ehentai · b1108a</span><span class="sub" id="dbg" style="color:#7d8590"></span>
  <nav>
    <a href="./jm" class="${active === 'jm' ? 'on' : ''}">JM 收藏</a>
    <a href="./eh" class="${active === 'fav' ? 'on' : ''}">E 站收藏</a>
    <a href="./recommend" class="${active === 'rec' ? 'on' : ''}">推荐</a>
    <a href="./explore" class="${active === 'explore' ? 'on' : ''}">检索</a>
    <a href="./jm/stats" class="${active === 'stats' ? 'on' : ''}">词条统计</a>
    <a href="./" class="${active === 'panel' ? 'on' : ''}">设置</a>
  </nav>
</header>
<main>${body}</main></body></html>`
}

/** E 站收藏页 */
export function renderCollection(rows, opt = {}) {
  const { showFavorites = true, hasCookie = false, openMode = 'os', showNotice = false } = opt
  const artistOf = (tags) => {
    const m = /artist:\s*([^,]+)/i.exec(String(tags || ''))
    return m ? m[1].trim() : ''
  }

  if (!showFavorites) {
    return page('收藏', `<div class="empty">
      <p>收藏夹显示已关闭。</p>
      <p style="margin-top:14px">到 <a href="./panel" style="color:var(--accent)">设置</a> 里打开。</p>
    </div>`, 'fav')
  }
  if (!rows.length) {
    return page('收藏', `<div class="empty">
      <p>本地还没有 E 站收藏数据。</p>
      <p style="margin-top:14px">
        ${hasCookie
          ? '让助手说一句「同步收藏」即可导入。'
          : '先在 <a href="./panel" style="color:var(--accent)">设置</a> 里填好 ExHentai cookie，再同步收藏。'}
      </p>
    </div>`, 'fav')
  }

  const cards = rows
    .map((r) => {
      const url = galleryUrl(r.gid, r.token)
      const target = openMode === 'dsh' ? ('./ehview?gid=' + r.gid + '&token=' + r.token) : url
      const cover = r.thumb
        ? `<img class="cover" loading="lazy" src="./thumb?u=${encodeURIComponent(r.thumb)}" alt="">`
        : `<div class="cover-ph">无封面</div>`
      const tags = r.tags
        ? `<div class="tags">${esc(String(r.tags).split(', ').slice(0, 6).join(' · '))}</div>`
        : ''
      return `<article class="card" data-url="${esc(url)}" data-author="${esc(artistOf(r.tags))}" data-title="${esc(r.title)}">
        <a class="hit" href="${esc(target)}" target="_blank" rel="noreferrer">
        ${cover}
        <div class="meta">
          <h3 class="title">${esc(r.title)}</h3>
          <div class="row">
            ${r.category ? `<span class="cat">${esc(r.category)}</span>` : ''}
            ${r.rating ? `<span class="rate">★ ${Number(r.rating).toFixed(2)}</span>` : ''}
            ${r.filecount ? `<span>${r.filecount} 页</span>` : ''}
          </div>
          ${tags}
        </div></a>
        <button class="cardmenu" type="button" title="更多操作">⋯</button></article>`
    })
    .join('')

  const notice = showNotice
    ? '<div class="notice">由于铸币开发者没有搞到能进里站的账号，exhentai 连接可能出现问题，自己去跟大肥鱼商量就好了（</div>'
    : ''
  const body = `${notice}<div class="grid">${cards}</div>
<div id="ctx"></div>
<div id="pop" style="position:fixed;left:50%;bottom:26px;transform:translateX(-50%);display:none;padding:10px 18px;background:#1d3324;border:1px solid #2f5c3a;border-radius:8px;color:#9fd2a8;font-size:13px;z-index:120"></div>
<script>
(function(){
  var ctx = document.getElementById('ctx');
  var pop = document.getElementById('pop');
  var cur = null;
  var pendingUnfav = false;
  function toast(m, ms){
    pop.textContent = m; pop.style.display = 'block';
    clearTimeout(pop._t);
    pop._t = setTimeout(function(){ pop.style.display = 'none'; }, ms || 2600);
  }
  function openMenu(el, x, y){
    {
      cur = el.dataset;
      pendingUnfav = false;
      ctx.innerHTML = '<div class="cap">E站</div>'
        + '<button data-a="open">打开</button>'
        + '<button data-a="artist">查作者的其他作品</button>'
        + '<button data-a="dl" class="danger">下载到本地</button>'
        + '<button data-a="unfav" class="danger">取消收藏</button>'
        + '<button data-a="copy">复制链接</button>';
      ctx.style.left = Math.max(8, Math.min(x, innerWidth - 200)) + 'px';
      ctx.style.top = Math.max(8, Math.min(y, innerHeight - 150)) + 'px';
      ctx.style.display = 'block';
    }
  }
  document.querySelectorAll('.card').forEach(function(el){
    el.addEventListener('contextmenu', function(e){ e.preventDefault(); openMenu(el, e.clientX, e.clientY) });
  });
  document.addEventListener('contextmenu', function(e){
    var el = e.target && e.target.closest ? e.target.closest('.card[data-url]') : null;
    if (el) { e.preventDefault(); openMenu(el, e.clientX, e.clientY) }
  });
  document.querySelectorAll('.cardmenu').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.preventDefault();
      e.stopPropagation();
      var card = btn.closest('.card');
      if (!card) return;
      var r = btn.getBoundingClientRect();
      openMenu(card, r.right - 190, r.bottom + 6);
    });
  });
  ctx.addEventListener('click', function(e){
    var a = e.target.getAttribute('data-a');
    if (!a) return;
    if (!(a === 'unfav' && !pendingUnfav)) ctx.style.display = 'none';
    if (a === 'open') { window.open(cur.url, '_blank', 'noopener'); return; }
    if (a === 'copy') {
      if (navigator.clipboard) navigator.clipboard.writeText(cur.url).then(function(){ toast('链接已复制'); });
      else toast(cur.url, 6000);
      return;
    }
    if (a === 'artist') {
      var au = (cur.author || '').trim();
      if (!au) { toast('这本没有 artist 标签'); return; }
      window.open('https://e-hentai.org/?f_search=' + encodeURIComponent('artist:"' + au + '"'), '_blank', 'noopener');
      return;
    }
    if (a === 'unfav') {
      if (!pendingUnfav) {
        pendingUnfav = true;
        e.target.textContent = '再点一次 · 同时删本地文件';
        e.target.style.color = '#ff9b8a';
        return;
      }
      pendingUnfav = false;
      var seg = String(cur.url || '').split('/');
      var gi = seg.indexOf('g');
      var gid = seg[gi + 1] || '';
      var tok = seg[gi + 2] || '';
      if (!gid || !tok) { toast('解析不出 gid'); return; }
      toast('正在取消…', 6000);
      fetch('./eh/fav', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gid: gid, token: tok, action: 'remove' })
      }).then(function(r){ return r.json(); }).then(function(j){
        toast(j.msg || (j.ok ? '已取消' : '失败'), 5000);
        if (j.ok) setTimeout(function(){ location.reload(); }, 1500);
      }).catch(function(){ toast('请求失败', 4000); });
      return;
    }
    if (a === 'dl') {
      toast('已开始下载，正在取图…', 8000);
      fetch('./eh/download', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: cur.url })
      }).then(function(r){ return r.json(); }).then(function(j){
        toast(j.ok ? j.msg : ('没能开始：' + j.msg), 6000);
      }).catch(function(){ toast('下载请求失败', 4000); });
    }
  });
  document.addEventListener('click', function(e){
    if (ctx && !ctx.contains(e.target)) ctx.style.display = 'none';
  });
  var dbg = document.getElementById('dbg');
  if (dbg) { var n = document.querySelectorAll('.card').length; dbg.textContent = n ? ('· 就绪 ' + n) : ''; }
})();
</script>`

  return page('收藏', body, 'fav')
}
/** JM 收藏页：封面 + 名字 + 悬停作者/tag + 左键打开 + 右键下载 */
export function renderJm(data, opt = {}) {
  const { root = '', webDomain = '18comic.vip', openMode = 'os', downloads = {} } = opt
  const items = data.items || []
  if (!items.length) {
    return page('JM 收藏', `<div class="empty">
      <p>本地还没有 JM 收藏数据。</p>
      <p style="margin-top:14px">在 <a href="./panel" style="color:var(--accent)">设置</a> 里填好 JM 账号，然后点上面的「刷新」。</p>
    </div>`, 'jm')
  }

  const upd = data.updatedAt ? new Date(data.updatedAt).toLocaleString('zh-CN') : '—'
  const cards = items
    .map((it) => {
      const url = `https://${webDomain}/album/${it.id}/`
      const rec = downloads[it.id]
      const dl = rec && (rec.pages || 0) > 0 ? rec : null
      const target = dl
        ? `./player?id=${it.id}`
        : (openMode === 'dsh' ? `./view?id=${it.id}` : url)
      const tags = (it.tags || []).slice(0, 12)
      const tagHtml = tags.length
        ? tags.map((t) => `<span>${esc(t)}</span>`).join('')
        : '<span>无 tag</span>'
      return `<article class="card" data-id="${esc(it.id)}" data-url="${esc(url)}"
        data-target="${esc(target)}" data-title="${esc(it.title)}"
        data-author="${esc(it.author || '')}">
        <a class="hit" href="${esc(target)}" target="_blank" rel="noreferrer">
        <img class="cover" loading="lazy" src="./cover?id=${esc(it.id)}" alt="">
        <div class="meta">
          <h3 class="title">${esc(it.title)}</h3>
          <div class="row">
            <span class="cat">JM${esc(it.id)}</span>
            ${dl ? '<span class="dlbadge">本地</span>' : ''}
            ${it.author ? `<span>${esc(it.author)}</span>` : ''}
          </div>
        </div>
        </a>
        <div class="tip">
          <div class="au">${esc(it.author || '未知作者')}</div>
          <div class="tg">${tagHtml}</div>
          <div class="nu">♥ ${Number(it.likes || 0).toLocaleString()} · 浏览 ${Number(it.views || 0).toLocaleString()}</div>
        </div>
      </article>`
    })
    .join('')

  const body = `
<div style="display:flex;align-items:center;gap:14px;margin:0 0 18px;color:var(--dim);font-size:12.5px">
  <span>共 <b style="color:var(--text)">${items.length}</b> 本</span>
  <span>数据更新：${esc(upd)}</span>
  <span>下载目录：<code style="color:var(--accent)">${esc(root)}</code></span>
  <button id="btnRefresh" style="margin-left:auto;padding:6px 14px;font-size:12.5px">刷新数据</button>
</div>
<div class="grid">${cards}</div>
<div id="ctx"></div>
<div id="pop"></div>
<script>
(function(){
  var ctx = document.getElementById('ctx');
  var pop = document.getElementById('pop');
  var cur = null;

  function openUrl(u){
    var a = document.createElement('a');
    a.href = u; a.target = '_blank'; a.rel = 'noreferrer';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function toast(msg, ms){
    pop.textContent = msg;
    pop.style.display = 'block';
    clearTimeout(pop._t);
    pop._t = setTimeout(function(){ pop.style.display = 'none'; }, ms || 2600);
  }

  function menu(stage){
    if(stage === 'main'){
      ctx.innerHTML = '<div class="cap">JM' + cur.id + '</div>'
        + '<button data-a="open">打开</button>'
        + '<button data-a="site">在浏览器打开原网页</button>'
        + '<button data-a="author">查作者的其他作品</button>'
        + '<button data-a="dl" class="danger">下载到本地</button>';
    } else {
      ctx.innerHTML = '<div class="cap">确定要下载这本吗？<br>再点一下才会开始。</div>'
        + '<button data-a="go" class="danger">确认下载</button>'
        + '<button data-a="cancel">算了</button>';
    }
  }

  document.querySelectorAll('.card').forEach(function(el){
    el.addEventListener('contextmenu', function(e){
      e.preventDefault();
      cur = el.dataset;
      menu('main');
      var x = Math.min(e.clientX, innerWidth - 200);
      var y = Math.min(e.clientY, innerHeight - 130);
      ctx.style.left = x + 'px';
      ctx.style.top = y + 'px';
      ctx.style.display = 'block';
    });
  });

  ctx.addEventListener('click', function(e){
    var a = e.target.getAttribute('data-a');
    if(!a) return;
    if(a === 'open'){ openUrl(cur.target || cur.url); ctx.style.display = 'none'; }
    else if(a === 'site'){ openUrl(cur.url); ctx.style.display = 'none'; }
    else if(a === 'author'){
      ctx.style.display = 'none';
      var au = (cur.author || '').trim();
      if(!au){ toast('这本没有作者信息', 3000); return; }
      toast('正在查询「' + au + '」的作品，稍等…', 60000);
      fetch('./jm/author', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ author: au })
      }).then(function(r){ return r.json(); }).then(function(j){
        if(!j.ok){ toast(j.msg || '查询失败', 4000); return; }
        var timer = setInterval(function(){
          fetch('./explore/status').then(function(r){ return r.json(); }).then(function(s){
            if(s.status === 'done'){
              clearInterval(timer);
              location.href = './explore?sort=latest&t=' + Date.now();
            } else if(s.status === 'error'){
              clearInterval(timer);
              toast('查询失败：' + String(s.log || '').slice(-120), 6000);
            }
          });
        }, 1500);
      }).catch(function(){ toast('请求失败', 3000); });
    }
    else if(a === 'dl'){ menu('confirm'); }
    else if(a === 'cancel'){ ctx.style.display = 'none'; }
    else if(a === 'go'){
      ctx.style.display = 'none';
      toast('开始下载 JM' + cur.id + ' …', 4000);
      fetch('./jm/download', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body: JSON.stringify({ id: cur.id })
      }).then(function(r){ return r.json(); }).then(function(j){
        toast(j.ok ? (j.msg + ' → ' + j.root) : ('没能开始：' + j.msg), 5000);
      }).catch(function(){ toast('下载请求失败', 4000); });
    }
  });

  document.addEventListener('click', function(e){
    if(!ctx.contains(e.target)) ctx.style.display = 'none';
  });
  document.addEventListener('scroll', function(){ ctx.style.display = 'none'; }, true);

  var btn = document.getElementById('btnRefresh');
  if(btn) btn.addEventListener('click', function(){
    btn.disabled = true; btn.textContent = '刷新中…';
    fetch('./jm/refresh', { method:'POST' }).then(function(r){ return r.json(); })
      .then(function(j){ toast(j.msg, 5000); if(j.ok) setTimeout(function(){ location.reload(); }, 6000); })
      .catch(function(){ toast('刷新失败', 4000); })
      .finally(function(){ btn.disabled = false; btn.textContent = '刷新数据'; });
  });
})();
</script>`

  return page('JM 收藏', body, 'jm')
}

/** 本地播放器：上下滚动翻页，顶部一排操作 */
export function renderPlayer(opt = {}) {
  const {
    id = '', title = '', items = [], index = -1, images = [],
    dir = '', webDomain = '18comic.vip', tags = [],
  } = opt

  const prevId = index > 0 ? items[index - 1].id : null
  const nextId = index >= 0 && index < items.length - 1 ? items[index + 1].id : null
  const siteUrl = 'https://' + webDomain + '/album/' + id + '/'

  const pageImgs = images
    .map((n, i) => '<img class="pg" loading="lazy" data-n="' + (i + 1) + '" src="./local?id='
      + encodeURIComponent(id) + '&n=' + encodeURIComponent(n) + '" alt="' + (i + 1) + '">')
    .join('')

  const tagHtml = tags.length
    ? tags.map((t) => '<span class="tg">' + esc(t) + '</span>').join('')
    : '<span class="tg">没有 tag</span>'

  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<base href="/dsh-ehentai/">
<title>JM${esc(id)}</title><style>${CSS}</style></head><body>
<div class="pbar">
  <button id="prev" ${prevId ? '' : 'disabled'}>‹ 上一本</button>
  <button id="next" ${nextId ? '' : 'disabled'}>下一本 ›</button>
  <span class="ptitle">${esc(title || 'JM' + id)}</span>
  <button id="site">查看网站</button>
  <button id="tagbtn">查看 tag</button>
  <button id="cfg">设置</button>
</div>

<div class="pages">${pageImgs || '<p style="color:#8b8f9a;text-align:center;padding:60px 20px">这本还没有本地图片，点右边「下载」或先去列表下载。</p>'}</div>

<div class="pbox" id="tagbox">
  <h3>全部 tag（${tags.length}）</h3>
  <p class="cap">这里列出原始 tag，包含词条统计里被当作「无关」剔掉的那几类。</p>
  <div>${tagHtml}</div>
</div>

<div class="pbox" id="cfgbox">
  <h3>这本的操作</h3>
  <p class="cap">JM${esc(id)} · ${images.length} 页<br>${esc(dir || '（未下载）')}</p>
  <div class="row2">
    <button id="btnRe">重新下载</button>
    <button id="btnDel" class="danger">删除缓存</button>
    <button id="btnUnfav" class="danger">取消收藏</button>
  </div>
  <p class="cap">取消收藏会一并删掉本地缓存。下载走队列，一次只下一本。</p>
</div>

<div id="pop" style="position:fixed;left:50%;bottom:26px;transform:translateX(-50%);display:none;padding:10px 18px;background:#1d3324;border:1px solid #2f5c3a;border-radius:8px;color:#9fd2a8;font-size:13px;z-index:120"></div>
<script>
(function(){
  var id = ${JSON.stringify(String(id))};
  var prevId = ${JSON.stringify(prevId)};
  var nextId = ${JSON.stringify(nextId)};
  var siteUrl = ${JSON.stringify(siteUrl)};
  var pop = document.getElementById('pop');
  var tagbox = document.getElementById('tagbox');
  var cfgbox = document.getElementById('cfgbox');

  function toast(m, ms){
    pop.textContent = m; pop.style.display = 'block';
    clearTimeout(pop._t);
    pop._t = setTimeout(function(){ pop.style.display = 'none'; }, ms || 2800);
  }
  function toggle(box){
    var willShow = !box.classList.contains('on');
    tagbox.classList.remove('on'); cfgbox.classList.remove('on');
    if (willShow) box.classList.add('on');
  }
  function go(pid){ if (pid) location.href = './player?id=' + encodeURIComponent(pid); }

  document.getElementById('prev').addEventListener('click', function(){ go(prevId); });
  document.getElementById('next').addEventListener('click', function(){ go(nextId); });
  document.getElementById('site').addEventListener('click', function(){
    window.open(siteUrl, '_blank', 'noopener');
  });
  document.getElementById('tagbtn').addEventListener('click', function(){ toggle(tagbox); });
  document.getElementById('cfg').addEventListener('click', function(){ toggle(cfgbox); });

  function manage(action){
    fetch('./jm/manage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: id, action: action })
    }).then(function(r){ return r.json(); }).then(function(j){
      toast(j.msg || (j.ok ? '完成' : '失败'), 4000);
      if (j.ok && (action === 'delcache' || action === 'unfav')) {
        setTimeout(function(){ location.href = './jm'; }, 1400);
      }
      if (j.ok && action === 'redownload') {
        setTimeout(function(){ location.reload(); }, 2500);
      }
    }).catch(function(){ toast('请求失败', 3000); });
  }
  document.getElementById('btnRe').addEventListener('click', function(){ manage('redownload'); });
  document.getElementById('btnDel').addEventListener('click', function(){
    if (confirm('删除这本的本地缓存？')) manage('delcache');
  });
  document.getElementById('btnUnfav').addEventListener('click', function(){
    if (confirm('取消收藏并删除本地缓存？')) manage('unfav');
  });

  // 键盘：上下 / 空格滚一屏
  document.addEventListener('keydown', function(e){
    if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
      window.scrollBy({ top: innerHeight * 0.92, behavior: 'smooth' }); e.preventDefault();
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      window.scrollBy({ top: -innerHeight * 0.92, behavior: 'smooth' }); e.preventDefault();
    } else if (e.key === 'ArrowLeft') { go(prevId); }
    else if (e.key === 'ArrowRight') { go(nextId); }
  });
})();
</script>
</body></html>`
}

/** E 站内置浏览页：顶栏同样带收藏 / 下载 */
export function renderEhView(gid, token, opt = {}) {
  const { favorited = false } = opt
  const safeG = String(gid || '').replace(/[^\d]/g, '')
  const safeT = String(token || '').replace(/[^0-9a-z]/gi, '')
  const src = 'https://e-hentai.org/g/' + safeG + '/' + safeT + '/'

  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<base href="/dsh-ehentai/">
<title>E站${esc(safeG)}</title><style>${CSS}</style></head><body>
<div class="vbar">
  <span class="vt">E站 ${esc(safeG)}</span>
  <button id="btnFav" class="vfav ${favorited ? 'on' : ''}">${favorited ? '已收藏' : '收藏'}</button>
  <button id="btnDl" class="vdl">下载</button>
  <a class="vopen" href="${esc(src)}" target="_blank" rel="noreferrer">外部打开</a>
  <a class="vopen" href="./eh">返回列表</a>
</div>
<div id="host"></div>
<div id="pop" style="position:fixed;left:50%;bottom:26px;transform:translateX(-50%);display:none;padding:10px 18px;background:#1d3324;border:1px solid #2f5c3a;border-radius:8px;color:#9fd2a8;font-size:13px;z-index:120"></div>
<script>
(function(){
  var gid = ${JSON.stringify(safeG)};
  var token = ${JSON.stringify(safeT)};
  var src = ${JSON.stringify(src)};
  var fav = ${favorited ? 'true' : 'false'};

  (function(){
    var host = document.getElementById('host');
    var wv = document.createElement('webview');
    if (typeof wv.loadURL === 'function') {
      wv.setAttribute('src', src);
      wv.setAttribute('allowpopups', '');
      host.appendChild(wv);
    } else {
      var f = document.createElement('iframe');
      f.setAttribute('src', src);
      f.setAttribute('referrerpolicy', 'no-referrer');
      host.appendChild(f);
    }
  })();

  var pop = document.getElementById('pop');
  function toast(m, ms){
    pop.textContent = m; pop.style.display = 'block';
    clearTimeout(pop._t);
    pop._t = setTimeout(function(){ pop.style.display = 'none'; }, ms || 2600);
  }
  var bf = document.getElementById('btnFav');
  bf.addEventListener('click', function(){
    var want = !fav;
    bf.disabled = true;
    fetch('./eh/fav', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gid: gid, token: token, action: want ? 'add' : 'remove' })
    }).then(function(r){ return r.json(); }).then(function(j){
      bf.disabled = false;
      if (!j.ok) { toast(j.msg || '操作失败', 3500); return; }
      fav = want;
      bf.textContent = fav ? '已收藏' : '收藏';
      bf.className = 'vfav' + (fav ? ' on' : '');
      toast(j.msg, 2000);
    }).catch(function(){ bf.disabled = false; toast('请求失败', 3000); });
  });
  document.getElementById('btnDl').addEventListener('click', function(){
    toast('已开始下载，正在取图…', 8000);
    fetch('./eh/download', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: src })
    }).then(function(r){ return r.json(); }).then(function(j){
      toast(j.ok ? j.msg : ('没能开始：' + j.msg), 6000);
    }).catch(function(){ toast('下载请求失败', 4000); });
  });
})();
</script>
</body></html>`
}

/** 内置浏览页：顶部有收藏 / 下载 */
export function renderView(id, opt = {}) {
  const { webDomain = '18comic.vip', favorited = false } = opt
  const safeId = String(id || '').replace(/[^\d]/g, '')
  const src = 'https://' + webDomain + '/album/' + safeId + '/'

  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<base href="/dsh-ehentai/">
<title>JM${esc(safeId)}</title><style>${CSS}</style></head><body>
<div class="vbar">
  <span class="vt">JM${esc(safeId)}</span>
  <button id="btnFav" class="vfav ${favorited ? 'on' : ''}">${favorited ? '已收藏' : '收藏'}</button>
  <button id="btnDl" class="vdl">下载</button>
  <a class="vopen" href="${esc(src)}" target="_blank" rel="noreferrer">外部打开</a>
  <a class="vopen" href="./jm">返回列表</a>
</div>
<div id="host"></div>
<div id="pop" style="position:fixed;left:50%;bottom:26px;transform:translateX(-50%);display:none;padding:10px 18px;background:#1d3324;border:1px solid #2f5c3a;border-radius:8px;color:#9fd2a8;font-size:13px;z-index:120"></div>
<script>
(function(){
  var id = ${JSON.stringify(safeId)};
  var fav = ${favorited ? 'true' : 'false'};

  // 优先用 Electron 的 webview（真实浏览器视图，不受 X-Frame-Options 限制），
  // 环境不支持时退回 iframe。
  (function(){
    var host = document.getElementById('host');
    var src = ${JSON.stringify(src)};
    var wv = document.createElement('webview');
    if (typeof wv.loadURL === 'function') {
      wv.setAttribute('src', src);
      wv.setAttribute('allowpopups', '');
      host.appendChild(wv);
    } else {
      var f = document.createElement('iframe');
      f.setAttribute('src', src);
      f.setAttribute('referrerpolicy', 'no-referrer');
      host.appendChild(f);
    }
  })();
  var pop = document.getElementById('pop');
  function toast(m, ms){
    pop.textContent = m; pop.style.display = 'block';
    clearTimeout(pop._t);
    pop._t = setTimeout(function(){ pop.style.display = 'none'; }, ms || 2600);
  }
  var bf = document.getElementById('btnFav');
  bf.addEventListener('click', function(){
    var want = !fav;
    bf.disabled = true;
    fetch('./jm/fav', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: id, action: want ? 'add' : 'remove' })
    }).then(function(r){ return r.json(); }).then(function(j){
      bf.disabled = false;
      if(!j.ok){ toast(j.msg || '操作失败', 3500); return; }
      fav = want;
      bf.textContent = fav ? '已收藏' : '收藏';
      bf.className = 'vfav' + (fav ? ' on' : '');
      toast(j.msg, 2000);
    }).catch(function(){ bf.disabled = false; toast('请求失败', 3000); });
  });
  document.getElementById('btnDl').addEventListener('click', function(){
    toast('开始下载 JM' + id + ' …', 4000);
    fetch('./jm/download', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: id })
    }).then(function(r){ return r.json(); }).then(function(j){
      toast(j.ok ? (j.msg + ' → ' + j.root) : ('没能开始：' + j.msg), 5000);
    }).catch(function(){ toast('下载请求失败', 4000); });
  });
})();
</script>
</body></html>`
}

/** 推荐页 */
export function renderRecommend(opt = {}) {
  const { webDomain = '18comic.vip', autoOpen = true } = opt
  const body = `
<div style="display:flex;gap:10px;margin:0 0 20px;flex-wrap:wrap;align-items:center">
  <label class="chk" style="margin:0"><span>数量</span>
    <input type="number" id="count" min="1" max="15" value="3" style="width:66px"></label>
  <button id="btnTaste" style="padding:9px 20px">按口味推荐</button>
  <button id="btnRandom" style="padding:9px 20px;background:#39404e">收藏里随机翻</button>
  <label class="chk" style="margin:0"><input type="checkbox" id="autoOpenCk" ${autoOpen ? 'checked' : ''}>
    <span>只推 1 本时自动打开内置窗口</span></label>
  <span id="msg" style="color:var(--dim);font-size:12.5px"></span>
</div>
<div id="out" class="recgrid"></div>
<script>
(function(){
  var out = document.getElementById('out');
  var msg = document.getElementById('msg');
  var auto = document.getElementById('autoOpenCk');
  var cnt = document.getElementById('count');
  var WEB = ${JSON.stringify(webDomain)};

  function esc(s){
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function wantCount(){
    var n = parseInt(cnt.value, 10);
    if (!n || n < 1) n = 1;
    if (n > 15) n = 15;
    cnt.value = n;
    return n;
  }
  function setBusy(on){
    document.getElementById('btnTaste').disabled = on;
    document.getElementById('btnRandom').disabled = on;
  }
  function run(mode){
    var n = wantCount();
    msg.textContent = mode === 'random'
      ? ('翻牌中…要 ' + n + ' 本')
      : ('按口味搜集中（首次会抓详情，稍等）…要 ' + n + ' 本');
    setBusy(true);
    fetch('./recommend/run', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: mode, count: n })
    }).then(function(r){
      return r.text().then(function(t){
        try { return JSON.parse(t) }
        catch (e) { throw new Error('返回不是 JSON（HTTP ' + r.status + '）：' + t.slice(0, 120)) }
      });
    }).then(function(j){
      setBusy(false);
      if (!j.ok) { msg.textContent = j.msg || '没有推荐出来'; return; }
      msg.textContent = '已推荐 ' + j.items.length + ' 本';
      show(j);
      if (auto.checked && j.items.length === 1) {
        setTimeout(function(){
          var w = window.open('./view?id=' + j.items[0].id, '_blank');
          try { window.focus() } catch (e) {}
          if (w) { try { w.blur() } catch (e) {} }
        }, 600);
      }
    }).catch(function(e){
      setBusy(false);
      msg.textContent = '请求失败：' + (e && e.message ? e.message : '未知原因');
    });
  }
  function card(it){
    var tags = (it.tags || []).map(function(t){ return '<span class="tg">' + esc(t) + '</span>' }).join('');
    return '<article class="rec">'
      + '<img class="reccover" referrerpolicy="no-referrer" src="./cover?id=' + esc(it.id) + '" alt="">'
      + '<div class="recbody">'
      + '<h3 class="rectitle">' + esc(it.title) + '</h3>'
      + '<p class="recbrief">' + esc(it.brief || '') + '</p>'
      + '<div class="rectags">' + tags + '</div>'
      + '<div class="recrow">'
      + '<a class="recbtn" href="./view?id=' + esc(it.id) + '" target="_blank">打开内置页</a>'
      + '<a class="recbtn ghost" href="https://' + esc(WEB) + '/album/' + esc(it.id) + '/" target="_blank" rel="noreferrer">原网页</a>'
      + '</div></div></article>';
  }
  function show(j){
    var items = (j.items || []).map(function(it){
      return Object.assign({}, it, { brief: it.brief || j.brief || '' });
    });
    out.innerHTML = items.map(card).join('')
      + '<p class="recwhy" style="grid-column:1/-1">' + esc(j.reason || '') + '</p>';
  }
  document.getElementById('btnTaste').addEventListener('click', function(){ run('taste'); });
  document.getElementById('btnRandom').addEventListener('click', function(){ run('random'); });
})();
</script>`
  return page('推荐', body, 'rec')
}
/** 检索页 */
export function renderExplore(opt = {}) {
  const {
    raw = null, ranked = { items: [], skipped: [] }, query = '',
    downloads = {}, openMode = 'os', webDomain = '18comic.vip', sort = 'match', strict = true,
    ignoredWords = [],
  } = opt
  const items = ranked.items || []
  const fmtDate = (v) => {
    const n = Number(v)
    if (!n) return ''
    try { return new Date(n * 1000).toLocaleDateString('zh-CN') } catch { return '' }
  }
  const cards = items.map((it) => {
    const reasons = (it.reasons || []).join(' · ')
    const rec = downloads[it.id]
    const hasLocal = rec && (rec.pages || 0) > 0
    const href = hasLocal
      ? './player?id=' + it.id
      : (openMode === 'dsh' ? './view?id=' + it.id : 'https://' + webDomain + '/album/' + it.id + '/')
    return '<article class="card" data-id="' + esc(it.id) + '" data-target="' + esc(href) + '" data-site="https://' + esc(webDomain) + '/album/' + esc(it.id) + '/">'
      + '<a class="hit" href="' + esc(href) + '" target="_blank" rel="noreferrer">'
      + '<img class="cover" loading="lazy" src="./cover?id=' + esc(it.id) + '" alt="">'
      + '<div class="meta">'
      + '<h3 class="title">' + esc(it.title) + '</h3>'
      + '<div class="row"><span class="cat">JM' + esc(it.id) + '</span>'
      + (sort === 'match'
        ? '<span class="rate">' + (it.score || 0) + '</span>'
        : '<span>' + (it.likes || 0) + ' 赞</span>')
      + '<span>' + (it.pages || 0) + ' 页</span>'
      + (sort === 'latest' && fmtDate(it.update) ? '<span>' + fmtDate(it.update) + '</span>' : '')
      + '</div>'
      + '<div class="tags">' + esc(it.author || '')
      + (sort === 'match'
        ? (reasons ? ' · ' + esc(reasons) : '')
        : ' · ' + esc((it.tags || []).slice(0, 4).join(' / ')))
      + '</div>'
      + '</div></a></article>'
  }).join('')

  const stats = raw
    ? '<div class="statbar">'
      + '<div class="k"><b>' + raw.candidates + '</b><span>候选</span></div>'
      + '<div class="k"><b>' + items.length + '</b><span>入选</span></div>'
      + '<div class="k"><b>' + (ranked.skipped || []).length + '</b><span>淘汰</span></div>'
      + '<div class="k"><b>' + (raw.cacheSize || 0) + '</b><span>详情缓存</span></div>'
      + '<div class="k"><b>' + (raw.fetched || 0) + '</b><span>本次补抓</span></div>'
      + '</div>'
    : ''

  const body = `
<form class="panel" style="max-width:920px;margin-bottom:20px">
  <fieldset>
    <legend>检索条件</legend>
    <label class="f"><span>关键词 / tag（空格分隔，多个取交集）</span>
      <input type="text" id="q" value="${esc(query)}" placeholder="全彩 校服"></label>
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      <label class="f" style="flex:1;min-width:140px"><span>搜索页数</span>
        <input type="number" id="pages" min="1" max="10" value="3"></label>
      <label class="f" style="flex:1;min-width:140px"><span>本次补抓详情上限</span>
        <input type="number" id="maxDetail" min="0" max="300" value="60"></label>
      <label class="f" style="flex:1;min-width:140px"><span>最小页数</span>
        <input type="number" id="minPages" min="0" value="12"></label>
    </div>
    <label class="chk"><input type="checkbox" id="noAi" checked><span>剔除 AI 作画（AI 翻译不算）</span></label>
    <label class="chk"><input type="checkbox" id="strict" ${strict ? 'checked' : ''}><span>严格匹配查询词（标签里没有对应词的一律不要）</span></label>
    <div style="display:flex;align-items:center;gap:12px">
      <button id="go" type="button">开始检索</button>
      <span id="st" style="color:var(--dim);font-size:12.5px"></span>
    </div>
    <p class="hint">详情有本地缓存，同一批候选第二次起不再请求站点。第一次会慢一些，补抓上限就是这轮最多抓几本。</p>
  </fieldset>
</form>
<div style="display:flex;align-items:center;gap:12px;margin:0 0 14px;flex-wrap:wrap">
  <span id="sum" style="font-size:13.5px;color:var(--dim)">${raw ? ('已检索到 <b style="color:var(--text)">' + items.length + '</b> 本，' + (sort === 'latest' ? '按发布时间排序' : sort === 'hot' ? '按热度排序' : '按喜好拟合排序')) : '还没有检索结果'}</span>
  ${(ignoredWords && ignoredWords.length) ? '<span style="font-size:12px;color:#d8a15a">「' + esc(ignoredWords.join('、')) + '」本地标签和标题里都没出现，这个词没参与校验</span>' : ''}
  <div class="tabs" style="margin-left:auto">
    <a class="tab ${sort === 'latest' ? 'on' : ''}" href="./explore?sort=latest&strict=${strict ? '1' : '0'}&t=${Date.now()}">最新</a>
    <a class="tab ${sort === 'hot' ? 'on' : ''}" href="./explore?sort=hot&strict=${strict ? '1' : '0'}&t=${Date.now()}">最热</a>
    <a class="tab ${sort === 'match' ? 'on' : ''}" href="./explore?sort=match&strict=${strict ? '1' : '0'}&t=${Date.now()}">按喜好</a>
  </div>
</div>
${stats}
<div class="grid">${cards}</div>
<div id="mask" class="mask"><div class="maskbox"><div class="spin"></div><div id="maskText">正在检索…</div><div class="masksub">首次会逐本抓详情，之后有缓存</div></div></div>
<div id="ctx"></div>
<div id="pop" style="position:fixed;left:50%;bottom:26px;transform:translateX(-50%);display:none;padding:10px 18px;background:#1d3324;border:1px solid #2f5c3a;border-radius:8px;color:#9fd2a8;font-size:13px;z-index:120"></div>
<script>
(function(){
  var SORT = ${JSON.stringify(sort)};
  var STRICT = ${strict ? 'true' : 'false'};
  var ctx = document.getElementById('ctx');
  var pop = document.getElementById('pop');
  var cur = null;
  function toast(m, ms){
    pop.textContent = m; pop.style.display = 'block';
    clearTimeout(pop._t);
    pop._t = setTimeout(function(){ pop.style.display = 'none'; }, ms || 2600);
  }
  document.querySelectorAll('.card[data-site]').forEach(function(el){
    el.addEventListener('contextmenu', function(e){
      e.preventDefault();
      cur = el.dataset;
      ctx.innerHTML = '<div class="cap">JM' + cur.id + '</div>'
        + '<button data-a="open">打开</button>'
        + '<button data-a="site">在浏览器打开原网页</button>'
        + '<button data-a="author">查作者的其他作品</button>'
        + '<button data-a="dl" class="danger">下载到本地</button>';
      ctx.style.left = Math.min(e.clientX, innerWidth - 190) + 'px';
      ctx.style.top = Math.min(e.clientY, innerHeight - 120) + 'px';
      ctx.style.display = 'block';
    });
  });
  ctx.addEventListener('click', function(e){
    var a = e.target.getAttribute('data-a');
    if (!a) return;
    ctx.style.display = 'none';
    if (a === 'open') window.open(cur.target || cur.site, '_blank', 'noopener');
    if (a === 'site') window.open(cur.site, '_blank', 'noopener');
    if (a === 'dl') {
      toast('开始下载 JM' + cur.id + ' …', 4000);
      fetch('./jm/download', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: cur.id })
      }).then(function(r){ return r.json(); }).then(function(j){
        toast(j.ok ? (j.msg + ' → ' + j.root) : ('没能开始：' + j.msg), 5000);
      }).catch(function(){ toast('下载请求失败', 4000); });
    }
  });
  document.addEventListener('click', function(e){
    if (ctx && !ctx.contains(e.target)) ctx.style.display = 'none';
  });

  var go = document.getElementById('go');
  var st = document.getElementById('st');
  go.addEventListener('click', function(){
    var payload = {
      query: document.getElementById('q').value,
      pages: Number(document.getElementById('pages').value),
      maxDetail: Number(document.getElementById('maxDetail').value),
      minPages: Number(document.getElementById('minPages').value),
      noAi: document.getElementById('noAi').checked,
      strict: document.getElementById('strict').checked
    };
    if (!payload.query.trim()) { st.textContent = '先填关键词'; return; }
    st.textContent = '启动中…';
    go.disabled = true;
    var mask = document.getElementById('mask');
    var mt = document.getElementById('maskText');
    mask.classList.add('on');
    mt.textContent = '正在检索…';
    fetch('./explore/run', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
    }).then(function(r){ return r.json(); }).then(function(j){
      if (!j.ok) { st.textContent = j.msg; go.disabled = false; mask.classList.remove('on'); return; }
      st.textContent = '检索中（首次要逐本抓详情）…';
      var timer = setInterval(function(){
        fetch('./explore/status').then(function(r){ return r.json(); }).then(function(s){
          if (s.status === 'done') {
            clearInterval(timer);
            st.textContent = '完成，正在刷新…';
            if (mt) mt.textContent = '检索完成，正在刷新…';
            setTimeout(function(){
              location.replace('./explore?sort=' + SORT + '&strict=' + (STRICT ? '1' : '0') + '&t=' + Date.now());
            }, 600);
          } else if (s.status === 'error') {
            clearInterval(timer);
            st.textContent = '失败了：' + (s.log || '').slice(-120);
            go.disabled = false;
          } else {
            var m = /FETCHED (\\d+)/.exec(s.log || '');
            if (m) { st.textContent = '已补抓 ' + m[1] + ' 本…'; mt.textContent = '正在检索… 已抓 ' + m[1] + ' 本'; }
          }
        });
      }, 1500);
    }).catch(function(){ st.textContent = '请求失败'; go.disabled = false; });
  });
})();
</script>`

  return page('检索', body, 'explore')
}

/** 词条与画师统计页 */
export function renderStats(stats, opt = {}) {
  const { updatedAt = 0, topTags = 20, topAuthors = 10 } = opt
  const upd = updatedAt ? new Date(updatedAt).toLocaleString('zh-CN') : '—'
  const maxTag = stats.tags.length ? stats.tags[0].count : 1

  const tagRows = stats.tags.slice(0, topTags).map((t, i) => {
    const w = Math.max(2, Math.round((t.count / maxTag) * 100))
    return '<div class="bar"><div class="t"><div class="fill" style="width:' + w + '%"></div>'
      + '<span class="tx"><i class="rank">' + (i + 1) + '</i>' + esc(t.tag) + '</span></div>'
      + '<div class="c">' + t.count + '</div></div>'
  }).join('')

  const auRows = stats.authors.slice(0, topAuthors).map((a, i) =>
    '<div class="artline"><span class="rank">' + (i + 1) + '</span>'
    + '<span class="n" title="' + esc(a.author) + '">' + esc(a.author) + '</span>'
    + '<span class="c">' + a.count + ' 本</span></div>').join('')

  const body = ''
    + '<div class="statbar">'
    + '<div class="k"><b>' + stats.albums + '</b><span>收藏本数</span></div>'
    + '<div class="k"><b>' + stats.tagKinds + '</b><span>独立词条</span></div>'
    + '<div class="k"><b>' + stats.tagTotal + '</b><span>词条实例</span></div>'
    + '<div class="k"><b>' + stats.authorKinds + '</b><span>画师人数</span></div>'
    + '<div class="k"><b>' + stats.langSkipped + '</b><span>已忽略无关词条</span></div>'
    + '<div class="k"><b style="font-size:13px;padding-top:7px">' + esc(upd) + '</b><span>数据更新</span></div>'
    + '</div>'
    + '<div class="cols">'
    + '<div class="box"><h2>词条出现次数（显示 ' + Math.min(topTags, stats.tags.length) + ' / 共 ' + stats.tagKinds + '）</h2>'
    + (tagRows || '<p class="hint">没有可统计的词条</p>') + '</div>'
    + '<div class="box"><h2>画师出现频率 前 ' + Math.min(topAuthors, stats.authors.length) + '</h2>'
    + (auRows || '<p class="hint">没有可统计的画师</p>') + '</div>'
    + '</div>'

  return page('词条统计', body, 'stats')
}

/** 设置页 */
export function renderPanel(s, opt = {}) {
  const { saved = false } = opt
  const ck = s.exhentaiCookies || {}
  const jm = s.jm || {}
  return page('设置', `
${saved ? '<div class="toast">已保存。</div>' : ''}
<form class="panel" method="post" action="./panel">
  <fieldset>
    <legend>网络</legend>
    <label class="f"><span>代理地址（留空则直连）</span>
      <input type="text" name="proxy" value="${esc(s.proxy || '')}" placeholder="127.0.0.1:7890"></label>
    <label class="f"><span>E 站站点</span>
      <select name="useExhentai">
        <option value="0" ${!s.useExhentai ? 'selected' : ''}>E-Hentai（内容较少，不需 cookie）</option>
        <option value="1" ${s.useExhentai ? 'selected' : ''}>ExHentai（内容全，需要 cookie）</option>
      </select></label>
  </fieldset>

  <fieldset>
    <legend>JM 账号（用于刷新收藏列表）</legend>
    <label class="f"><span>用户名</span>
      <input type="text" name="jmUser" value="${esc(jm.user || '')}"></label>
    <label class="f"><span>密码</span>
      <input type="password" name="jmPass" value="" placeholder="${jm.pass ? '已保存，留空不改' : 'JM 密码'}"></label>
    <label class="f"><span>网页域名（点击封面时打开）</span>
      <input type="text" name="jmWeb" value="${esc((s.jm && s.jm.web) || '18comic.vip')}" placeholder="18comic.vip"></label>
    <label class="f"><span>下载节流（每页之间停几秒，越大越慢越安全）</span>
      <input type="number" name="jmGap" min="0" max="10" step="0.1" value="${esc(String((s.jm && s.jm.gap != null) ? s.jm.gap : 0.8))}"></label>
    <p class="hint">图片线程固定为 1，一次只下一本。0.8 秒约合每页四分之一秒级的节奏，够稳；想更谨慎就调到 1.5~2。</p>
    <p class="hint">账号信息只在本机 settings.json 里保存，用于抓收藏与下载。不填不影响已抓下来的列表。</p>
  </fieldset>

  <fieldset>
    <legend>ExHentai cookie</legend>
    <label class="f"><span>ipb_member_id</span>
        <input type="text" name="ipbMemberId" value="" placeholder="${ck.ipbMemberId ? '已保存，留空不改' : '数字 ID'}"></label>
    <label class="f"><span>ipb_pass_hash</span>
        <input type="password" name="ipbPassHash" value="" placeholder="${ck.ipbPassHash ? '已保存，留空不改' : '32 位哈希'}"></label>
    <label class="f"><span>igneous</span>
        <input type="password" name="igneous" value="" placeholder="${ck.igneous ? '已保存，留空不改' : '可留空'}"></label>
    <p class="hint">浏览器登录 exhentai.org → F12 → Application → Cookies → 复制这三项。igneous 会过期，失效后重填。</p>
  </fieldset>

  <fieldset>
    <legend>封面缓存</legend>
    <p class="hint" id="covstat">统计中…</p>
    <div style="display:flex;gap:10px;margin:0 0 10px">
      <button type="button" id="clean7" style="padding:7px 14px;font-size:12.5px">清理 7 天前的</button>
      <button type="button" id="cleanAll" style="padding:7px 14px;font-size:12.5px;background:#7a3427">全部清空</button>
    </div>
    <p class="hint">封面存在下载目录下的 <code>.covers</code>，清理后按需重新拉取，不影响本子正文。</p>
  </fieldset>

  <fieldset>
    <legend>点击封面时</legend>
    <label class="chk"><input type="radio" name="openMode" value="os" ${(s.openMode || 'os') === 'os' ? 'checked' : ''}>
      <span>用系统默认浏览器打开</span></label>
    <label class="chk"><input type="radio" name="openMode" value="dsh" ${s.openMode === 'dsh' ? 'checked' : ''}>
      <span>用 DSH 内置页面打开（顶部带收藏／下载按钮）</span></label>
    <p class="hint">内置页面是把站点嵌进框架里显示；如果站点禁止嵌入，页面会空着，那就换成默认浏览器。</p>
  </fieldset>

  <fieldset>
    <legend>显示</legend>
    <label class="chk"><input type="checkbox" name="showFavorites" value="1" ${s.showFavorites !== false ? 'checked' : ''}>
      <span>显示收藏夹</span></label>
    <p class="hint">关掉后收藏页只显示一句提示，数据仍在本地。</p>
  </fieldset>

  <fieldset>
    <legend>新本推送</legend>
    <label class="chk"><input type="checkbox" name="pushEnabled" value="1" ${s.push && s.push.enabled ? 'checked' : ''}>
      <span>定时检查符合偏好的新本</span></label>
    <label class="f"><span>检查间隔（分钟）</span>
      <input type="number" name="pushInterval" min="30" value="${esc((s.push && s.push.intervalMinutes) || 360)}"></label>
    <label class="f"><span>回看天数</span>
      <input type="number" name="pushDays" min="1" value="${esc((s.push && s.push.days) || 7)}"></label>
  </fieldset>

  <button type="submit">保存</button>
</form>
<script>
(function(){
  var el = document.getElementById('covstat');
  if (!el) return;
  function show(s){
    el.textContent = s.count + ' 个文件，约 ' + s.mb + ' MB · ' + s.dir;
  }
  fetch('./jm/cover-stats').then(function(r){ return r.json(); }).then(show).catch(function(){
    el.textContent = '读不到缓存目录';
  });
  function clean(days){
    fetch('./jm/clean-covers', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ days: days })
    }).then(function(r){ return r.json(); }).then(function(j){
      alert(j.msg);
      show(j.stat);
    }).catch(function(){ alert('清理失败'); });
  }
  document.getElementById('clean7').addEventListener('click', function(){ clean(7); });
  document.getElementById('cleanAll').addEventListener('click', function(){
    if (confirm('清空全部封面缓存？')) clean(0);
  });
})();
</script>`, 'panel')
}

async function readJson(req, limit = 256 * 1024) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limit) return {}
    chunks.push(c)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/**
 * 注册所有 Web 路由。
 * @param {object} ctx 插件上下文（用 ctx.webServer）
 * @param {object} deps E 站与 JM 的数据/动作回调
 */
export function registerWeb(ctx, deps) {
  const webServer = ctx.webServer ?? (typeof ctx.get === 'function' ? ctx.get('webServer') : null)
  if (!webServer || typeof webServer.register !== 'function') return false

  ctx.effect(() =>
    webServer.register({
      kind: 'prefix',
      path: '/dsh-ehentai',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url, 'http://127.0.0.1')
          const path = url.pathname.replace(/^\/dsh-ehentai/, '') || '/'
          const s = deps.getSettings()

          res.setHeader('Cache-Control', 'no-store, must-revalidate')
          const sendJson = (obj) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify(obj))
            return true
          }

          // ── 图片代理（E 站 / JM 各一套 Referer） ──
          if (path === '/thumb' || path === '/jmthumb') {
            const u = url.searchParams.get('u')
            // 只允许图床域名，否则这个路由等于给任意 https 地址开代理
            const OK_HOST = /^https:\/\/([a-z0-9-]+\.)*(ehgt\.org|e-hentai\.org|exhentai\.org|hath\.net|jmapinodeudzn\.net|jmapiproxy2\.cc|jmcomic\.[a-z]+)\//i
            if (!u || !OK_HOST.test(u)) {
              res.statusCode = 400
              res.end('bad url')
              return true
            }
            try {
              const r = await request(u, {
                proxy: s.proxy || null,
                headers: {
                  Referer: path === '/jmthumb' ? 'https://18comic.vip/' : 'https://e-hentai.org/',
                },
              })
              res.statusCode = r.status
              res.setHeader('Content-Type', r.headers['content-type'] || 'image/jpeg')
              res.setHeader('Cache-Control', 'public, max-age=86400')
              res.end(r.body)
            } catch {
              res.statusCode = 502
              res.end('thumb fetch failed')
            }
            return true
          }

          // ── JM：下载 / 刷新 / 状态 ──
          if (path === '/jm/download' && req.method === 'POST') {
            const body = await readJson(req)
            return sendJson(deps.jmDownload(String(body.id || ''), s))
          }
          if (path === '/jm/refresh' && req.method === 'POST') {
            return sendJson(deps.jmRefresh(s))
          }
          if (path === '/jm/status') {
            return sendJson({ job: deps.jmStatus(url.searchParams.get('id') || '') })
          }

          // ── 保存设置 ──
          if (path === '/panel' && req.method === 'POST') {
            const chunks = []
            for await (const c of req) chunks.push(c)
            const raw = Buffer.concat(chunks).toString('utf8')
            const form = new URLSearchParams(raw)
            const patch = {
              proxy: (form.get('proxy') || '').trim(),
              useExhentai: form.get('useExhentai') === '1',
              exhentaiCookies: {
                ipbMemberId: (form.get('ipbMemberId') || '').trim(),
                ipbPassHash: (form.get('ipbPassHash') || '').trim(),
                igneous: (form.get('igneous') || '').trim(),
              },
              jm: {
                user: (form.get('jmUser') || '').trim(),
                pass: form.get('jmPass') || '',
                web: (form.get('jmWeb') || '').trim() || '18comic.vip',
                gap: Math.max(0, Math.min(10, Number(form.get('jmGap') || 0.8))),
              },
              openMode: form.get('openMode') === 'dsh' ? 'dsh' : 'os',
              showFavorites: form.get('showFavorites') === '1',
              push: {
                enabled: form.get('pushEnabled') === '1',
                intervalMinutes: Number(form.get('pushInterval') || 360),
                days: Number(form.get('pushDays') || 7),
                maxItems: (s.push && s.push.maxItems) || 10,
              },
            }
            deps.saveSettings(patch)
            res.statusCode = 303
            res.setHeader('Location', './panel?saved=1')
            res.end()
            return true
          }

          // ── 设置页（根路径就是设置） ──
          if (path === '/panel' || path === '/' || path === '') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(renderPanel(s, { saved: url.searchParams.get('saved') === '1' }))
            return true
          }

          // ── JM 词条统计 ──
          if (path === '/jm/stats') {
            const data = deps.jmData()
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(renderStats(jmStats(data.items), { updatedAt: data.updatedAt }))
            return true
          }

          // ── 推荐 ──
          if (path === '/recommend') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            res.end(renderRecommend({ webDomain: (s.jm && s.jm.web) || '18comic.vip' }))
            return true
          }
          if (path === '/recommend/run' && req.method === 'POST') {
            const body = await readJson(req)
              const r = deps.recMany({
                mode: String(body.mode || 'taste') === 'random' ? 'random' : 'taste',
                count: Math.max(1, Math.min(15, Number(body.count) || 1)),
                excludeDownloaded: !!body.excludeDownloaded,
                allowRepeat: !!body.allowRepeat,
              }, s)
              if (r.ok && Array.isArray(r.items)) {
                for (const it of r.items) it.brief = deps.recBrief(it)
              }
              return sendJson(r)
            }

          // ── 检索 ──
          if (path === '/explore') {
            const rawQ = url.searchParams.get('sort')
            const sort = ['latest', 'hot', 'match'].includes(rawQ) ? rawQ : 'match'
            const raw = deps.exploreResult()
            const strict = url.searchParams.get('strict') !== '0'
            let ranked = { items: [], skipped: [] }
            let ignoredWords = []
            if (raw) {
              const order = new Map((raw.items || []).map((x, i) => [String(x.id), i]))
              // 先剔垃圾（非 H、AI 作画），再按查询词做硬校验：标签对不上的一律不要
              let list = deps.exploreBasic(raw.items || [])
              if (strict) {
                const r = deps.exploreStrict(list, raw.query)
                list = r.items
                ignoredWords = r.ignored || []
              }
              if (sort === 'match') {
                ranked = deps.exploreRank(list, { noAi: true, minPages: Number(s.exploreMinPages || 12) })
              } else {
                ranked = { items: deps.exploreSort(list, sort, order), skipped: [] }
              }
            }
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store, must-revalidate')
            res.end(renderExplore({
              raw,
              ranked,
              query: (raw && raw.query) || '',
              sort,
              strict,
              ignoredWords,
              downloads: deps.jmDownloads(),
              openMode: s.openMode || 'os',
              webDomain: (s.jm && s.jm.web) || '18comic.vip',
            }))
            return true
          }
          if (path === '/explore/run' && req.method === 'POST') {
            const body = await readJson(req)
            return sendJson(deps.exploreRun(body, s))
          }
          if (path === '/explore/status') {
            return sendJson(deps.exploreStatus())
          }

          // ── 本地播放器 ──
          if (path === '/player') {
            const pid = url.searchParams.get('id') || ''
            const data = deps.jmData()
            const items = data.items || []
            const index = items.findIndex((x) => String(x.id) === pid)
            const imgs = deps.jmImages(pid)
            const item = index >= 0 ? items[index] : { id: pid, title: 'JM' + pid, tags: [] }
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(renderPlayer({
              id: pid,
              title: item.title,
              tags: item.tags || [],
              items,
              index,
              images: imgs.list || [],
              dir: imgs.dir || '',
              webDomain: (s.jm && s.jm.web) || '18comic.vip',
            }))
            return true
          }

          // ── 封面（本地缓存优先，缺了才去拉） ──
          if (path === '/cover') {
            const cid = (url.searchParams.get('id') || '').replace(/[^\d]/g, '')
            if (!cid) { res.statusCode = 400; res.end('bad id'); return true }
            const hit = deps.coverPath(cid)
            if (hit) {
              try {
                const buf = readFileSync(hit.path)
                res.setHeader('Content-Type', hit.ext === 'webp' ? 'image/webp' : hit.ext === 'png' ? 'image/png' : 'image/jpeg')
                res.setHeader('Cache-Control', 'public, max-age=86400')
                res.end(buf)
                return true
              } catch { /* 落到下面重新拉 */ }
            }
            const cdn = 'https://cdn-msp.jmapinodeudzn.net/media/albums/' + cid + '.jpg'
            // 不等下载：先把浏览器指到 CDN，同时后台补一份缓存
            request(cdn, { proxy: s.proxy || null, timeoutMs: 20000 })
              .then((r) => { if (r.status === 200) deps.coverSave(cid, r.body) })
              .catch(() => {})
            res.statusCode = 302
            res.setHeader('Location', cdn)
            res.setHeader('Cache-Control', 'no-store')
            res.end()
            return true
          }

          // ── 封面缓存清理 ──
          if (path === '/jm/clean-covers' && req.method === 'POST') {
            const body = await readJson(req)
            const days = Number(body.days != null ? body.days : 7)
            return sendJson({ ok: true, msg: '已清理 ' + deps.pruneCovers(days) + ' 个封面缓存文件', stat: deps.coverStats() })
          }
          if (path === '/jm/cover-stats') {
            return sendJson(deps.coverStats())
          }

          // ── 本地图片 ──
          if (path === '/local') {
            const pid = url.searchParams.get('id') || ''
            const name = url.searchParams.get('n') || ''
            const full = deps.jmImagePath(pid, name)
            if (!full || !existsSync(full)) {
              res.statusCode = 404
              res.end('not found')
              return true
            }
            const ext = (name.split('.').pop() || '').toLowerCase()
            const types = {
              webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg',
              png: 'image/png', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp',
            }
            try {
              const buf = readFileSync(full)
              res.setHeader('Content-Type', types[ext] || 'application/octet-stream')
              res.setHeader('Cache-Control', 'public, max-age=604800')
              res.end(buf)
            } catch {
              res.statusCode = 500
              res.end('read failed')
            }
            return true
          }

          // ── E 站内置浏览页 ──
          if (path === '/ehview') {
            const vg = url.searchParams.get('gid') || ''
            const vt = url.searchParams.get('token') || ''
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            res.end(renderEhView(vg, vt, { favorited: deps.ehFavState(vg) }))
            return true
          }
          if (path === '/eh/fav' && req.method === 'POST') {
            const body = await readJson(req)
            const r2 = await deps.ehFav(
              String(body.gid || ''), String(body.token || ''), String(body.action || 'add'), s)
            return sendJson(r2)
          }

          // ── E 站下载 ──
          if (path === '/eh/download' && req.method === 'POST') {
            const body = await readJson(req)
            return sendJson(deps.ehDownload(String(body.url || ''), s))
          }
          if (path === '/eh/status') {
            return sendJson({ job: deps.ehStatus(url.searchParams.get('url') || '') })
          }

          // ── 按作者检索 ──
          if (path === '/jm/author' && req.method === 'POST') {
            const body = await readJson(req)
            const author = String(body.author || '').trim()
            if (!author) return sendJson({ ok: false, msg: '这本没有作者信息' })
            return sendJson(deps.exploreRun({
              query: author, mode: 'author', pages: 2, maxDetail: 30,
            }, s))
          }

          // ── 缓存管理：重新下载 / 删缓存 / 取消收藏 ──
          if (path === '/jm/manage' && req.method === 'POST') {
            const body = await readJson(req)
            const mid = String(body.id || '')
            const action = String(body.action || '')
            if (action === 'redownload') return sendJson(deps.jmRedownload(mid, s))
            if (action === 'delcache') return sendJson(deps.jmDeleteCache(mid))
            if (action === 'unfav') {
              const r = deps.jmFav(mid, 'remove', s)
              if (!r.ok) return sendJson(r)
              const d = deps.jmDeleteCache(mid)
              return sendJson({ ok: true, msg: '已取消收藏' + (d.ok ? '，本地缓存已删' : '') })
            }
            return sendJson({ ok: false, msg: '未知操作' })
          }

          // ── JM 内置浏览页 ──
          if (path === '/view') {
            const webDomain = (s.jm && s.jm.web) || '18comic.vip'
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            const vid = url.searchParams.get('id') || ''
            res.end(renderView(vid, { webDomain, favorited: deps.favState(vid) }))
            return true
          }
          if (path === '/jm/fav' && req.method === 'POST') {
            const body = await readJson(req)
            return sendJson(deps.jmFav(String(body.id || ''), String(body.action || 'add'), s))
          }

          // ── JM 收藏页 ──
          if (path === '/jm') {
            const data = deps.jmData()
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            const webDomain = (s.jm && s.jm.web) || '18comic.vip'
            const downloads = deps.jmDownloads()
            res.end(renderJm(data, {
              root: deps.jmRootPath(), webDomain, openMode: s.openMode || 'os', downloads,
            }))
            return true
          }

          // ── E 站收藏页 ──
          if (path === '/eh') {
            const rows = deps.collectionRows()
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(
              renderCollection(rows, {
                showFavorites: s.showFavorites !== false,
                hasCookie: deps.hasCookie(),
                openMode: s.openMode || 'os',
                showNotice: !s.ehNoticeSeen,
              })
            )
              if (!s.ehNoticeSeen) deps.saveSettings({ ehNoticeSeen: true })
            return true
          }

          res.statusCode = 404
          res.end('not found')
          return true
        } catch (e) {
          res.statusCode = 500
          res.end('internal error: ' + String(e && e.message))
          return true
        }
      },
    })
  )
  return true
}
