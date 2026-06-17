import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { DetectedHarness, Harness } from "./types.js"

export function commandExists(cmd: string): boolean {
  const paths = (process.env.PATH ?? "").split(path.delimiter)
  const extensions = os.platform() === "win32" ? [".exe", ".cmd", ".bat", ".ps1"] : [""]
  for (const dir of paths) {
    for (const ext of extensions) {
      const full = path.join(dir, cmd + ext)
      try {
        if (fs.statSync(full).isFile()) return true
      } catch {
        // continue
      }
    }
  }
  return false
}

export function expandHome(input: string, homeDir: string): string {
  if (input === "~") return homeDir
  if (input.startsWith("~/")) return path.join(homeDir, input.slice(2))
  return input
}

export function detectHarnesses(options: { homeDir: string }): DetectedHarness[] {
  const { homeDir } = options
  const platform = os.platform()

  const claudeDesktopConfig =
    platform === "darwin"
      ? path.join(homeDir, "Library/Application Support/Claude/claude_desktop_config.json")
      : path.join(homeDir, ".config/Claude/claude_desktop_config.json")
  const claudeDesktopApp =
    platform === "darwin"
      ? "/Applications/Claude.app"
      : ""

  const codexDesktopConfig = path.join(homeDir, ".codex/config.toml")

  return [
    {
      harness: "claude-code-cli",
      name: "Claude Code CLI",
      detected: commandExists("claude"),
      configPath: path.join(homeDir, ".claude/settings.json"),
    },
    {
      harness: "codex-cli",
      name: "Codex CLI",
      detected: commandExists("codex"),
      configPath: path.join(homeDir, ".codex/hooks.json"),
    },
    {
      harness: "claude-desktop",
      name: "Claude Desktop",
      detected: fs.existsSync(claudeDesktopConfig) || Boolean(claudeDesktopApp && fs.existsSync(claudeDesktopApp)),
      configPath: claudeDesktopConfig,
    },
    {
      harness: "codex-desktop",
      name: "Codex Desktop",
      detected: fs.existsSync(codexDesktopConfig) || fs.existsSync("/Applications/Codex.app"),
      configPath: codexDesktopConfig,
    },
    {
      harness: "pi",
      name: "pi",
      detected: fs.existsSync(path.join(homeDir, ".pi/agent")),
      configPath: path.join(homeDir, ".pi/agent/extensions/memory-lane/index.ts"),
    },
  ]
}

export function findDetected(harnesses: DetectedHarness[]): DetectedHarness[] {
  return harnesses.filter((h) => h.detected)
}

export function harnessName(harness: Harness): string {
  const names: Record<Harness, string> = {
    "claude-code-cli": "Claude Code CLI",
    "codex-cli": "Codex CLI",
    "claude-desktop": "Claude Desktop",
    "codex-desktop": "Codex Desktop",
    pi: "pi",
  }
  return names[harness]
}
