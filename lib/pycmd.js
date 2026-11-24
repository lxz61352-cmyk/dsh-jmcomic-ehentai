/**
 * Python 解释器解析。
 *
 * 不要在业务代码里写死 `py -3.13`：只有 3.12 的机器上会直接
 * "No suitable Python runtime found"，JM 那半条线全线失效（别人机器上就是这么挂的）。
 * 这里按优先级逐个探测，取第一个真能跑起来的，结果进程内缓存：
 *
 *   settings.json 的 jm.python（或顶层 python）
 *     > 环境变量 DSH_JMPY
 *     > py -3.13  >  py -3  >  python        （Windows）
 *     > python3   >  python                 （其它平台）
 *
 * 全部失败时退回 `py -3.13`，让 spawn 的 ENOENT 照常暴露，不吞错。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { dataDir } from './store.js'

const FALLBACK = process.platform === 'win32'
  ? { cmd: 'py', args: ['-3.13'] }
  : { cmd: 'python3', args: [] }

let cached = null

/** 设置里手动指定的解释器：优先 jm.python，其次顶层 python（历史写法） */
function fromSettings() {
  try {
    const s = JSON.parse(readFileSync(join(dataDir(), 'settings.json'), 'utf8'))
    const raw = (s.jm && s.jm.python) || s.python
    const p = typeof raw === 'string' ? raw.trim() : ''
    return p ? { cmd: p, args: [] } : null
  } catch {
    return null
  }
}

function candidates() {
  const out = []
  const s = fromSettings()
  if (s) out.push(s)
  const env = String(process.env.DSH_JMPY || '').trim()
  if (env) out.push({ cmd: env, args: [] })
  if (process.platform === 'win32') {
    out.push({ cmd: 'py', args: ['-3.13'] })
    out.push({ cmd: 'py', args: ['-3'] })
    out.push({ cmd: 'python', args: [] })
  } else {
    out.push({ cmd: 'python3', args: [] })
    out.push({ cmd: 'python', args: [] })
  }
  return out
}

function usable(c) {
  try {
    const r = spawnSync(c.cmd, [...c.args, '-c', 'import sys'], {
      windowsHide: true,
      timeout: 15000,
    })
    return r.status === 0
  } catch {
    return false
  }
}

/** @returns {{cmd: string, args: string[]}} */
export function pythonCmd() {
  if (cached) return cached
  for (const c of candidates()) {
    if (usable(c)) {
      cached = c
      return c
    }
  }
  cached = FALLBACK
  return cached
}

/** 调试用：返回探测过程（不改缓存） */
export function pythonCandidates() {
  return candidates().map((c) => ({ ...c, usable: usable(c) }))
}
