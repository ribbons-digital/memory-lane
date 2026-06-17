#!/usr/bin/env bun
import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

function currentBinaryPath(): string {
  const platform = os.platform()
  const arch = os.arch() === "arm64" ? "arm64" : "x64"
  const suffix = platform === "win32" ? `windows-${arch}.exe` : `${platform}-${arch}`
  return path.resolve("dist-binaries", `memory-lane-${suffix}`)
}

function runWithTimeout(args: string[], env: NodeJS.ProcessEnv = {}, timeoutMs = 5000): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(currentBinaryPath(), args, { env: { ...process.env, ...env } })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      resolve({ code: null, signal: "SIGKILL", stdout, stderr, timedOut: true })
    }, timeoutMs)
    child.on("exit", (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr, timedOut: false })
    })
  })
}

function assertOk(label: string, result: Awaited<ReturnType<typeof runWithTimeout>>): void {
  if (result.timedOut || result.code !== 0) {
    console.error(`${label} failed`)
    console.error(JSON.stringify(result, null, 2))
    process.exit(1)
  }
}

async function main(): Promise<void> {
  const binary = currentBinaryPath()
  if (!fs.existsSync(binary)) throw new Error(`Binary not found: ${binary}`)

  assertOk("--smoke-test", await runWithTimeout(["--smoke-test"]))

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-binary-smoke-"))
  try {
    assertOk("list", await runWithTimeout(["list"], {
      MEMORY_LANE_FILE: path.join(dir, "memory.jsonl"),
      MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"),
      MEMORY_LANE_CONFIG: path.join(dir, "config.json"),
      HOME: dir,
    }))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }

  console.log(`Binary smoke passed: ${binary}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
