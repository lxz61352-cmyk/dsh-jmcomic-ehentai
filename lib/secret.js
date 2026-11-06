/**
 * 本机凭证加密。
 *
 * 用 Windows DPAPI（ConvertFrom-SecureString 产出的就是 DPAPI 密文），
 * 密钥绑定当前 Windows 用户，所以：
 *   · 配置文件里看不到明文
 *   · 把文件拷到别的机器、别的用户下都解不开
 *
 * 密码走 stdin 而不是命令行参数，避免出现在进程列表里。
 * 非 Windows 平台不做加密（返回空串，调用方回退明文）。
 */
import { execFileSync } from 'node:child_process'

const cache = new Map()

function runPs(script, input) {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { input: input || '', encoding: 'utf8', windowsHide: true, timeout: 20000 }
  ).trim()
}

const AVAILABLE = process.platform === 'win32'

export function canEncrypt() {
  return AVAILABLE
}

/** 明文 → DPAPI 密文（hex 字符串） */
export function protect(plain) {
  const s = String(plain || '')
  if (!s || !AVAILABLE) return ''
  try {
    return runPs(
      '$p = [Console]::In.ReadToEnd(); ' +
      '$sec = ConvertTo-SecureString -String $p -AsPlainText -Force; ' +
      'ConvertFrom-SecureString -SecureString $sec',
      s
    )
  } catch {
    return ''
  }
}

/** DPAPI 密文 → 明文（结果缓存在内存里，避免每次读密码都起进程） */
export function unprotect(cipher) {
  const c = String(cipher || '').trim()
  if (!c || !AVAILABLE) return ''
  if (cache.has(c)) return cache.get(c)
  try {
    const out = runPs(
      '$c = [Console]::In.ReadToEnd(); ' +
      '$sec = ConvertTo-SecureString -String $c; ' +
      '$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec); ' +
      '[Runtime.InteropServices.Marshal]::PtrToStringAuto($b)',
      c
    )
    cache.set(c, out)
    return out
  } catch {
    return ''
  }
}