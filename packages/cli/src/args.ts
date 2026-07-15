// Every flag that takes a value MUST be registered here so positionals()
// skips exactly one following token for it. Any flag absent from this table is
// treated as boolean and never consumes the next token, so an unregistered
// boolean flag can never swallow positional arguments (issue #135).
export const VALUE_FLAGS: Record<string, true> = {
  "apply-plan": true,
  "area": true,
  "captured-at": true,
  "category": true,
  "expires-at": true,
  "folder": true,
  "kind": true,
  "limit": true,
  "only": true,
  "project": true,
  "prompt": true,
  "provenance": true,
  "query": true,
  "reason": true,
  "related-limit": true,
  "scope": true,
  "since": true,
  "source": true,
  "stale-after-days": true,
  "status": true,
  "text": true,
  "top-k": true,
  "vault": true,
  "write-plan": true,
}

export function flag(argv: string[], name: string): string | undefined {
  // hasOwn guards against prototype keys leaking in from user input (e.g. --constructor).
  if (!Object.hasOwn(VALUE_FLAGS, name)) {
    // Developer error: reading a value for a flag positionals() treats as boolean
    // would silently desync flag parsing from positional parsing.
    throw new Error(`Internal error: --${name} is not registered in VALUE_FLAGS`)
  }
  const idx = argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  const next = argv[idx + 1]
  // Empty string counts as a consumed value, matching positionals(); only a
  // missing token or another --flag falls back to the "true" sentinel.
  return next !== undefined && !next.startsWith("--") ? next : "true"
}

export function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`)
}

// Strip flags from argv, return positional args. Value flags consume exactly
// one following token (unless it looks like another flag); all other flags are
// boolean and consume nothing.
export function positionals(argv: string[]): string[] {
  const result: string[] = []
  let i = 0
  while (i < argv.length) {
    const token = argv[i]
    if (token.startsWith("--")) {
      const next = argv[i + 1]
      if (Object.hasOwn(VALUE_FLAGS, token.slice(2)) && next !== undefined && !next.startsWith("--")) i += 2
      else i++
    } else {
      result.push(token)
      i++
    }
  }
  return result
}
