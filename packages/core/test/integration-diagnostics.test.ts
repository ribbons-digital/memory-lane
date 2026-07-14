import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { diagnoseIntegrations, OMP_CONTRACT_DIAGNOSTIC, resolveOmpAgentDir } from "../src/integration-diagnostics.js"

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "memory-lane-integrations-"))
}

test("reports missing integration configs without creating files", () => {
  const root = tempDir()
  const project = path.join(root, "project")
  const report = diagnoseIntegrations({
    cwd: project,
    paths: {
      claudeDesktopConfig: path.join(root, "Claude", "claude_desktop_config.json"),
      codexUserHooks: path.join(root, ".codex", "hooks.json"),
      codexProjectHooks: path.join(project, ".codex", "hooks.json"),
      claudeCodeUserSettings: [path.join(root, ".claude", "settings.json"), path.join(root, ".claude", "settings.local.json")],
      claudeCodeProjectSettings: path.join(project, ".claude", "settings.local.json"),
      piExtension: path.join(root, ".pi", "agent", "extensions", "memory-lane", "index.ts"),
      ompExtension: path.join(root, ".omp", "agent", "extensions", "memory-lane", "index.ts"),
    },
  })

  assert.equal(report.claudeDesktopMcp.exists, false)
  assert.equal(report.claudeDesktopMcp.configured, false)
  assert.equal(report.codexHooks.user.exists, false)
  assert.equal(report.codexHooks.project.exists, false)
  assert.equal(report.claudeCodeHooks.user.exists, false)
  assert.equal(report.claudeCodeHooks.project.exists, false)
  assert.equal(report.piExtension.exists, false)
  assert.equal(report.piExtension.detected, false)
  assert.equal(report.ompExtension.exists, false)
  assert.equal(report.ompExtension.detected, false)
  assert.equal(report.summary.mcpExplicitToolsOnly, true)
  assert.equal(report.summary.hooksAutomaticLifecycle, true)
  assert.equal(report.summary.piAutosaveEnabled, false)
  assert.ok(report.notes.some((note) => note.includes("MCP provides explicit")))
  assert.equal(fs.existsSync(path.dirname(report.claudeDesktopMcp.checkedPath)), false)
})

test("detects Claude Desktop MCP config", () => {
  const root = tempDir()
  const claudeConfig = path.join(root, "Claude", "claude_desktop_config.json")
  fs.mkdirSync(path.dirname(claudeConfig), { recursive: true })
  fs.writeFileSync(claudeConfig, JSON.stringify({
    mcpServers: {
      "memory-lane": { command: "/home/user/.local/bin/memory-lane", args: ["mcp"] },
    },
  }), "utf8")

  const report = diagnoseIntegrations({ paths: { claudeDesktopConfig: claudeConfig } })

  assert.equal(report.claudeDesktopMcp.exists, true)
  assert.equal(report.claudeDesktopMcp.configured, true)
  assert.equal(report.claudeDesktopMcp.hasCommand, true)
  assert.equal(report.claudeDesktopMcp.hasArgs, true)
  assert.deepEqual(report.claudeDesktopMcp.warnings, [])
})

test("detects Codex and Claude Code hook commands", () => {
  const root = tempDir()
  const project = path.join(root, "project")
  const codexUser = path.join(root, ".codex", "hooks.json")
  const codexProject = path.join(project, ".codex", "hooks.json")
  const claudeUser = path.join(root, ".claude", "settings.json")
  const claudeProject = path.join(project, ".claude", "settings.local.json")
  for (const file of [codexUser, codexProject, claudeUser, claudeProject]) fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(codexUser, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ command: "memory-lane codex user-prompt-submit" }] }] } }), "utf8")
  fs.writeFileSync(codexProject, JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: "memory-lane codex stop" }] }], PostToolUse: [{ hooks: [{ command: "memory-lane codex post-tool-use" }] }] } }), "utf8")
  fs.writeFileSync(claudeUser, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ command: "memory-lane claude user-prompt-submit" }] }], Stop: [{ hooks: [{ command: "memory-lane claude stop" }] }] } }), "utf8")
  fs.writeFileSync(claudeProject, JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ command: "memory-lane claude post-tool-use" }] }] } }), "utf8")

  const report = diagnoseIntegrations({ cwd: project, paths: {
    codexUserHooks: codexUser,
    codexProjectHooks: codexProject,
    claudeCodeUserSettings: [claudeUser, path.join(root, ".claude", "settings.local.json")],
    claudeCodeProjectSettings: claudeProject,
  } })

  assert.deepEqual(report.codexHooks.user.commands, { userPromptSubmit: true, stop: false, postToolUse: false })
  assert.deepEqual(report.codexHooks.project.commands, { userPromptSubmit: false, stop: true, postToolUse: true })
  assert.deepEqual(report.codexHooks.warnings, [])
  assert.deepEqual(report.claudeCodeHooks.user.commands, { userPromptSubmit: true, stop: true, postToolUse: false })
  assert.deepEqual(report.claudeCodeHooks.project.commands, { userPromptSubmit: false, stop: false, postToolUse: true })
})

