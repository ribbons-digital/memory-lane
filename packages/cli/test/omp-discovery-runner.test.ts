import { spawn } from "node:child_process"
import { test } from "node:test"
import assert from "node:assert/strict"
import { closeRpcChild, ompDiscoveryCommandPlan } from "./omp-discovery-runner.js"

test("OMP discovery launch uses normal extension loading without --extension or profiles", () => {
  const plan = ompDiscoveryCommandPlan({
    executable: "/opt/omp/bin/omp",
    projectDir: "/scratch/project",
    sessionDir: "/scratch/sessions",
    configPath: "/scratch/config.yml",
  })
  assert.equal(plan.command, "/opt/omp/bin/omp")
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
