import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
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

test("queues npm install failure as pending when cwd has pnpm lockfile", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-pnpm-lock-"))
  fs.writeFileSync(path.join(cwd, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8")

  const candidates = summarizeToolOutcome({
    cwd,
    toolName: "Bash",
    toolInput: { command: "npm install left-pad" },
    toolResponse: { output: "install failed with dependency resolution error", exit_code: 1 },
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].decision, "save-pending")
  assert.match(candidates[0].text, /pnpm/i)
})

test("inspects known output fields without stringifying huge responses", () => {
  const candidates = summarizeToolOutcome({
    cwd: process.cwd(),
    toolName: "Bash",
    toolInput: { command: "npm install left-pad" },
    toolResponse: {
      huge: "x".repeat(100_000),
      output: "pnpm-lock.yaml exists; npm install would update package-lock",
      exit_code: 1,
      toJSON() { throw new Error("must not stringify entire response") },
    },
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].decision, "save-pending")
})

test("summarizes failed npm test recovered by successful pnpm test as pending procedure", () => {
  const candidates = summarizeToolOutcome({
    cwd: process.cwd(),
    toolName: "Bash",
    toolInput: { command: "pnpm test" },
    toolResponse: { output: "Tests passed", exit_code: 0 },
    recentToolUses: [{
      toolName: "Bash",
      toolInput: { command: "npm test" },
      toolResponse: { stderr: "missing script: test -- raw output should not be copied", exit_code: 1 },
    }],
  })

  assert.equal(candidates.length, 1)
  const procedure = candidates.find((candidate) => candidate.kind === "procedure")
  assert.ok(procedure)
  assert.equal(procedure.decision, "save-pending")
  assert.equal(procedure.category, "project")
  assert.match(procedure.text, /^Procedure:/u)
  assert.match(procedure.text, /When:/u)
  assert.match(procedure.text, /Steps:/u)
  assert.match(procedure.text, /Pitfall:/u)
  assert.match(procedure.text, /Verify:/u)
  assert.doesNotMatch(procedure.text, /raw output should not be copied/u)
})

test("summarizes failed build recovered by successful pnpm build as pending procedure", () => {
  const candidates = summarizeToolOutcome({
    cwd: process.cwd(),
    toolName: "Bash",
    toolInput: { command: "pnpm build" },
    toolResponse: { output: "Build succeeded", exit_code: 0 },
    recentToolUses: [{
      toolName: "Bash",
      toolInput: { command: "npm run build" },
      toolResponse: { stderr: "build failed", exit_code: 1 },
    }],
  })

  assert.equal(candidates.length, 1)
  const procedure = candidates.find((candidate) => candidate.kind === "procedure")
  assert.ok(procedure)
  assert.match(procedure.text, /Use pnpm for builds/u)
  assert.equal(procedure.decision, "save-pending")
})

test("summarizes failed npm install recovered by successful pnpm install as pending procedure", () => {
  const candidates = summarizeToolOutcome({
    cwd: process.cwd(),
    toolName: "Bash",
    toolInput: { command: "pnpm install" },
    toolResponse: { output: "Already up to date", exit_code: 0 },
    recentToolUses: [{
      toolName: "Bash",
      toolInput: { command: "npm install left-pad" },
      toolResponse: { stderr: "dependency conflict", exit_code: 1 },
    }],
  })

  assert.equal(candidates.length, 1)
  const procedure = candidates.find((candidate) => candidate.kind === "procedure")
  assert.ok(procedure)
  assert.match(procedure.text, /Use pnpm for package installation/u)
  assert.equal(procedure.decision, "save-pending")
})

test("does not create recovery procedure from secret-like prior output", () => {
  const candidates = summarizeToolOutcome({
    cwd: process.cwd(),
    toolName: "Bash",
    toolInput: { command: "pnpm test" },
    toolResponse: { output: "Tests passed", exit_code: 0 },
    recentToolUses: [{
      toolName: "Bash",
      toolInput: { command: "npm test" },
      toolResponse: { stderr: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz1234567890", exit_code: 1 },
    }],
  })

  assert.equal(candidates.some((candidate) => candidate.kind === "procedure"), false)
})
