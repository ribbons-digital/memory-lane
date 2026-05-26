import test from "node:test"
import assert from "node:assert/strict"
import { isShellToolName, summarizeToolOutcome } from "../src/tool-outcomes.ts"

test("identifies shell-like tools", () => {
  assert.equal(isShellToolName("Bash"), true)
  assert.equal(isShellToolName("shell:local"), true)
  assert.equal(isShellToolName("mcp__browser"), false)
})

test("summarizes successful pnpm test as approved workflow", () => {
  const candidates = summarizeToolOutcome({
    cwd: process.cwd(),
    toolName: "Bash",
    toolInput: { command: "pnpm test" },
    toolResponse: { output: "Tests passed", exit_code: 0 },
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].text, "`pnpm test` is the test command for this repo.")
  assert.equal(candidates[0].decision, "save-approved")
  assert.equal(candidates[0].kind, "workflow_rule")
})

test("ignores ordinary successful shell commands", () => {
  const candidates = summarizeToolOutcome({
    cwd: process.cwd(),
    toolName: "Bash",
    toolInput: { command: "ls -la" },
    toolResponse: { output: "package.json", exit_code: 0 },
  })

  assert.deepEqual(candidates, [])
})

test("queues npm install failure in pnpm repo as pending", () => {
  const candidates = summarizeToolOutcome({
    cwd: process.cwd(),
    toolName: "Bash",
    toolInput: { command: "npm install left-pad" },
    toolResponse: { output: "pnpm-lock.yaml exists; npm install would update package-lock", exit_code: 1 },
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].decision, "save-pending")
  assert.match(candidates[0].text, /pnpm/i)
})
