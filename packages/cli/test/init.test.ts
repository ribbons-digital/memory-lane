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

  function writeNativeMemoryLaneStub(logFileName: string, commandLogic: string): { nativeBinary: string; logPath: string } {
    const nativeBinary = path.join(home, ".local/bin/memory-lane")
    const logPath = path.join(home, logFileName)
    fs.mkdirSync(path.dirname(nativeBinary), { recursive: true })
    fs.writeFileSync(nativeBinary, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
let stdin = "";
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ args, stdin }) + "\\n");
${commandLogic.split("\n").map((line) => `  ${line}`).join("\n")}
  process.exit(0);
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { stdin += chunk; });
process.stdin.on("end", finish);
process.stdin.resume();
if (!(args[0] === "pi" && args[1] === "pre-compact")) setImmediate(finish);
`, "utf8")
    fs.chmodSync(nativeBinary, 0o755)
    return { nativeBinary, logPath }
  }

  function installPiCliBridge(nativeBinary: string): string {
    run(["init", "--yes", "--only", "pi"], { HOME: home, MEMORY_LANE_INSTALL_BINARY: nativeBinary })
    return path.join(home, ".pi/agent/extensions/memory-lane/index.ts")
  }

  function runPiBridgeSmoke(piExt: string, smoke: string): void {
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", smoke], {
      encoding: "utf8",
      env: { ...process.env, PI_EXTENSION_FILE: piExt },
    })
  }

  function readJsonlEntries(logPath: string): Array<{ args: string[]; stdin: string }> {
    return fs.readFileSync(logPath, "utf8").trim().split("\n").map((line) => {
      const parsed = JSON.parse(line)
      return Array.isArray(parsed) ? { args: parsed as string[], stdin: "" } : parsed as { args: string[]; stdin: string }
    })
  }

  function readJsonlCalls(logPath: string): string[][] {
    return readJsonlEntries(logPath).map((entry) => entry.args)
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
      if (!pi.commands.includes("memory") || !pi.tools.includes("memory_save") || !pi.tools.includes("memory_continuity") || !pi.tools.includes("memory_get") || !pi.events.includes("before_agent_start") || !pi.events.includes("session_before_compact")) process.exit(1);
    `
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", smoke], {
      encoding: "utf8",
      env: { ...process.env, PI_EXTENSION_FILE: piExt },
    })
  })

  it("generated pi CLI bridge forwards session_before_compact to pi pre-compact", () => {
    const { nativeBinary, logPath } = writeNativeMemoryLaneStub("precompact-calls.jsonl", `if (args[0] === "pi" && args[1] === "pre-compact") {
  console.log(JSON.stringify({ ok: true, data: { saved: 1 } }));
} else {
  console.log(JSON.stringify({ data: {} }));
}`)

    const piExt = installPiCliBridge(nativeBinary)
    runPiBridgeSmoke(piExt, `
      const mod = await import("file://" + process.env.PI_EXTENSION_FILE);
      const fn = typeof mod.default === "function" ? mod.default : mod.default?.default;
      const handlers = {};
      const notifications = [];
      const pi = { registerCommand() {}, registerTool() {}, on(name, handler) { handlers[name] = handler } };
      fn(pi);
      if (typeof handlers.session_before_compact !== "function") throw new Error("expected session_before_compact handler");
      const result = await handlers.session_before_compact({
        reason: "manual",
        turnId: "turn-generated",
        preparation: {
          messagesToSummarize: [
            { role: "user", content: [{ type: "text", text: "User compaction text" }] },
            { role: "assistant", content: "Assistant compaction text" },
          ],
          turnPrefixMessages: [
            { role: "tool", content: [{ type: "text", text: "Tool compaction text" }], toolName: "bash" },
          ],
        },
      }, {
        cwd: "/tmp/pi-generated-bridge-project",
        ui: { notify(message, level) { notifications.push({ message, level }) } },
        sessionManager: { getSessionFile() { return "/tmp/pi-session.json" }, getBranch() { return [] } },
      });
      if (result !== undefined) throw new Error("expected precompact bridge to leave host compaction untouched");
      const started = Date.now();
      while (!notifications.some((item) => item.message.includes("pending pre-compact summary") && item.level === "info") && Date.now() - started < 1000) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (!notifications.some((item) => item.message.includes("pending pre-compact summary") && item.level === "info")) throw new Error("expected pending summary notification");
    `)

    const entries = readJsonlEntries(logPath)
    assert.equal(entries.length, 1)
    assert.deepEqual(entries[0].args, ["pi", "pre-compact", "--json", "--project", "/tmp/pi-generated-bridge-project"])
    const payload = JSON.parse(entries[0].stdin)
    assert.equal(payload.cwd, "/tmp/pi-generated-bridge-project")
    assert.equal(payload.session_id, "/tmp/pi-session.json")
    assert.equal(payload.turn_id, "turn-generated")
    assert.equal(payload.trigger, "manual")
    assert.deepEqual(payload.messages.map((message: any) => message.role), ["user", "assistant", "tool"])
    assert.equal(payload.messages[0].content, "User compaction text")
    assert.equal(payload.messages[1].content, "Assistant compaction text")
    assert.equal(payload.messages[2].content, "Tool compaction text")
    assert.equal(payload.messages[2].toolName, "bash")
  })

  it("generated pi CLI bridge does not block compaction on slow pre-compact work", () => {
    const { nativeBinary } = writeNativeMemoryLaneStub("slow-precompact-calls.jsonl", `if (args[0] === "pi" && args[1] === "pre-compact") {
  const until = Date.now() + 600;
  while (Date.now() < until) {}
  console.log(JSON.stringify({ ok: true, data: { saved: 0 } }));
} else {
  console.log(JSON.stringify({ data: {} }));
}`)

    const piExt = installPiCliBridge(nativeBinary)
    runPiBridgeSmoke(piExt, `
      const mod = await import("file://" + process.env.PI_EXTENSION_FILE);
      const fn = typeof mod.default === "function" ? mod.default : mod.default?.default;
      const handlers = {};
      const pi = { registerCommand() {}, registerTool() {}, on(name, handler) { handlers[name] = handler } };
      fn(pi);
      const started = Date.now();
      const result = await handlers.session_before_compact({
        preparation: { messagesToSummarize: [{ role: "user", content: "Slow compaction text" }] },
      }, { cwd: "/tmp/pi-generated-bridge-project" });
      const duration = Date.now() - started;
      if (result !== undefined) throw new Error("expected precompact bridge to leave host compaction untouched");
      if (duration > 200) throw new Error("expected precompact bridge to return immediately, took " + duration + "ms");
    `)
  })

  it("routes broad pi before_agent_start continuity prompts to continuity query", () => {
    const { nativeBinary, logPath } = writeNativeMemoryLaneStub("calls.jsonl", `if (args[0] === "status") {
  console.log(JSON.stringify({ data: { contextPolicyMode: "selective", contextPolicyPromptMaxItems: 2 } }));
} else if (args[0] === "route") {
  console.log(JSON.stringify({ data: { route: { route: "continuity", confidence: 1, reasons: ["test"] } } }));
} else if (args[0] === "continuity") {
  console.log(JSON.stringify({ data: { latestProgress: { id: "latest1", preview: "PR #51 merged and v0.2.28 released." }, operatingGuidance: [
    { id: "latest1", preview: "PR #51 merged and v0.2.28 released." },
    { id: "guide1", preview: "Operating guidance 1." },
    { id: "guide2", preview: "Operating guidance 2." },
    { id: "guide3", preview: "Operating guidance 3." },
    { id: "guide4", preview: "Operating guidance 4." },
    { id: "guide5", preview: "Operating guidance 5." },
  ], latestApproved: { project: { id: "latest1", preview: "PR #51 merged and v0.2.28 released." }, global: { id: "guide5", preview: "Operating guidance 5." } }, warnings: [{ code: "operating-agreement-overlap", message: "Multiple operating agreement candidates overlap; inspect agreements before applying workflow guidance.", suggestedActions: ["memory-lane agreements --area project-loop --json", "memory-lane agreements --area global-loop --json", "memory-lane agreements --area scope-loop --json", "memory-lane agreements --area capped-loop --json"] }], workstreamDiscovery: { candidates: [{ id: "latest1", preview: "PR #51 merged and v0.2.28 released." }], suggestedActions: ["memory-lane continuity --json"] }, suggestedActions: ["memory-lane continuity --json", "memory-lane agreements --area project-loop --json", "memory-lane agreements --area global-loop --json", "memory-lane agreements --area scope-loop --json", "memory-lane agreements --area capped-loop --json"], answerGuidance: ["Verify against repository state."] } }));
} else if (args[0] === "recall") {
  console.log(JSON.stringify({ data: { memories: [{ id: "wrong", text: "Plain recall should not be used for broad continuity." }] } }));
} else {
  console.log(JSON.stringify({ data: {} }));
}`)

    const piExt = installPiCliBridge(nativeBinary)
    runPiBridgeSmoke(piExt, `
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
        "what's the next item we should work on and what's its scope?",
      ];
      for (const prompt of prompts) {
        const result = await handlers.before_agent_start({ prompt }, { cwd: process.cwd() });
        if (!result?.message || result.message.customType !== "memory-lane") throw new Error("expected memory-lane message");
        if (!result.message.content.includes("Memory Lane continuity context")) throw new Error("expected continuity context");
        if (!result.message.content.includes("Latest project progress")) throw new Error("expected latest progress context");
        if (!result.message.content.includes("latest1")) throw new Error("expected continuity candidate");
        if (!result.message.content.includes("guide5")) throw new Error("expected generated bridge to render five operating guidance items");
        if ((result.message.content.match(/latest1/g) ?? []).length !== 2) throw new Error("expected latest1 only in latest progress and workstream candidate");
        if (result.message.content.includes("Latest approved project continuity")) throw new Error("expected generated bridge to dedupe latest project continuity");
        if (result.message.content.includes("Relevant global workflow context: [guide5]")) throw new Error("expected generated bridge to dedupe global workflow context");
        if (!result.message.content.includes("Action required before applying continuity guidance:")) throw new Error("expected promoted warning block");
        if (result.message.content.indexOf("Action required before applying continuity guidance:") > result.message.content.indexOf("Operating guidance:")) throw new Error("expected warnings before operating guidance");
        if (!result.message.content.includes("Inspect: memory-lane agreements --area project-loop --json")) throw new Error("expected actionable warning inspection command");
        if ((result.message.content.match(/memory-lane agreements --area project-loop --json/g) ?? []).length !== 1) throw new Error("expected warning inspection command once");
        if (!result.message.content.includes("- memory-lane agreements --area capped-loop --json")) throw new Error("expected capped warning action to fall through to authoritative inspection");
      }
      const toolResult = await tools.memory_continuity.execute("tool-1", { query: "what were we last working on?" }, undefined, undefined, { cwd: process.cwd() });
      if (!toolResult.content[0].text.includes("Memory Lane continuity context")) throw new Error("expected continuity tool context");
      if (!toolResult.content[0].text.includes("Latest project progress")) throw new Error("expected latest progress tool context");
      if (!toolResult.content[0].text.includes("latest1")) throw new Error("expected continuity tool candidate");
      if (!toolResult.content[0].text.includes("guide5")) throw new Error("expected continuity tool to render five operating guidance items");
      if (toolResult.content[0].text.includes("Relevant global workflow context: [guide5]")) throw new Error("expected continuity tool to dedupe global workflow context");
      if ((toolResult.content[0].text.match(/memory-lane agreements --area project-loop --json/g) ?? []).length !== 1) throw new Error("expected continuity tool warning inspection command once");
      if (!toolResult.content[0].text.includes("- memory-lane agreements --area capped-loop --json")) throw new Error("expected continuity tool capped warning action to fall through");
    `)

    const calls = readJsonlCalls(logPath)
    for (const prompt of [
      "What were we last working on?",
      "Where are we in the project?",
      "What's the latest progress?",
      "Where did we leave off?",
      "Where was lifecycle continuity implemented?",
      "Let's resume building prompt continuity intents",
      "what's the next item we should work on and what's its scope?",
    ]) {
      assert.ok(calls.some((args) => args[0] === "route" && args.includes("--prompt") && args.includes(prompt)), `expected route call for ${prompt}`)
      assert.ok(calls.some((args) => args[0] === "continuity" && args.includes("--query") && args.includes(prompt)), `expected continuity call for ${prompt}`)
    }
    assert.equal(calls.some((args) => args[0] === "recall"), false)
  })

  it("routes pi memory-management prompts to command guidance without recall", () => {
    const { nativeBinary, logPath } = writeNativeMemoryLaneStub("memory-management-calls.jsonl", `if (args[0] === "status") {
  console.log(JSON.stringify({ data: { contextPolicyMode: "selective", contextPolicyPromptMaxItems: 2 } }));
} else if (args[0] === "route") {
  console.log(JSON.stringify({ data: { route: { route: "memory-management", confidence: 1, reasons: ["memory-management"] } } }));
} else if (args[0] === "recall") {
  console.log(JSON.stringify({ data: { memories: [{ id: "wrong", text: "Memory bodies should not be injected." }] } }));
} else {
  console.log(JSON.stringify({ data: {} }));
}`)

    const piExt = installPiCliBridge(nativeBinary)
    runPiBridgeSmoke(piExt, `
      const mod = await import("file://" + process.env.PI_EXTENSION_FILE);
      const fn = typeof mod.default === "function" ? mod.default : mod.default?.default;
      const handlers = {};
      const pi = { registerCommand() {}, registerTool() {}, on(name, handler) { handlers[name] = handler } };
      fn(pi);
      const result = await handlers.before_agent_start({ prompt: "show current memories" }, { cwd: process.cwd() });
      if (!result?.message || result.message.customType !== "memory-lane") throw new Error("expected memory-lane message");
      if (!result.message.content.includes("Memory Lane command guidance")) throw new Error("expected command guidance");
      if (!result.message.content.includes("memory-lane list --json")) throw new Error("expected list command guidance");
      if (result.message.content.includes("Memory bodies should not be injected")) throw new Error("memory-management route leaked recall body");
    `)

    const calls = readJsonlCalls(logPath)
    assert.ok(calls.some((args) => args[0] === "route" && args.includes("--prompt") && args.includes("show current memories")))
    assert.equal(calls.some((args) => args[0] === "recall"), false)
  })

  it("emits pi CLI bridge policy-only guidance without memory body lookup", () => {
    const { nativeBinary, logPath } = writeNativeMemoryLaneStub("policy-only-calls.jsonl", `if (args[0] === "status") {
  console.log(JSON.stringify({ data: { contextPolicyMode: "policy-only", contextPolicyPromptMaxItems: 2 } }));
} else if (args[0] === "route") {
  console.log(JSON.stringify({ data: { route: { route: "continuity", confidence: 1, reasons: ["test"] } } }));
} else if (args[0] === "continuity" || args[0] === "recall") {
  console.log(JSON.stringify({ data: { shouldNotBeRead: true } }));
} else {
  console.log(JSON.stringify({ data: {} }));
}`)

    const piExt = installPiCliBridge(nativeBinary)
    runPiBridgeSmoke(piExt, `
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
    `)

    const calls = readJsonlCalls(logPath)
    assert.equal(calls.some((args) => args[0] === "continuity"), false)
    assert.equal(calls.some((args) => args[0] === "recall"), false)
  })

  it("generated pi CLI bridge uses generic policy-only guidance when route command fails", () => {
    const { nativeBinary, logPath } = writeNativeMemoryLaneStub("policy-only-route-fallback-calls.jsonl", `if (args[0] === "status") {
  console.log(JSON.stringify({ data: { contextPolicyMode: "policy-only", contextPolicyPromptMaxItems: 2 } }));
} else if (args[0] === "route") {
  process.exit(42);
} else if (args[0] === "continuity" || args[0] === "recall") {
  console.log(JSON.stringify({ data: { shouldNotBeRead: true } }));
} else {
  console.log(JSON.stringify({ data: {} }));
}`)

    const piExt = installPiCliBridge(nativeBinary)
    runPiBridgeSmoke(piExt, `
      const mod = await import("file://" + process.env.PI_EXTENSION_FILE);
      const fn = typeof mod.default === "function" ? mod.default : mod.default?.default;
      const handlers = {};
      const pi = { registerCommand() {}, registerTool() {}, on(name, handler) { handlers[name] = handler } };
      fn(pi);
      const result = await handlers.before_agent_start({ prompt: "What were we last working on?" }, { cwd: process.cwd() });
      if (!result?.message?.content.includes("Memory Lane command guidance")) throw new Error("expected generic policy-only guidance");
      if (result.message.content.includes("Memory Lane continuity guidance")) throw new Error("route failure should not use continuity guidance in policy-only mode");
      if (result.message.content.includes("shouldNotBeRead")) throw new Error("policy-only route fallback leaked lookup body");
    `)

    const calls = readJsonlCalls(logPath)
    assert.ok(calls.some((args) => args[0] === "route"))
    assert.equal(calls.some((args) => args[0] === "continuity"), false)
    assert.equal(calls.some((args) => args[0] === "recall"), false)
  })

  it("generated pi CLI bridge falls back when route command fails", () => {
    const { nativeBinary, logPath } = writeNativeMemoryLaneStub("route-fallback-calls.jsonl", `if (args[0] === "status") {
  console.log(JSON.stringify({ data: { contextPolicyMode: "selective", contextPolicyPromptMaxItems: 2, contextPolicyPromptMaxChars: 3000 } }));
} else if (args[0] === "route") {
  process.exit(42);
} else if (args[0] === "continuity") {
  console.log(JSON.stringify({ data: { latestProgress: { id: "fallback", preview: "Fallback continuity context." }, suggestedActions: ["memory-lane continuity --json"] } }));
} else if (args[0] === "recall") {
  console.log(JSON.stringify({ data: { memories: [{ id: "recall", text: "Recall fallback body." }] } }));
} else {
  console.log(JSON.stringify({ data: {} }));
}`)

    const piExt = installPiCliBridge(nativeBinary)
    runPiBridgeSmoke(piExt, `
      const mod = await import("file://" + process.env.PI_EXTENSION_FILE);
      const fn = typeof mod.default === "function" ? mod.default : mod.default?.default;
      const handlers = {};
      const pi = { registerCommand() {}, registerTool() {}, on(name, handler) { handlers[name] = handler } };
      fn(pi);
      const continuityResult = await handlers.before_agent_start({ prompt: "What were we last working on?" }, { cwd: process.cwd() });
      if (!continuityResult?.message?.content.includes("Fallback continuity context")) throw new Error("expected continuity heuristic fallback");
      const recallResult = await handlers.before_agent_start({ prompt: "explain the API docs" }, { cwd: process.cwd() });
      if (!recallResult?.message?.content.includes("Recall fallback body")) throw new Error("expected ordinary recall fallback");
    `)

    const calls = readJsonlCalls(logPath)
    assert.ok(calls.some((args) => args[0] === "route"))
    assert.ok(calls.some((args) => args[0] === "continuity"))
    assert.ok(calls.some((args) => args[0] === "recall"))
  })

  it("writes pi CLI bridge before_agent_start messages with Pi's custom message shape", () => {
    const nativeBinary = path.join(home, ".local/bin/memory-lane")
    fs.mkdirSync(path.dirname(nativeBinary), { recursive: true })
    fs.writeFileSync(nativeBinary, `#!/bin/sh
case "$1" in
  status)
    printf '%s\n' '{"data":{"contextPolicyMode":"auto","contextPolicyPromptMaxItems":2,"contextPolicyPromptMaxChars":3000}}'
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

  it("generated pi CLI bridge skips greeting prompt injection without recall", () => {
    const { nativeBinary, logPath } = writeNativeMemoryLaneStub("greeting-calls.jsonl", `if (args[0] === "status") {
  console.log(JSON.stringify({ data: { contextPolicyMode: "selective", contextPolicyPromptMaxItems: 2, contextPolicyPromptMaxChars: 3000 } }));
} else if (args[0] === "recall") {
  console.log(JSON.stringify({ data: { memories: [{ id: "wrong", text: "Greeting should not recall." }] } }));
} else {
  console.log(JSON.stringify({ data: {} }));
}`)

    const piExt = installPiCliBridge(nativeBinary)
    runPiBridgeSmoke(piExt, `
      const mod = await import("file://" + process.env.PI_EXTENSION_FILE);
      const fn = typeof mod.default === "function" ? mod.default : mod.default?.default;
      const handlers = {};
      const pi = { registerCommand() {}, registerTool() {}, on(name, handler) { handlers[name] = handler } };
      fn(pi);
      const result = await handlers.before_agent_start({ prompt: "Hi!" }, { cwd: process.cwd() });
      if (result !== undefined) throw new Error("expected no greeting context");
    `)

    const calls = readJsonlCalls(logPath)
    assert.equal(calls.some((args) => args[0] === "recall"), false)
  })

  it("generated pi CLI bridge caps automatic recall context and keeps explicit recall full fidelity", () => {
    const longText = "Relevant pnpm memory. " + "extra details. ".repeat(600)
    const { nativeBinary } = writeNativeMemoryLaneStub("recall-cap-calls.jsonl", `if (args[0] === "status") {
  console.log(JSON.stringify({ data: { contextPolicyMode: "selective", contextPolicyPromptMaxItems: 2 } }));
} else if (args[0] === "recall") {
  console.log(JSON.stringify({ data: { memories: [{ id: "long1234", text: ${JSON.stringify(longText)} }] } }));
} else {
  console.log(JSON.stringify({ data: {} }));
}`)

    const piExt = installPiCliBridge(nativeBinary)
    runPiBridgeSmoke(piExt, `
      const mod = await import("file://" + process.env.PI_EXTENSION_FILE);
      const fn = typeof mod.default === "function" ? mod.default : mod.default?.default;
      const handlers = {};
      const tools = {};
      const pi = { registerCommand() {}, registerTool(tool) { tools[tool.name] = tool }, on(name, handler) { handlers[name] = handler } };
      fn(pi);
      const autoResult = await handlers.before_agent_start({ prompt: "pnpm package manager" }, { cwd: process.cwd() });
      if (!autoResult?.message?.content?.includes("long1234")) throw new Error("expected capped automatic context");
      if (autoResult.message.content.length > 3300) throw new Error("automatic context exceeded fallback prompt budget: " + autoResult.message.content.length);
      const explicit = await tools.memory_recall.execute("tool-1", { query: "pnpm" }, undefined, undefined, { cwd: process.cwd() });
      if (explicit.content[0].text.length <= autoResult.message.content.length) throw new Error("explicit recall should remain fuller than automatic context");
    `)
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

  it("merges Memory Lane hooks without removing unrelated hooks", () => {
    const configPath = path.join(home, ".claude/settings.json")
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        theme: "dark",
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "echo keep-me" }] },
            { hooks: [{ type: "command", command: `/old/path/bin/memory-lane claude stop` }] },
          ],
        },
      }),
      "utf8",
    )

    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    assert.equal(config.theme, "dark")
    assert.ok(config.hooks.UserPromptSubmit)
    assert.equal(config.hooks.Stop.length, 2)
    assert.equal(config.hooks.Stop[0].hooks[0].command, "echo keep-me")
    assert.equal(config.hooks.Stop[1].hooks[0].command, `${binaryPath} claude stop`)
    assert.equal(config.hooks.PreCompact[0].matcher, "manual|auto")
    assert.equal(config.hooks.PreCompact[0].hooks[0].command, `${binaryPath} claude pre-compact`)
    assert.ok(fs.existsSync(`${configPath}.memory-lane.bak`))
  })

  it("leaves malformed JSON hook config untouched", () => {
    const configPath = path.join(home, ".claude/settings.json")
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, "{bad json", "utf8")

    const output = run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    assert.equal(fs.readFileSync(configPath, "utf8"), "{bad json")
    assert.equal(fs.existsSync(`${configPath}.memory-lane.bak`), false)
    assert.match(output, /Claude Code CLI failed: Could not parse JSON config/u)
  })

  it("leaves non-object JSON hook config untouched", () => {
    const configPath = path.join(home, ".claude/settings.json")
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, "null", "utf8")

    const output = run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    assert.equal(fs.readFileSync(configPath, "utf8"), "null")
    assert.equal(fs.existsSync(`${configPath}.memory-lane.bak`), false)
    assert.match(output, /Claude Code CLI failed: Could not parse JSON config/u)
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
