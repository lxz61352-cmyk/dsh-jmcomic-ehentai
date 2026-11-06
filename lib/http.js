/**
 * 带代理的 HTTP 客户端。
 *
 * Node 内置的 fetch 不认 http(s)_proxy 环境变量，插件又要支持用户自填代理，
 * 所以这里用 node:http / node:https 自己实现：
 *   · proxy 为空 → 直接连接目标
 *   · proxy 非空 → 向代理发 CONNECT 建立隧道，再在隧道里跑 TLS
 *
 * 只依赖 Node 内置模块，不引入第三方包（插件要能分发给别人，零依赖最省事）。
 */
import http from 'node:http'
import https from 'node:https'
import tlsMod from 'node:tls'
import { URL } from 'node:url'

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** 解析 "127.0.0.1:7890" / "http://host:port" / "user:pass@host:port" */
export function parseProxy(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  const withScheme = /^[a-z]+:\/\//i.test(s) ? s : 'http://' + s
  try {
    const u = new URL(withScheme)
    return {
      host: u.hostname,
      port: Number(u.port) || 8080,
      auth: u.username
        ? `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password || '')}`
        : null,
      protocol: (u.protocol || 'http:').replace(':', ''),
    }
  } catch {
    return null
  }
}

/** 通过 HTTP 代理建立到 host:port 的 CONNECT 隧道，返回 socket */
function connectTunnel(proxy, host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const headers = { Host: `${host}:${port}` }
    if (proxy.auth) {
      headers['Proxy-Authorization'] =
        'Basic ' + Buffer.from(proxy.auth).toString('base64')
    }
    const req = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers,
      timeout: timeoutMs,
    })
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`proxy CONNECT failed: HTTP ${res.statusCode}`))
        return
      }
      resolve(socket)
    })
    req.on('timeout', () => req.destroy(new Error('proxy CONNECT timeout')))
    req.on('error', reject)
    req.end()
  })
}

/**
 * 发一个请求，返回 { status, headers, body(Buffer) }
 * @param {string} url
 * @param {object} opt { method, headers, body, proxy(string|object), timeoutMs }
 */
export async function request(url, opt = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    proxy = null,
    timeoutMs = 40000,
  } = opt

  const target = new URL(url)
  const isHttps = target.protocol === 'https:'
  const host = target.hostname
  const port = Number(target.port) || (isHttps ? 443 : 80)
  const px = typeof proxy === 'string' ? parseProxy(proxy) : proxy

  const reqHeaders = {
    'User-Agent': DEFAULT_UA,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...headers,
  }
  if (body && reqHeaders['Content-Length'] == null) {
    reqHeaders['Content-Length'] = Buffer.byteLength(body)
  }

  const send = (createReq) =>
    new Promise((resolve, reject) => {
      const req = createReq()
      req.setTimeout(timeoutMs, () => req.destroy(new Error('request timeout')))
      req.on('error', reject)
      req.on('response', (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
        )
        res.on('error', reject)
      })
      if (body) req.write(body)
      req.end()
    })

  // ── 直连
  if (!px) {
    return send(() =>
      (isHttps ? https : http).request(
        { host, port, path: target.pathname + target.search, method, headers: reqHeaders },
        undefined
      )
    )
  }

  // ── 走代理：CONNECT 隧道
  const tunnel = await connectTunnel(px, host, port, timeoutMs)

  // 注意：Node 里一旦显式给了 agent（含 agent:false），createConnection 会被忽略，
  // 所以这里用一个只认隧道 socket 的一次性 Agent。HTTPS 还要在隧道上补 TLS 握手。
  let agent
  if (isHttps) {
    agent = new https.Agent({ keepAlive: false })
    agent.createConnection = () =>
      tlsMod.connect({ socket: tunnel, servername: host, host })
  } else {
    agent = new http.Agent({ keepAlive: false })
    agent.createConnection = () => tunnel
  }

  return send(() =>
    (isHttps ? https : http).request({
      host,
      port,
      path: target.pathname + target.search,
      method,
      headers: reqHeaders,
      agent,
    })
  )
}

/** 便捷：GET 文本（自动解 gzip / deflate） */
export async function getText(url, opt = {}) {
  const { headers = {}, ...rest } = opt
  const r = await request(url, {
    ...rest,
    headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', ...headers },
  })
  let buf = r.body
  const enc = String(r.headers['content-encoding'] || '').toLowerCase()
  try {
    const zlib = await import('node:zlib')
    if (enc.includes('gzip')) buf = zlib.gunzipSync(buf)
    else if (enc.includes('deflate')) buf = zlib.inflateSync(buf)
    else if (enc.includes('br')) buf = zlib.brotliDecompressSync(buf)
  } catch {
    /* 解压失败就按原文返回 */
  }
  return { status: r.status, headers: r.headers, text: buf.toString('utf8') }
}

/** 便捷：POST JSON 并解析 JSON 返回 */
export async function postJson(url, payload, opt = {}) {
  const r = await request(url, {
    ...opt,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) },
    body: JSON.stringify(payload),
  })
  let text = r.body.toString('utf8')
  const enc = String(r.headers['content-encoding'] || '').toLowerCase()
  if (enc.includes('gzip')) {
    try {
      const zlib = await import('node:zlib')
      text = zlib.gunzipSync(r.body).toString('utf8')
    } catch {
      /* 忽略 */
    }
  }
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 保持 null */
  }
  return { status: r.status, json, text }
}
