export function flag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  const next = argv[idx + 1]
  return next && !next.startsWith("--") ? next : "true"
}

export function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`)
}
