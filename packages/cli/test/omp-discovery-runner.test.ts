import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DISCOVERY_EXPECTED_TOOLS,
  DISCOVERY_OMP_VERSION,
  closeRpcChild,
  ompDiscoveryCommandPlan,
  prepareOmpDiscoveryCli,
  validateOmpDiscoveryVersion,
} from "./omp-discovery-runner.js"

test("OMP discovery preparation makes the built CLI executable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-omp-discovery-test-"))
  const cliPath = path.join(root, "index.js")
  try {
    fs.writeFileSync(cliPath, "#!/usr/bin/env node\n")
    fs.chmodSync(cliPath, 0o644)
    assert.doesNotThrow(() => prepareOmpDiscoveryCli(cliPath))
    if (process.platform !== "win32") assert.equal(fs.statSync(cliPath).mode & 0o111, 0o111)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("OMP discovery launch uses normal extension loading without --extension or profiles", () => {
  const plan = ompDiscoveryCommandPlan({
    executable: "/opt/omp/bin/omp",
    projectDir: "/scratch/project",
    sessionDir: "/scratch/sessions",
    configPath: "/scratch/config.yml",
  })
  assert.equal(plan.command, "/opt/omp/bin/omp")
  assert.equal(plan.args.includes("--tools"), false)
  assert.equal(plan.args.includes("--extension"), false)
  assert.equal(plan.args.includes("--profile"), false)
  assert.deepEqual(plan.args, [
    "--mode", "rpc",
    "--cwd", "/scratch/project",
    "--session-dir", "/scratch/sessions",
    "--no-skills",
    "--no-rules",
    "--config", "/scratch/config.yml",
    "--auto-approve",
    "--model", "memory-lane-discovery/discovery-model",
    "--max-time", "60",
  ])
})

test("OMP discovery version gate is independent and exact", () => {
  assert.equal(DISCOVERY_OMP_VERSION, "17.1.0")
  assert.doesNotThrow(() => validateOmpDiscoveryVersion("omp v17.1.0"))
  assert.doesNotThrow(() => validateOmpDiscoveryVersion("omp/17.1.0 darwin-arm64"))
  assert.throws(
    () => validateOmpDiscoveryVersion("omp v16.4.8"),
    /OMP discovery requires exactly 17\.1\.0/u,
  )
  assert.throws(
    () => validateOmpDiscoveryVersion("omp v17.1.1"),
    /OMP discovery requires exactly 17\.1\.0/u,
  )
})

test("OMP source-checkout discovery expects every generated bridge memory tool", () => {
  assert.deepEqual(DISCOVERY_EXPECTED_TOOLS, [
    "memory_save",
    "memory_suggest",
    "memory_revise",
    "memory_continuity",
    "memory_recall",
    "memory_get",
  ])
})

// This integration test uses real child-process signals, so fake timers cannot exercise the OS escalation path.
test("OMP discovery shutdown waits for exit and escalates to SIGKILL", {
  skip: process.platform === "win32",
  timeout: 2_000,
}, async () => {
  const child = spawn(process.execPath, [
    "-e",
    "process.on('SIGTERM', () => {}); require('node:net').createServer().listen(0, '127.0.0.1', () => process.stdout.write('ready\\n'))",
  ], { stdio: ["pipe", "pipe", "pipe"] })
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject)
    child.stdout.once("data", () => resolve())
  })
  let exited = false
  child.once("exit", () => {
    exited = true
  })
  await closeRpcChild(child, 25)
  assert.equal(exited, true)
  assert.equal(child.signalCode, "SIGKILL")
})
