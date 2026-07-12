import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { tempDir } from "../../core/test/helpers.js"
import { readInstallManifest } from "../src/installer/manifest.js"

const testDir = path.dirname(fileURLToPath(import.meta.url))
const cli = path.resolve(testDir, "../dist/index.js")

function run(args: string[], env: NodeJS.ProcessEnv): { stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  return { stdout: result.stdout, stderr: result.stderr }
}

test("OMP override install upgrade doctor and uninstall keep the recorded path", () => {
  const home = tempDir()
  const dataDir = path.join(home, ".memory-lane")
  const binaryPath = path.join(home, "custom-bin", "memory-lane")
  const agentDir = path.join(home, "custom-omp-agent")
  const ompPath = path.join(agentDir, "extensions", "memory-lane", "index.ts")
  const piPath = path.join(home, ".pi", "agent", "extensions", "memory-lane", "index.ts")
  const defaultPath = path.join(home, ".omp", "agent", "extensions", "memory-lane", "index.ts")
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true })
  fs.writeFileSync(binaryPath, "installed binary sentinel", "utf8")
  fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true })

  const baseEnv = {
    HOME: home,
    MEMORY_LANE_INSTALL_BINARY: binaryPath,
    MEMORY_LANE_FILE: path.join(dataDir, "memory.jsonl"),
    MEMORY_LANE_EMBEDDINGS_FILE: path.join(dataDir, "embeddings.jsonl"),
    MEMORY_LANE_CONFIG: path.join(dataDir, "config.json"),
  }
  run(["init", "--only", "pi", "--yes"], baseEnv)
  const piBefore = fs.readFileSync(piPath, "utf8")
  run(["init", "--only", "omp", "--yes"], { ...baseEnv, PI_CODING_AGENT_DIR: agentDir })
  const installedOmpBefore = fs.readFileSync(ompPath, "utf8")

  fs.mkdirSync(path.dirname(defaultPath), { recursive: true })
  fs.writeFileSync(defaultPath, "default path must remain untouched", "utf8")

  const clearedEnv = { ...baseEnv, MEMORY_LANE_INSTALL_BINARY: undefined, PI_CODING_AGENT_DIR: undefined }
  run(["upgrade", "--reapply-install-manifest", "--yes"], clearedEnv)
  assert.equal(fs.readFileSync(ompPath, "utf8"), installedOmpBefore)
  assert.equal(fs.readFileSync(piPath, "utf8"), piBefore)
  assert.equal(fs.readFileSync(defaultPath, "utf8"), "default path must remain untouched")

  const doctor = JSON.parse(run(["doctor", "--json"], clearedEnv).stdout) as {
    data: { integrations: { ompExtension: { checkedPath: string | null; exists: boolean; detected: boolean } } }
  }
  assert.deepEqual(doctor.data.integrations.ompExtension, {
    checkedPath: ompPath,
    exists: true,
    detected: true,
    warnings: [],
  })

  run(["uninstall", "--only", "omp", "--yes"], clearedEnv)
  assert.equal(fs.existsSync(ompPath), false)
  assert.equal(fs.readFileSync(piPath, "utf8"), piBefore)
  assert.equal(fs.readFileSync(defaultPath, "utf8"), "default path must remain untouched")
  assert.equal(fs.existsSync(binaryPath), true)
  const manifest = readInstallManifest(dataDir)
  assert.equal(manifest.status, "valid")
  if (manifest.status !== "valid") return
  assert.deepEqual(manifest.manifest.integrations, [{ harness: "pi", configPath: piPath }])
})

test("doctor uses the resolver before install and reports malformed manifests without writing", () => {
  const home = tempDir()
  const dataDir = path.join(home, ".memory-lane")
  const overrideAgent = path.join(home, "override-agent")
  const overridePath = path.join(overrideAgent, "extensions", "memory-lane", "index.ts")
  fs.mkdirSync(path.dirname(overridePath), { recursive: true })
  fs.writeFileSync(overridePath, "export default async function memoryLaneExtension() {}", "utf8")
  const env = {
    HOME: home,
    PI_CODING_AGENT_DIR: overrideAgent,
    MEMORY_LANE_FILE: path.join(dataDir, "memory.jsonl"),
    MEMORY_LANE_EMBEDDINGS_FILE: path.join(dataDir, "embeddings.jsonl"),
    MEMORY_LANE_CONFIG: path.join(dataDir, "config.json"),
  }

  const overrideDoctor = JSON.parse(run(["doctor", "--json"], env).stdout) as {
    data: { integrations: { ompExtension: { checkedPath: string | null; exists: boolean; detected: boolean; warnings: string[] } } }
  }
  assert.deepEqual(overrideDoctor.data.integrations.ompExtension, {
    checkedPath: overridePath,
    exists: true,
    detected: true,
    warnings: [],
  })

  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, "install.json"), "{", "utf8")
  const malformedDoctor = JSON.parse(run(["doctor", "--json"], env).stdout) as {
    data: { integrations: { ompExtension: { checkedPath: string | null; warnings: string[] } } }
  }
  assert.equal(malformedDoctor.data.integrations.ompExtension.checkedPath, overridePath)
  assert.match(malformedDoctor.data.integrations.ompExtension.warnings.join("\n"), /Invalid JSON in install manifest/u)
  assert.equal(fs.readFileSync(path.join(dataDir, "install.json"), "utf8"), "{")
})

test("doctor rejects unsafe manifest OMP paths without inspecting the target", () => {
  const home = tempDir()
  const dataDir = path.join(home, ".memory-lane")
  const unsafeTarget = path.join(home, "arbitrary", "file.ts")
  fs.mkdirSync(path.dirname(unsafeTarget), { recursive: true })
  fs.writeFileSync(unsafeTarget, "export default async function memoryLaneExtension() {}", "utf8")
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, "install.json"), JSON.stringify({
    version: "0.1.0",
    installedAt: "2026-01-01T00:00:00.000Z",
    binaryPath: path.join(home, "bin", "memory-lane"),
    dataDir,
    integrations: [{ harness: "omp", configPath: unsafeTarget }],
  }), "utf8")

  const env = {
    HOME: home,
    MEMORY_LANE_FILE: path.join(dataDir, "memory.jsonl"),
    MEMORY_LANE_EMBEDDINGS_FILE: path.join(dataDir, "embeddings.jsonl"),
    MEMORY_LANE_CONFIG: path.join(dataDir, "config.json"),
  }
  const doctor = JSON.parse(run(["doctor", "--json"], env).stdout) as {
    data: { integrations: { ompExtension: { checkedPath: string | null; exists: boolean; detected: boolean; warnings: string[] } } }
  }
  assert.equal(doctor.data.integrations.ompExtension.checkedPath, null)
  assert.equal(doctor.data.integrations.ompExtension.exists, false)
  assert.equal(doctor.data.integrations.ompExtension.detected, false)
  assert.match(doctor.data.integrations.ompExtension.warnings.join("\n"), /Refusing to manage an unexpected OMP extension path/u)
})
