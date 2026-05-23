function looksHighEntropy(value: string): boolean {
  const compact = value.replace(/[^A-Za-z0-9+/=_-]/gu, "")
  if (compact.length < 32) return false
  const unique = new Set(compact.split("")).size
  return unique >= 18 && /[A-Z]/u.test(compact) && /[a-z]/u.test(compact) && /\d/u.test(compact)
}

function containsHighEntropyToken(text: string): boolean {
  for (const match of text.matchAll(/[A-Za-z0-9+/=_-]{32,}/gu)) {
    if (looksHighEntropy(match[0])) return true
  }
  return false
}

export function containsLikelySecret(text: string): boolean {
  const lower = text.toLowerCase()
  if (/-----begin [a-z ]*private key-----/iu.test(text)) return true
  if (/\b(?:password|passwd|secret|token|(?:api|access|auth)[\s_-]*key|(?:access|auth)[\s_-]*token|private[\s_-]*key)\b\s*(?:is\b|[:=])\s*\S{4,}/iu.test(text)) return true
  if (/\b[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY)\b\s*=\s*\S+/u.test(text)) return true
  if (/\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/u.test(text)) return true
  if (/\b(bearer|token|secret|password|api key)\b/u.test(lower) && containsHighEntropyToken(text)) return true
  return containsHighEntropyToken(text)
}