test("warns when Codex user and project hooks both run the same Memory Lane command", () => {
  const root = tempDir()
  const project = path.join(root, "project")
  const codexUser = path.join(root, ".codex", "hooks.json")
  const codexProject = path.join(project, ".codex", "hooks.json")
  for (const file of [codexUser, codexProject]) fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(codexUser, JSON.stringify({
    hooks: {
      Stop: [{ hooks: [{ command: "memory-lane codex stop" }] }],
      UserPromptSubmit: [{ hooks: [{ command: "memory-lane codex user-prompt-submit" }] }],
    },
  }), "utf8")
  fs.writeFileSync(codexProject, JSON.stringify({
    hooks: {
      Stop: [{ hooks: [{ command: "MEMORY_LANE_HOOK_DEBUG=1 memory-lane codex stop" }] }],
    },
  }), "utf8")

  const report = diagnoseIntegrations({ cwd: project, paths: { codexUserHooks: codexUser, codexProjectHooks: codexProject } })

  assert.deepEqual(report.codexHooks.warnings, [
    `Memory Lane Codex stop hook is configured in both user (${codexUser}) and project (${codexProject}) scopes; both hooks may run and create duplicate saves. Keep only one scope enabled unless this is intentional.`,
  ])
})

test("detects pi extension and reports malformed JSON warnings without throwing", () => {
  const root = tempDir()
  const badJson = path.join(root, ".codex", "hooks.json")
  const piExtension = path.join(root, ".pi", "agent", "extensions", "memory-lane", "index.ts")
  fs.mkdirSync(path.dirname(badJson), { recursive: true })
  fs.mkdirSync(path.dirname(piExtension), { recursive: true })
  fs.writeFileSync(badJson, "{ invalid json", "utf8")
  fs.writeFileSync(piExtension, "export default async function memoryLaneExtension(pi) { return import('@memory-lane/pi-adapter') }", "utf8")

  const report = diagnoseIntegrations({ paths: { codexUserHooks: badJson, piExtension } })

  assert.equal(report.codexHooks.user.exists, true)
  assert.equal(report.codexHooks.user.configured, false)
  assert.match(report.codexHooks.user.warnings.join("\n"), /Invalid JSON/u)
  assert.equal(report.piExtension.exists, true)
  assert.equal(report.piExtension.detected, true)
})

test("resolves the OMP default profile root without filesystem access", () => {
  const home = path.join(tempDir(), "home")
  assert.equal(resolveOmpAgentDir({}, home), path.join(home, ".omp", "agent"))
  assert.equal(fs.existsSync(home), false)
})

test("resolves an explicit OMP agent root like OMP default-profile mode", () => {
  const root = tempDir()
  assert.equal(resolveOmpAgentDir({ PI_CODING_AGENT_DIR: "custom-agent" }, path.join(root, "home")), path.resolve("custom-agent"))
  assert.equal(resolveOmpAgentDir({ PI_CODING_AGENT_DIR: path.join(root, "absolute-agent") }, path.join(root, "home")), path.join(root, "absolute-agent"))
})

test("diagnoses Pi and OMP extensions independently with explicit warnings", () => {
  const root = tempDir()
  const piExtension = path.join(root, ".pi", "agent", "extensions", "memory-lane", "index.ts")
  const ompExtension = path.join(root, ".omp", "agent", "extensions", "memory-lane", "index.ts")
  fs.mkdirSync(path.dirname(piExtension), { recursive: true })
  fs.mkdirSync(path.dirname(ompExtension), { recursive: true })
  fs.writeFileSync(piExtension, "export default async function memoryLaneExtension() {}", "utf8")
  fs.writeFileSync(ompExtension, "export default async function memoryLaneExtension() {}", "utf8")

  const report = diagnoseIntegrations({
    paths: { piExtension, ompExtension },
    warnings: { ompExtension: ["manifest warning"] },
    homeDir: root,
    env: {},
  })

  assert.equal(report.piExtension.detected, true)
  assert.equal(report.ompExtension.detected, true)
  assert.equal(report.ompExtension.checkedPath, ompExtension)
  assert.deepEqual(report.ompExtension.warnings, ["manifest warning"])
  assert.deepEqual(report.ompExtension.contract, OMP_CONTRACT_DIAGNOSTIC)
})

test("reports an unusable manifest-recorded OMP target without default substitution", () => {
  const root = tempDir()
  const report = diagnoseIntegrations({
    paths: { ompExtension: null },
    warnings: { ompExtension: ["Install manifest omp configPath must be absolute."] },
    homeDir: root,
    env: {},
  })
  assert.equal(report.ompExtension.checkedPath, null)
  assert.equal(report.ompExtension.exists, false)
  assert.equal(report.ompExtension.detected, false)
  assert.deepEqual(report.ompExtension.warnings, ["Install manifest omp configPath must be absolute."])
  assert.deepEqual(report.ompExtension.contract, OMP_CONTRACT_DIAGNOSTIC)
  assert.equal(fs.existsSync(path.join(root, ".omp")), false)
})
