import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { tempDir } from "../../core/test/helpers.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createFakeBinDir(): string {
  const dir = tempDir()
  for (const cmd of ["claude", "codex"]) {
    const file = path.join(dir, cmd)
    fs.writeFileSync(file, "#!/bin/sh\necho fake\n", "utf8")
    fs.chmodSync(file, 0o755)
  }
  return dir
}

function createFakeMemoryLaneSourceRoot(): { root: string; skillDir: string; skillPath: string; sentinel: string } {
  const root = tempDir()
  const skillDir = path.join(root, "skills", "memory-lane")
  const skillPath = path.join(skillDir, "SKILL.md")
  const sentinel = "SOURCE SKILL SENTINEL\n"
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "memory-lane" }), "utf8")
  fs.writeFileSync(skillPath, sentinel, "utf8")
  return { root, skillDir, skillPath, sentinel }
}

describe("init wizard", () => {
  let home: string
  let binaryPath: string
  let fakeBinDir: string

  function run(args: string[], env?: NodeJS.ProcessEnv, cwd?: string, stdin?: string) {
    const cli = path.resolve(__dirname, "../dist/index.js")
    return execFileSync("node", [cli, ...args], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH}`, ...env },
      cwd,
      input: stdin,
    }).trim()
  }

  beforeEach(() => {
    home = tempDir()
    fakeBinDir = createFakeBinDir()
    binaryPath = path.resolve(__dirname, "../dist/index.js")
    fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true })
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true })
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true })
    fs.mkdirSync(path.join(home, ".config", "Claude"), { recursive: true })
    fs.writeFileSync(path.join(home, ".config", "Claude", "claude_desktop_config.json"), "{}", "utf8")
    fs.mkdirSync(path.join(home, "Library", "Application Support", "Claude"), { recursive: true })
    fs.writeFileSync(path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"), "{}", "utf8")
  })

  afterEach(() => {
    fs.rmSync(fakeBinDir, { recursive: true, force: true })
  })

  it("writes pi extension in --yes mode", () => {
    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const piExt = path.join(home, ".pi/agent/extensions/memory-lane/index.ts")
    assert.ok(fs.existsSync(piExt))
    const content = fs.readFileSync(piExt, "utf8")
    assert.ok(content.includes("memoryLaneExtension"))
    assert.ok(content.includes(path.resolve(__dirname, "../../pi-adapter/dist/index.js")))
    assert.equal(content.includes(`import("file://${binaryPath}`), false)
  })

  it("writes a loadable pi CLI bridge instead of importing native binaries", () => {
    const nativeBinary = path.join(home, ".local/bin/memory-lane")
    fs.mkdirSync(path.dirname(nativeBinary), { recursive: true })
    fs.writeFileSync(nativeBinary, "\u0000Mach-O fake binary", "utf8")

    run(["init", "--yes", "--only", "pi"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: nativeBinary,
    })

    const piExt = path.join(home, ".pi/agent/extensions/memory-lane/index.ts")
    const content = fs.readFileSync(piExt, "utf8")
    assert.ok(content.includes("memoryLaneCliBridge"))
    assert.ok(content.includes(nativeBinary))
    assert.equal(content.includes(`import("file://${nativeBinary}`), false)

    const smoke = `
      const mod = await import("file://" + process.env.PI_EXTENSION_FILE);
      const fn = typeof mod.default === "function" ? mod.default : mod.default?.default;
      const pi = { commands: [], tools: [], events: [], registerCommand(name) { this.commands.push(name) }, registerTool(tool) { this.tools.push(tool.name) }, on(name) { this.events.push(name) } };
      fn(pi);
      if (!pi.commands.includes("memory") || !pi.tools.includes("memory_save") || !pi.tools.includes("memory_continuity") || !pi.tools.includes("memory_get") || !pi.events.includes("before_agent_start")) process.exit(1);
    `
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", smoke], {
      encoding: "utf8",
      env: { ...process.env, PI_EXTENSION_FILE: piExt },
    })
  })

  it("routes broad pi before_agent_start continuity prompts to continuity query", () => {
    const nativeBinary = path.join(home, ".local/bin/memory-lane")
    const logPath = path.join(home, "calls.jsonl")
    fs.mkdirSync(path.dirname(nativeBinary), { recursive: true })
    fs.writeFileSync(nativeBinary, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n");
if (args[0] === "status") {
  console.log(JSON.stringify({ data: { contextPolicyMode: "selective", contextPolicyPromptMaxItems: 2 } }));
} else if (args[0] === "continuity") {
  console.log(JSON.stringify({ data: { latestApproved: { project: { id: "latest1", preview: "PR #51 merged and v0.2.28 released." } }, workstreamDiscovery: { candidates: [{ id: "latest1", preview: "PR #51 merged and v0.2.28 released." }], suggestedActions: ["memory-lane continuity --json"] }, suggestedActions: ["memory-lane continuity --json"], answerGuidance: ["Verify against repository state."] } }));
} else if (args[0] === "recall") {
  console.log(JSON.stringify({ data: { memories: [{ id: "wrong", text: "Plain recall should not be used for broad continuity." }] } }));
} else {
  console.log(JSON.stringify({ data: {} }));
}
`, "utf8")
    fs.chmodSync(nativeBinary, 0o755)

    run(["init", "--yes", "--only", "pi"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: nativeBinary,
    })

    const piExt = path.join(home, ".pi/agent/extensions/memory-lane/index.ts")
    const smoke = `
      const mod = await import("file://" + process.env.PI_EXTENSION_FILE);
      const fn = typeof mod.default === "function" ? mod.default : mod.default?.default;
      const handlers = {};
      const tools = {};
      const pi = { registerCommand() {}, registerTool(tool) { tools[tool.name] = tool }, on(name, handler) { handlers[name] = handler } };
      fn(pi);
      const prompts = [
        "What were we last working on?",
        "Where are we in the project?",
        "What's the latest progress?",
        "Where did we leave off?",
        "Where was lifecycle continuity implemented?",
        "Let's resume building prompt continuity intents",
      ];
      for (const prompt of prompts) {
        const result = await handlers.before_agent_start({ prompt }, { cwd: process.cwd() });
        if (!result?.message || result.message.customType !== "memory-lane") throw new Error("expected memory-lane message");
        if (!result.message.content.includes("Memory Lane continuity context")) throw new Error("expected continuity context");
        if (!result.message.content.includes("latest1")) throw new Error("expected continuity candidate");
      }
      const toolResult = await tools.memory_continuity.execute("tool-1", { query: "what were we last working on?" }, undefined, undefined, { cwd: process.cwd() });
      if (!toolResult.content[0].text.includes("Memory Lane continuity context")) throw new Error("expected continuity tool context");
      if (!toolResult.content[0].text.includes("latest1")) throw new Error("expected continuity tool candidate");
    `
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", smoke], {
      encoding: "utf8",
      env: { ...process.env, PI_EXTENSION_FILE: piExt },
    })

    const calls = fs.readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    for (const prompt of [
      "What were we last working on?",
      "Where are we in the project?",
      "What's the latest progress?",
      "Where did we leave off?",
      "Where was lifecycle continuity implemented?",
      "Let's resume building prompt continuity intents",
    ]) {
      assert.ok(calls.some((args) => args[0] === "continuity" && args.includes("--query") && args.includes(prompt)), `expected continuity call for ${prompt}`)
    }
    assert.equal(calls.some((args) => args[0] === "recall"), false)
  })

  it("emits pi CLI bridge policy-only guidance without memory body lookup", () => {
    const nativeBinary = path.join(home, ".local/bin/memory-lane")
    const logPath = path.join(home, "policy-only-calls.jsonl")
    fs.mkdirSync(path.dirname(nativeBinary), { recursive: true })
    fs.writeFileSync(nativeBinary, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n");
if (args[0] === "status") {
  console.log(JSON.stringify({ data: { contextPolicyMode: "policy-only", contextPolicyPromptMaxItems: 2 } }));
} else if (args[0] === "continuity" || args[0] === "recall") {
  console.log(JSON.stringify({ data: { shouldNotBeRead: true } }));
} else {
  console.log(JSON.stringify({ data: {} }));
}
`, "utf8")
    fs.chmodSync(nativeBinary, 0o755)

    run(["init", "--yes", "--only", "pi"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: nativeBinary,
    })

    const piExt = path.join(home, ".pi/agent/extensions/memory-lane/index.ts")
    const smoke = `
      const mod = await import("file://" + process.env.PI_EXTENSION_FILE);
      const fn = typeof mod.default === "function" ? mod.default : mod.default?.default;
      const handlers = {};
      const pi = { registerCommand() {}, registerTool() {}, on(name, handler) { handlers[name] = handler } };
      fn(pi);
      const result = await handlers.before_agent_start({ prompt: "What were we last working on?" }, { cwd: process.cwd() });
      if (!result?.message || result.message.customType !== "memory-lane") throw new Error("expected memory-lane message");
      if (!result.message.content.includes("Memory Lane continuity guidance")) throw new Error("expected continuity guidance");
      if (!result.message.content.includes("memory-lane continuity --json")) throw new Error("expected continuity command guidance");
      if (result.message.content.includes("shouldNotBeRead")) throw new Error("policy-only leaked lookup body");
    `
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", smoke], {
      encoding: "utf8",
      env: { ...process.env, PI_EXTENSION_FILE: piExt },
    })

    const calls = fs.readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    assert.equal(calls.some((args) => args[0] === "continuity"), false)
    assert.equal(calls.some((args) => args[0] === "recall"), false)
  })

  it("writes pi CLI bridge before_agent_start messages with Pi's custom message shape", () => {
    const nativeBinary = path.join(home, ".local/bin/memory-lane")
    fs.mkdirSync(path.dirname(nativeBinary), { recursive: true })
    fs.writeFileSync(nativeBinary, `#!/bin/sh
case "$1" in
  status)
    printf '%s\n' '{"data":{"contextPolicyMode":"auto","contextPolicyPromptMaxItems":2}}'
    ;;
  recall)
    printf '%s\n' '{"data":{"memories":[{"id":"abc12345","text":"Use object-shaped Pi custom messages."}]}}'
    ;;
  *)
    printf '%s\n' '{"data":{}}'
    ;;
esac
`, "utf8")
    fs.chmodSync(nativeBinary, 0o755)

    run(["init", "--yes", "--only", "pi"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: nativeBinary,
    })

    const piExt = path.join(home, ".pi/agent/extensions/memory-lane/index.ts")
    const smoke = `
      const mod = await import("file://" + process.env.PI_EXTENSION_FILE);
      const fn = typeof mod.default === "function" ? mod.default : mod.default?.default;
      const handlers = {};
      const pi = { registerCommand() {}, registerTool() {}, on(name, handler) { handlers[name] = handler } };
      fn(pi);
      const result = await handlers.before_agent_start({ prompt: "test prompt" }, { cwd: process.cwd() });
      if (!result?.message || typeof result.message !== "object") throw new Error("expected object-shaped custom message");
      if (result.message.customType !== "memory-lane") throw new Error("expected memory-lane customType");
      if (typeof result.message.content !== "string" || !result.message.content.includes("abc12345")) throw new Error("expected memory content");
      if (result.message.display !== false) throw new Error("expected non-displayed context injection");
      if (result.message.details?.source !== "memory-lane" || result.message.details?.lifecycleEvent !== "user_prompt_submit") throw new Error("expected memory-lane details");
    `
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", smoke], {
      encoding: "utf8",
      env: { ...process.env, PI_EXTENSION_FILE: piExt },
    })
  })

  it("writes install manifest", () => {
    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const manifest = JSON.parse(fs.readFileSync(path.join(home, ".memory-lane/install.json"), "utf8"))
    assert.equal(manifest.binaryPath, binaryPath)
    assert.ok(Array.isArray(manifest.integrations))
    assert.ok(manifest.integrations.some((i: any) => i.harness === "pi"))
  })

  it("writes Claude Desktop MCP config in --yes mode", () => {
    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const configPath =
      process.platform === "darwin"
        ? path.join(home, "Library/Application Support/Claude/claude_desktop_config.json")
        : path.join(home, ".config/Claude/claude_desktop_config.json")
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    assert.ok(config.mcpServers["memory-lane"])
    assert.equal(config.mcpServers["memory-lane"].command, binaryPath)
    assert.deepEqual(config.mcpServers["memory-lane"].args, ["mcp"])
  })

  it("lists selectable integrations without configuring them", () => {
    const output = run(["init", "--list"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    assert.match(output, /Claude Code CLI/u)
    assert.match(output, /Claude Desktop/u)
    assert.match(output, /Codex Desktop/u)
    assert.equal(fs.existsSync(path.join(home, ".memory-lane/install.json")), false)
  })

  it("--only configures an explicitly selected undetected Claude Desktop", () => {
    const configPath =
      process.platform === "darwin"
        ? path.join(home, "Library/Application Support/Claude/claude_desktop_config.json")
        : path.join(home, ".config/Claude/claude_desktop_config.json")
    fs.rmSync(configPath, { force: true })

    run(["init", "--only", "claude-desktop"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    assert.ok(config.mcpServers["memory-lane"])
  })

  it("interactive numbered selection can choose an undetected integration", () => {
    const configPath =
      process.platform === "darwin"
        ? path.join(home, "Library/Application Support/Claude/claude_desktop_config.json")
        : path.join(home, ".config/Claude/claude_desktop_config.json")
    fs.rmSync(configPath, { force: true })

    const output = run(["init"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    }, undefined, "3\n")

    assert.match(output, /Select integrations/u)
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    assert.ok(config.mcpServers["memory-lane"])
  })

  it("preserves existing unrelated settings when adding MCP server", () => {
    const configPath =
      process.platform === "darwin"
        ? path.join(home, "Library/Application Support/Claude/claude_desktop_config.json")
        : path.join(home, ".config/Claude/claude_desktop_config.json")
    fs.writeFileSync(configPath, JSON.stringify({ theme: "dark" }), "utf8")

    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    assert.equal(config.theme, "dark")
    assert.ok(config.mcpServers["memory-lane"])
  })

  it("overwrites existing config in --yes mode", () => {
    const configPath = path.join(home, ".claude/settings.json")
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: `${binaryPath} claude session-start` }] }],
        },
      }),
      "utf8",
    )

    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    assert.ok(config.hooks.UserPromptSubmit)
  })

  it("writes project-level Claude Code hooks with --project", () => {
    const project = tempDir()
    run(["init", "--yes", "--project", project], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const configPath = path.join(project, ".claude/settings.local.json")
    assert.ok(fs.existsSync(configPath))
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    assert.ok(config.hooks.SessionStart)
    assert.ok(config.hooks.UserPromptSubmit)
    assert.ok(config.hooks.Stop)
    assert.ok(config.hooks.PostToolUse)
    assert.ok(config.hooks.SessionStart[0].hooks[0].command.includes(`${binaryPath} claude session-start`))
  })

  it("installs Claude Code skill for slash command access", () => {
    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const skillPath = path.join(home, ".claude/skills/memory-lane/SKILL.md")
    assert.ok(fs.existsSync(skillPath))
    const content = fs.readFileSync(skillPath, "utf8")
    assert.ok(content.includes("name: memory-lane"))
    assert.ok(content.includes(binaryPath))
    assert.ok(content.includes("authoritative list"))
    assert.ok(content.includes("memory-lane list --json"))
  })

  it("installs Codex skill for slash command access", () => {
    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const skillPath = path.join(home, ".agents/skills/memory-lane/SKILL.md")
    assert.ok(fs.existsSync(skillPath))
    const content = fs.readFileSync(skillPath, "utf8")
    assert.ok(content.includes("name: memory-lane"))
    assert.ok(content.includes(binaryPath))
  })

  it("skips Codex skill write when destination resolves into Memory Lane source", () => {
    const source = createFakeMemoryLaneSourceRoot()
    const skillParent = path.join(home, ".agents", "skills")
    fs.mkdirSync(skillParent, { recursive: true })
    fs.rmSync(path.join(home, ".agents", "skills", "memory-lane"), { recursive: true, force: true })
    fs.symlinkSync(source.skillDir, path.join(skillParent, "memory-lane"), "dir")

    const output = run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    assert.equal(fs.readFileSync(source.skillPath, "utf8"), source.sentinel)
    assert.match(output, /skipped Memory Lane skill write/u)
    assert.match(output, /source checkout/u)
    assert.ok(fs.existsSync(path.join(home, ".codex", "hooks.json")))
  })

  it("skips Claude skill write when destination resolves into Memory Lane source", () => {
    const source = createFakeMemoryLaneSourceRoot()
    const skillParent = path.join(home, ".claude", "skills")
    fs.mkdirSync(skillParent, { recursive: true })
    fs.rmSync(path.join(home, ".claude", "skills", "memory-lane"), { recursive: true, force: true })
    fs.symlinkSync(source.skillDir, path.join(skillParent, "memory-lane"), "dir")

    const output = run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    assert.equal(fs.readFileSync(source.skillPath, "utf8"), source.sentinel)
    assert.match(output, /skipped Memory Lane skill write/u)
    assert.match(output, /source checkout/u)
    assert.ok(fs.existsSync(path.join(home, ".claude", "settings.json")))
  })

  it("allows Codex skill writes inside non-Memory-Lane dotfiles repos", () => {
    const dotfilesRoot = path.join(home, ".agents")
    fs.mkdirSync(path.join(dotfilesRoot, ".git"), { recursive: true })
    fs.writeFileSync(path.join(dotfilesRoot, "package.json"), JSON.stringify({ name: "dotfiles" }), "utf8")

    const output = run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const skillPath = path.join(home, ".agents/skills/memory-lane/SKILL.md")
    assert.ok(fs.existsSync(skillPath))
    assert.match(fs.readFileSync(skillPath, "utf8"), /name: memory-lane/u)
    assert.doesNotMatch(output, /skipped Memory Lane skill write/u)
  })

  it("writes Codex Desktop TOML config in --yes mode", () => {
    fs.writeFileSync(path.join(home, ".codex/config.toml"), "model = \"gpt-5.5\"\n", "utf8")

    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const configPath = path.join(home, ".codex/config.toml")
    const content = fs.readFileSync(configPath, "utf8")
    assert.ok(content.includes("[mcp_servers.memory-lane]"))
    assert.ok(content.includes(`command = "${binaryPath}"`))
    assert.ok(content.includes('args = ["mcp"]'))
    assert.ok(content.includes("enabled = true"))
    assert.ok(content.includes('model = "gpt-5.5"'))
  })
})
