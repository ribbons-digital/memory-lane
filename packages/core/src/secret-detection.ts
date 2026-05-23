const HIGH_ENTROPY_TOKEN = /[A-Za-z0-9+/=_-]{32,}/gu

const SECRET_PATTERNS = [
  /-----begin [a-z ]*private key-----/iu,
  /\b(?:password|passwd|secret|token|(?:api|access|auth)[\s_-]*key|(?:access|auth)[\s_-]*token|private[\s_-]*key)\b\s*(?:is\b|[:=])\s*\S{4,}/iu,
  /\b[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY)\b\s*=\s*\S+/u,
  /\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/u,
]

function compactToken(value: string): string {
  return value.replace(/[^A-Za-z0-9+/=_-]/gu, "")
}

function hasMixedCharacterClasses(value: string): boolean {
  return /[A-Z]/u.test(value) && /[a-z]/u.test(value) && /\d/u.test(value)
}

function looksHighEntropy(value: string): boolean {
  const compact = compactToken(value)
  const unique = new Set(compact.split("")).size
  return compact.length >= 32 && unique >= 18 && hasMixedCharacterClasses(compact)
}

function containsHighEntropyToken(text: string): boolean {
  return Array.from(text.matchAll(HIGH_ENTROPY_TOKEN)).some((match) => looksHighEntropy(match[0]))
}

function mentionsSecretBearer(text: string): boolean {
  return /\b(bearer|token|secret|password|api key)\b/u.test(text.toLowerCase())
}

export function containsLikelySecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text))
    || (mentionsSecretBearer(text) && containsHighEntropyToken(text))
    || containsHighEntropyToken(text)
}
