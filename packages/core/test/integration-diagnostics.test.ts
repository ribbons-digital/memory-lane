import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { diagnoseIntegrations } from "../src/integration-diagnostics.js"

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
  assert.equal(report.summary.mcpExplicitToolsOnly, true)
  assert.equal(report.summary.hooksAutomaticLifecycle, true)
  assert.equal(report.summary.piAutosaveEnabled, false)
  assert.ok(report.notes.some((note) => note.includes("MCP provides explicit")))
  assert.equal(fs.existsSync(path.dirname(report.claudeDesktopMcp.checkedPath)), false)
})
