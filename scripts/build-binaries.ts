#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { createHash } from "node:crypto"

interface Target {
  platform: "darwin" | "linux" | "win32"
  arch: "arm64" | "x64"
  suffix: string
  ext: string
}

const targets: Target[] = [
  { platform: "darwin", arch: "arm64", suffix: "darwin-arm64", ext: "" },
  { platform: "darwin", arch: "x64", suffix: "darwin-x64", ext: "" },
  { platform: "linux", arch: "arm64", suffix: "linux-arm64", ext: "" },
  { platform: "linux", arch: "x64", suffix: "linux-x64", ext: "" },
  { platform: "win32", arch: "x64", suffix: "windows-x64", ext: ".exe" },
]

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function run(cmd: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }): void {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: options?.cwd,
    env: { ...process.env, ...options?.env },
  })
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`)
  }
}

function currentTarget(): Target {
  const platform = os.platform() as Target["platform"]
  const arch = os.arch() === "arm64" ? "arm64" : "x64"
  const t = targets.find((target) => target.platform === platform && target.arch === arch)
  if (!t) throw new Error(`Unsupported platform/arch: ${platform} ${arch}`)
  return t
}

function sha256(filePath: string): string {
  const hash = createHash("sha256")
  hash.update(fs.readFileSync(filePath))
  return hash.digest("hex")
}
function releaseVersion(): string {
  if (process.env.MEMORY_LANE_VERSION) return process.env.MEMORY_LANE_VERSION.replace(/^v/u, "")
  const exactTag = spawnSync("git", ["describe", "--tags", "--exact-match", "HEAD"], { encoding: "utf8" })
  if (exactTag.status === 0) return exactTag.stdout.trim().replace(/^v/u, "")
  const shortSha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" })
  if (shortSha.status === 0) return `0.0.0-${shortSha.stdout.trim()}`
  return "0.0.0-dev"
}


async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const currentOnly = args.includes("--current")
  const selected = args.includes("--target") ? args[args.indexOf("--target") + 1] : undefined
  const distDir = path.resolve("dist-binaries")
  ensureDir(distDir)

  // Build source packages first so workspace imports resolve to dist files.
  run("pnpm", ["build"])

  const toBuild = currentOnly
    ? [currentTarget()]
    : selected
      ? targets.filter((t) => t.suffix === selected)
      : targets

  const version = releaseVersion()
  const defineVersion = JSON.stringify(version)
  const checksums: string[] = []

  for (const target of toBuild) {
    const binaryName = `memory-lane-${target.suffix}${target.ext}`
    const binaryPath = path.join(distDir, binaryName)
    console.log(`\nBuilding ${binaryName}...`)
    run("bun", [
      "build",
      "--compile",
      "--target",
      `bun-${target.platform}-${target.arch}`,
      "packages/cli/src/index.ts",
      "--outfile",
      binaryPath,
      "--define",
      `process.env.MEMORY_LANE_VERSION=${defineVersion}`,
    ])

    const archiveName = target.platform === "win32" ? `${binaryName}.zip` : `${binaryName}.tar.gz`
    const archivePath = path.join(distDir, archiveName)

    if (target.platform === "win32") {
      run("zip", ["-j", archivePath, binaryPath])
    } else {
      run("tar", ["-czf", archivePath, "-C", distDir, binaryName])
    }

    const checksum = sha256(archivePath)
    checksums.push(`${checksum}  ${archiveName}`)
    console.log(`${archiveName}: ${checksum}`)
  }

  fs.writeFileSync(path.join(distDir, "SHA256SUMS"), checksums.join("\n") + "\n")
  console.log("\nDone. Artifacts in:", distDir)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
