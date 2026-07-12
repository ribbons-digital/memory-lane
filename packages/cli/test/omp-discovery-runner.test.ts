import { test } from "node:test"
import assert from "node:assert/strict"
import { ompDiscoveryCommandPlan } from "./omp-discovery-runner.js"

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
