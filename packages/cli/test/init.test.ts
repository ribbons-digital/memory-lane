import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { tempDir } from "../../core/test/helpers.js"
import { isRunnableLauncher } from "../src/commands/init.js"
import { VERSION } from "../src/version.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createFakeBinDir(): string {
  const dir = tempDir()
  for (const cmd of ["claude", "codex"]) {
    const file = path.join(dir, cmd)
    fs.writeFileSync(file, "#!/bin/sh\necho fake\n", "utf8")
    fs.chmodSync(file, 0o755)
  }
  fs.symlinkSync(process.execPath, path.join(dir, process.platform === "win32" ? "node.exe" : "node"))
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
      env: { ...process.env, PATH: fakeBinDir, ...env },
      cwd,
      input: stdin,
    }).trim()
  }

  function runWithStatus(args: string[], env?: NodeJS.ProcessEnv, cwd?: string, stdin?: string) {
    const cli = path.resolve(__dirname, "../dist/index.js")
    const result = spawnSync("node", [cli, ...args], {
      encoding: "utf8",
      env: { ...process.env, PATH: fakeBinDir, ...env },
      cwd,
      input: stdin,
    })
    if (result.error) throw result.error
    return {
      status: result.status,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    }
  }

  function runInteractive(args: string[], env: NodeJS.ProcessEnv, steps: Array<{ prompt: string; input: string }>, cwd?: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
    const cli = path.resolve(__dirname, "../dist/index.js")
    const child = spawn("node", [cli, ...args], {
      env: { ...process.env, PATH: fakeBinDir, ...env },
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    })
    let resolve!: (value: { status: number | null; stdout: string; stderr: string }) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<{ status: number | null; stdout: string; stderr: string }>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    let stdout = ""
    let stderr = ""
    let nextStep = 0
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
      while (nextStep < steps.length && stdout.includes(steps[nextStep].prompt)) {
        child.stdin.write(steps[nextStep].input)
        nextStep += 1
        if (nextStep === steps.length) child.stdin.end()
      }
    })
    child.stderr.on("data", (chunk: string) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (status) => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }))
    return promise
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
    fs.chmodSync(binaryPath, 0o755)
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
    fs.chmodSync(nativeBinary, 0o755)

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

  it("generated pi CLI bridge forwards input turn_end and tool_result with OMP normalization", () => {
    const { nativeBinary, logPath } = writeNativeMemoryLaneStub("lifecycle-calls.jsonl", "console.log(JSON.stringify({ data: { saved: 1 } }));")
    const piExt = installPiCliBridge(nativeBinary)
    runPiBridgeSmoke(piExt, `
      const mod = await import("file://" + process.env.PI_EXTENSION_FILE);
      const fn = typeof mod.default === "function" ? mod.default : mod.default?.default;
      const handlers = {};
      const pi = { registerCommand() {}, registerTool() {}, on(name, handler) { handlers[name] = handler } };
      fn(pi);
      const ctx = {
        cwd: "/tmp/pi-generated-bridge-project",
        sessionManager: {
          getSessionFile() { return "/tmp/pi-session.json" },
          getBranch() {
            return [
              { type: "message", message: { role: "user", content: "Latest OMP user message" } },
              { type: "message", message: { role: "assistant", content: "Previous assistant message" } },
            ];
          },
        },
      };
      const inputResult = await handlers.input({ source: "interactive", text: "Remember the generated bridge input" }, ctx);
      if (JSON.stringify(inputResult) !== JSON.stringify({ action: "continue" })) throw new Error("invalid input pass-through");
      const turnResult = await handlers.turn_end({
        turnIndex: 7,
        message: { role: "assistant", content: [{ type: "text", text: "Current assistant message" }] },
        toolResults: [],
      }, ctx);
      if (turnResult !== undefined) throw new Error("turn_end must not override OMP");
      const toolResult = await handlers.tool_result({
        toolName: "shell:memory-lane-contract",
        toolCallId: "call-live",
        input: { command: "pnpm test" },
        content: [{ type: "text", text: "OMP_CONTRACT_TOOL_TEST_PASSED" }],
        details: { exitCode: 0 },
        isError: false,
      }, ctx);
      if (toolResult !== undefined) throw new Error("tool_result must not override OMP");
    `)

    const entries = readJsonlEntries(logPath)
    assert.deepEqual(entries.map((entry) => entry.args.slice(0, 3)), [
      ["pi", "input", "--json"],
      ["pi", "turn-end", "--json"],
      ["pi", "post-tool-use", "--json"],
    ])
    const input = JSON.parse(entries[0].stdin)
    assert.equal(input.source, "interactive")
    assert.equal(input.text, "Remember the generated bridge input")
    const turnEnd = JSON.parse(entries[1].stdin)
    assert.equal(turnEnd.turn_id, "7")
    assert.equal(turnEnd.last_user_message, "Latest OMP user message")
    assert.equal(turnEnd.last_assistant_message, "Current assistant message")
    const toolResult = JSON.parse(entries[2].stdin)
    assert.equal(toolResult.tool_name, "shell:memory-lane-contract")
    assert.deepEqual(toolResult.tool_input, { command: "pnpm test" })
    assert.equal(toolResult.tool_response.text, "OMP_CONTRACT_TOOL_TEST_PASSED")
    assert.equal(toolResult.tool_response.exitCode, 0)
  })

  it("generated pi CLI bridge suppresses lifecycle handlers only for proven OMP task sessions", () => {
    const { nativeBinary, logPath } = writeNativeMemoryLaneStub("task-policy-calls.jsonl", "console.log(JSON.stringify({ data: { saved: 0 } }));")
    const piExt = installPiCliBridge(nativeBinary)
    runPiBridgeSmoke(piExt, `
      const mod = await import("file://" + process.env.PI_EXTENSION_FILE);
      const fn = typeof mod.default === "function" ? mod.default : mod.default?.default;
      const handlers = {};
      const pi = { registerCommand() {}, registerTool() {}, on(name, handler) { handlers[name] = handler } };
      fn(pi);
      const artifactsDir = "/tmp/pi-task-artifacts";
      const taskCtx = {
        cwd: "/tmp/pi-generated-bridge-project",
        getSystemPrompt() { return ["You are a worker agent for delegated tasks."] },
        sessionManager: {
          getSessionFile() { return artifactsDir + "/child.jsonl" },
          getArtifactsDir() { return artifactsDir },
          getBranch() { return [] },
        },
      };
      const results = [
        await handlers.before_agent_start({ prompt: "Recall task context" }, taskCtx),
        await handlers.input({ source: "interactive", text: "Remember task context" }, taskCtx),
        await handlers.turn_end({ turnIndex: 1, message: { role: "assistant", content: "done" }, toolResults: [] }, taskCtx),
        await handlers.tool_result({ toolName: "bash", input: { command: "pnpm test" }, content: [], isError: false }, taskCtx),
        await handlers.session_before_compact({ preparation: { messagesToSummarize: [] } }, taskCtx),
      ];
      if (results[0] !== undefined || JSON.stringify(results[1]) !== JSON.stringify({ action: "continue" }) || results.slice(2).some((result) => result !== undefined)) {
        throw new Error("task lifecycle suppression returned invalid host results");
      }

      const nestedOnly = { ...taskCtx, getSystemPrompt() { return ["Main agent"] } };
      const roleOnly = { ...taskCtx, sessionManager: { getSessionFile() { return "/tmp/main.jsonl" }, getArtifactsDir() { return artifactsDir } } };
      const parentBranch = { ...roleOnly, getSystemPrompt() { return ["Main agent"] }, sessionManager: { ...roleOnly.sessionManager, getHeader() { return { parentSession: "main" } } } };
      const missingSession = { ...taskCtx, sessionManager: { getArtifactsDir() { return artifactsDir } } };
      const malformedPrompt = { ...taskCtx, getSystemPrompt() { return "malformed" } };
      const throwingContext = {
        ...taskCtx,
        getSystemPrompt() { throw new Error("unavailable") },
        sessionManager: { getSessionFile() { throw new Error("unavailable") }, getArtifactsDir() { return artifactsDir } },
      };
      for (const ctx of [{ cwd: taskCtx.cwd }, nestedOnly, roleOnly, parentBranch, missingSession, malformedPrompt, throwingContext]) {
        const result = await handlers.input({ source: "interactive", text: "Remember main context" }, ctx);
        if (JSON.stringify(result) !== JSON.stringify({ action: "continue" })) throw new Error("invalid fail-open input result");
      }
    `)

    const entries = readJsonlEntries(logPath)
    assert.equal(entries.length, 7)
    assert.ok(entries.every((entry) => entry.args[0] === "pi" && entry.args[1] === "input"))
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
      if (duration > 500) throw new Error("expected precompact bridge to return before slow pre-compact work completes, took " + duration + "ms");
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

  it("generates pi CLI bridge automatic memory context containment", () => {
    const { nativeBinary } = writeNativeMemoryLaneStub("containment-source-calls.jsonl", `console.log(JSON.stringify({ data: {} }));`)
    const piExt = installPiCliBridge(nativeBinary)
    const content = fs.readFileSync(piExt, "utf8")

    assert.ok(content.includes("function escapeMemoryContextText"))
    assert.ok(content.includes("function renderQuotedMemoryBody"))
    assert.ok(content.includes("function renderAutomaticMemoryContext"))
    assert.ok(content.includes('<memory-context mode="selective" event="prompt">'))
    assert.equal(content.includes('content: "Relevant Memory Lane memories:\\n" + memories.map(memoryText).join("\\n")'), false)
  })

  it("generated pi CLI bridge contains automatic memory bodies", () => {
    const id = "bad\n# Id heading\n- Id bullet</memory-context>"
    const body = "</memory-context>\n# Heading\n- bullet\n\n```text\ncode\n```"
    const { nativeBinary } = writeNativeMemoryLaneStub("containment-behavior-calls.jsonl", `if (args[0] === "status") {
  console.log(JSON.stringify({ data: { contextPolicyMode: "selective", contextPolicyPromptMaxItems: 2, contextPolicyPromptMaxChars: 5000 } }));
} else if (args[0] === "recall") {
  console.log(JSON.stringify({ data: { memories: [{ id: ${JSON.stringify(id)}, text: ${JSON.stringify(body)} }] } }));
} else if (args[0] === "show") {
  console.log(JSON.stringify({ data: { memory: { id: ${JSON.stringify(id)}, text: ${JSON.stringify(body)} } } }));
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
      const result = await handlers.before_agent_start({ prompt: "memory containment topic" }, { cwd: process.cwd() });
      const content = result?.message?.content ?? "";
      if (!content.includes('<memory-context mode="selective" event="prompt">')) throw new Error("missing memory context wrapper");
      if ((content.match(/<\\/memory-context>/g) ?? []).length !== 1) throw new Error("expected one trusted closing wrapper");
      if (!content.includes("[bad # Id heading - Id bullet&lt;/memory-context&gt;]")) throw new Error("expected escaped one-line id");
      if (!content.includes("  > &lt;/memory-context&gt;")) throw new Error("expected escaped closing tag");
      if (!content.includes("  > # Heading")) throw new Error("expected contained heading");
      if (!content.includes("  > - bullet")) throw new Error("expected contained bullet");
      if (!content.includes("\\n  >\\n")) throw new Error("expected contained blank line");
      if (!content.includes("  > \`\`\`text")) throw new Error("expected contained fence");
      if (/^# Id heading/m.test(content)) throw new Error("raw id heading escaped containment");
      if (/^- Id bullet/m.test(content)) throw new Error("raw id bullet escaped containment");
      if (/^# Heading/m.test(content)) throw new Error("raw heading escaped containment");
      if (/^- bullet/m.test(content)) throw new Error("raw bullet escaped containment");
      if (/^\`\`\`text/m.test(content)) throw new Error("raw fence escaped containment");
      const explicit = await tools.memory_recall.execute("tool-1", { query: "memory containment topic" }, undefined, undefined, { cwd: process.cwd() });
      if (!explicit.content[0].text.includes("</memory-context>\\n# Heading")) throw new Error("explicit recall should keep raw body semantics");
      if (!explicit.content[0].text.includes(${JSON.stringify(`[${id}] `)})) throw new Error("explicit recall should keep raw id semantics");
      const explicitGet = await tools.memory_get.execute("tool-2", { id: ${JSON.stringify(id)} }, undefined, undefined, { cwd: process.cwd() });
      if (!explicitGet.content[0].text.includes(${JSON.stringify(`[${id}] `)})) throw new Error("explicit get should keep raw id semantics");
      if (explicitGet.details.id !== ${JSON.stringify(id)}) throw new Error("explicit get details should keep raw id semantics");
    `)
  })

  it("generated pi CLI bridge budgets automatic recall after rendering", () => {
    const expandingText = "Pathological chars. " + "<>&\n".repeat(1000)
    const { nativeBinary } = writeNativeMemoryLaneStub("rendered-budget-calls.jsonl", `if (args[0] === "status") {
  console.log(JSON.stringify({ data: { contextPolicyMode: "selective", contextPolicyPromptMaxItems: 2, contextPolicyPromptMaxChars: 320 } }));
} else if (args[0] === "recall") {
  console.log(JSON.stringify({ data: { memories: [{ id: "expand", text: ${JSON.stringify(expandingText)} }] } }));
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
      const result = await handlers.before_agent_start({ prompt: "pathological rendered budget" }, { cwd: process.cwd() });
      const content = result?.message?.content ?? "";
      if (!content.includes("expand")) throw new Error("expected fitted memory");
      if (content.length > 700) throw new Error("automatic context exceeded rendered budget envelope: " + content.length);
    `)
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
    const { nativeBinary, logPath } = writeNativeMemoryLaneStub("recall-cap-calls.jsonl", `if (args[0] === "status") {
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

    const calls = readJsonlCalls(logPath)
    const automaticRecall = calls.find((args) => args[0] === "recall" && args[1] === "pnpm package manager")
    assert.deepEqual(
      automaticRecall?.slice(0, 5),
      ["recall", "pnpm package manager", "--json", "--top-k", "2"],
    )
  })

  it("writes install manifest", () => {
    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    const manifest = JSON.parse(fs.readFileSync(path.join(home, ".memory-lane/install.json"), "utf8"))
    assert.equal(manifest.binaryPath, binaryPath)
    assert.equal(manifest.version, VERSION)
    assert.ok(Array.isArray(manifest.integrations))
    assert.ok(manifest.integrations.some((integration: { harness?: unknown }) => integration.harness === "pi"))
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

  it("repairs Node-based desktop MCP commands to the managed release binary", () => {
    const managedBinary = process.platform === "win32"
      ? path.join(home, "bin", "memory-lane.exe")
      : path.join(home, ".local", "bin", "memory-lane")
    fs.mkdirSync(path.dirname(managedBinary), { recursive: true })
    fs.writeFileSync(managedBinary, "")
    fs.chmodSync(managedBinary, 0o755)

    const invalidOverride = path.join(home, "invalid-memory-lane-binary")
    fs.mkdirSync(invalidOverride)

    const claudeConfigPath = process.platform === "darwin"
      ? path.join(home, "Library/Application Support/Claude/claude_desktop_config.json")
      : path.join(home, ".config/Claude/claude_desktop_config.json")
    const codexConfigPath = path.join(home, ".codex/config.toml")
    fs.writeFileSync(claudeConfigPath, JSON.stringify({
      mcpServers: {
        "memory-lane": { command: process.execPath, args: ["mcp"] },
      },
    }))
    fs.writeFileSync(codexConfigPath, `[mcp_servers.memory-lane]\nenabled = true\ncommand = "${process.execPath}"\nargs = ["mcp"]\n`)

    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: invalidOverride,
    })

    const claudeConfig = JSON.parse(fs.readFileSync(claudeConfigPath, "utf8"))
    assert.equal(claudeConfig.mcpServers["memory-lane"].command, managedBinary)
    assert.deepEqual(claudeConfig.mcpServers["memory-lane"].args, ["mcp"])
    const codexConfig = fs.readFileSync(codexConfigPath, "utf8")
    assert.ok(codexConfig.includes(`command = "${managedBinary}"`))
    assert.match(codexConfig, /args = \["mcp"\]/u)
    const manifest = JSON.parse(fs.readFileSync(path.join(home, ".memory-lane/install.json"), "utf8"))
    assert.equal(manifest.binaryPath, managedBinary)
  })

  it("rejects non-binary Windows launcher fallbacks", () => {
    const scriptLauncher = path.join(home, "memory-lane.js")
    const binaryLauncher = path.join(home, "memory-lane.exe")
    for (const launcher of [scriptLauncher, binaryLauncher]) {
      fs.writeFileSync(launcher, "")
      fs.chmodSync(launcher, 0o755)
    }

    assert.equal(isRunnableLauncher(scriptLauncher, "win32"), false)
    assert.equal(isRunnableLauncher(binaryLauncher, "win32"), true)
    assert.equal(isRunnableLauncher(scriptLauncher, "darwin"), true)
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

  it("lists OMP with its first-class display name", () => {
    const output = run(["init", "--list"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })
    assert.match(output, /OMP \(Oh My Pi\)\s+not detected/u)
  })

  it("installs detected OMP through --yes", () => {
    const agentDir = path.join(home, ".omp", "agent")
    fs.mkdirSync(agentDir, { recursive: true })
    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })
    const ompExtension = path.join(agentDir, "extensions", "memory-lane", "index.ts")
    assert.equal(fs.existsSync(ompExtension), true)
    const manifest = JSON.parse(fs.readFileSync(path.join(home, ".memory-lane", "install.json"), "utf8")) as {
      integrations: Array<{ harness: string; configPath: string }>
    }
    assert.deepEqual(manifest.integrations.find((entry) => entry.harness === "omp"), {
      harness: "omp",
      configPath: ompExtension,
    })
  })

  it("installs explicitly selected OMP under PI_CODING_AGENT_DIR", () => {
    const agentDir = path.join(tempDir(), "custom-agent")
    run(["init", "--only", "omp"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
      PI_CODING_AGENT_DIR: agentDir,
    })
    assert.equal(fs.existsSync(path.join(agentDir, "extensions", "memory-lane", "index.ts")), true)
    assert.equal(fs.existsSync(path.join(home, ".omp", "agent")), false)
  })

  it("installs Pi and OMP side by side without losing Pi manifest ownership", () => {
    run(["init", "--only", "pi"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })
    const piExtension = path.join(home, ".pi", "agent", "extensions", "memory-lane", "index.ts")
    const piBefore = fs.readFileSync(piExtension, "utf8")
    const agentDir = path.join(tempDir(), "override-agent")
    run(["init", "--only", "omp"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
      PI_CODING_AGENT_DIR: agentDir,
    })
    const manifest = JSON.parse(fs.readFileSync(path.join(home, ".memory-lane", "install.json"), "utf8")) as {
      integrations: Array<{ harness: string; configPath: string }>
    }
    assert.deepEqual(manifest.integrations.map((entry) => entry.harness).sort(), ["omp", "pi"])
    assert.equal(fs.readFileSync(piExtension, "utf8"), piBefore)
    assert.equal(fs.existsSync(path.join(agentDir, "extensions", "memory-lane", "index.ts")), true)
  })

  it("interactive numbered selection can choose OMP", () => {
    const agentDir = path.join(tempDir(), "interactive-agent")
    const output = run(["init"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
      PI_CODING_AGENT_DIR: agentDir,
    }, undefined, "6\n")
    assert.match(output, /OMP \(Oh My Pi\) configured/u)
    assert.equal(fs.existsSync(path.join(agentDir, "extensions", "memory-lane", "index.ts")), true)
  })

  it("interactive OMP selection asks before overwriting an existing extension", async () => {
    const agentDir = path.join(tempDir(), "existing-agent")
    const extension = path.join(agentDir, "extensions", "memory-lane", "index.ts")
    fs.mkdirSync(path.dirname(extension), { recursive: true })
    fs.writeFileSync(extension, "existing OMP extension", "utf8")
    const result = await runInteractive(["init"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
      PI_CODING_AGENT_DIR: agentDir,
    }, [
      { prompt: "Select integrations", input: "6\n" },
      { prompt: "Enable local learning?", input: "n\n" },
      { prompt: "already has a Memory Lane configuration", input: "n\n" },
    ])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /OMP \(Oh My Pi\) skipped/u)
    assert.equal(fs.readFileSync(extension, "utf8"), "existing OMP extension")
  })

  it("refuses to overwrite a malformed install manifest before OMP installation", () => {
    const dataDir = path.join(home, ".memory-lane")
    const agentDir = path.join(tempDir(), "malformed-manifest-agent")
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, "install.json"), "{", "utf8")
    const result = runWithStatus(["init", "--only", "omp", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
      PI_CODING_AGENT_DIR: agentDir,
    })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /Invalid JSON in install manifest/u)
    assert.equal(fs.existsSync(path.join(agentDir, "extensions", "memory-lane", "index.ts")), false)
    assert.equal(fs.readFileSync(path.join(dataDir, "install.json"), "utf8"), "{")
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

    const result = runWithStatus(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    assert.equal(fs.readFileSync(configPath, "utf8"), "{bad json")
    assert.equal(fs.existsSync(`${configPath}.memory-lane.bak`), false)
    assert.equal(result.status, 1)
    assert.match(result.stdout, /Claude Code CLI failed: Could not parse JSON config/u)
    assert.match(result.stdout, /Memory Lane init completed with errors/u)
    assert.doesNotMatch(result.stdout, /Done\. Memory Lane is ready\./u)
  })

  it("exits non-zero when a selected integration fails", () => {
    const configPath = path.join(home, ".claude/settings.json")
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, "{bad json", "utf8")

    const result = runWithStatus(["init", "--only", "claude-code-cli"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    assert.equal(result.status, 1)
    assert.match(result.stdout, /Claude Code CLI failed: Could not parse JSON config/u)
    assert.match(result.stdout, /Memory Lane init completed with errors/u)
    assert.doesNotMatch(result.stdout, /Done\. Memory Lane is ready\./u)
  })

  it("leaves non-object JSON hook config untouched", () => {
    const configPath = path.join(home, ".claude/settings.json")
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, "null", "utf8")

    const result = runWithStatus(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    assert.equal(fs.readFileSync(configPath, "utf8"), "null")
    assert.equal(fs.existsSync(`${configPath}.memory-lane.bak`), false)
    assert.equal(result.status, 1)
    assert.match(result.stdout, /Claude Code CLI failed: Could not parse JSON config/u)
    assert.match(result.stdout, /Memory Lane init completed with errors/u)
    assert.doesNotMatch(result.stdout, /Done\. Memory Lane is ready\./u)
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

  it("overwrites existing Codex Desktop TOML section with whitespace and comment", () => {
    const configPath = path.join(home, ".codex/config.toml")
    fs.writeFileSync(configPath, '[ mcp_servers.memory-lane ] # old entry\ncommand = "old-memory-lane"\n\n[other]\nvalue = true\n', "utf8")

    const result = runWithStatus(["init", "--only", "codex-desktop"], {
      HOME: home,
      NO_COLOR: "1",
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    }, undefined, "Y\n")

    const content = fs.readFileSync(configPath, "utf8")
    assert.equal(result.status, 0)
    assert.match(result.stdout, /Codex Desktop already has a Memory Lane configuration/u)
    assert.doesNotMatch(content, /old-memory-lane/u)
    assert.equal(content.match(/mcp_servers\.memory-lane/gu)?.length, 1)
    assert.ok(content.includes("[other]"))
    assert.ok(content.includes(`command = "${binaryPath}"`))
  })

  it("keeps user-declined Codex Desktop overwrite non-fatal", () => {
    const configPath = path.join(home, ".codex/config.toml")
    fs.writeFileSync(configPath, '[mcp_servers.memory-lane]\ncommand = "old-memory-lane"\n', "utf8")

    const result = runWithStatus(["init", "--only", "codex-desktop"], {
      HOME: home,
      NO_COLOR: "1",
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    }, undefined, "n\n")

    const content = fs.readFileSync(configPath, "utf8")
    assert.equal(result.status, 0)
    assert.match(result.stdout, /Codex Desktop skipped/u)
    assert.match(result.stdout, /Done\. Memory Lane is ready\./u)
    assert.doesNotMatch(result.stdout, /Memory Lane init completed with errors/u)
    assert.match(content, /old-memory-lane/u)
  })

  it("interactive Codex Desktop setup accepts normal TOML config", () => {
    fs.writeFileSync(path.join(home, ".codex/config.toml"), "[mcp_servers]\n", "utf8")

    const result = runWithStatus(["init"], {
      HOME: home,
      NO_COLOR: "1",
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    }, undefined, "4\n")

    const content = fs.readFileSync(path.join(home, ".codex/config.toml"), "utf8")
    assert.equal(result.status, 0)
    assert.match(result.stdout, /Codex Desktop\s+configured/u)
    assert.doesNotMatch(result.stdout, /Could not parse JSON config/u)
    assert.match(result.stdout, /Done\. Memory Lane is ready\./u)
    assert.ok(content.includes("[mcp_servers]"))
    assert.ok(content.includes("[mcp_servers.memory-lane]"))
    assert.ok(content.includes(`command = "${binaryPath}"`))
  })

  it("interactive init records local learning consent once", async () => {
    const env = {
      HOME: home,
      NO_COLOR: "1",
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    }

    const first = await runInteractive(["init"], env, [
      { prompt: "Select integrations", input: "1\n" },
      { prompt: "Enable local learning? [y/N]", input: "y\n" },
    ])
    assert.equal(first.status, 0, first.stderr)
    assert.equal(first.stdout.match(/Enable local learning\? \[y\/N\]/gu)?.length, 1)
    type LearningConfigFile = { learning?: { capture?: "on" | "off" } }
    const configPath = path.join(home, ".memory-lane", "config.json")
    const enabledConfig = JSON.parse(fs.readFileSync(configPath, "utf8")) as LearningConfigFile
    assert.equal(enabledConfig.learning?.capture, "on")
    const second = await runInteractive(["init"], env, [
      { prompt: "Select integrations", input: "1\n" },
      { prompt: "already has a Memory Lane configuration", input: "n\n" },
    ])
    assert.equal(second.status, 0, second.stderr)
    assert.doesNotMatch(second.stdout, /Enable local learning\?/u)
    const unchangedConfig = JSON.parse(fs.readFileSync(configPath, "utf8")) as LearningConfigFile
    assert.equal(unchangedConfig.learning?.capture, "on")
  })

  it("interactive init leaves local learning unset on consent EOF", () => {
    const result = runWithStatus(["init"], {
      HOME: home,
      NO_COLOR: "1",
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    }, undefined, "1\n")

    assert.equal(result.status, 0)
    assert.match(result.stdout, /Enable local learning\? \[y\/N\]/u)
    type LearningConfigFile = { learning?: { capture?: "on" | "off" } }
    const configPath = path.join(home, ".memory-lane", "config.json")
    const config = fs.existsSync(configPath)
      ? JSON.parse(fs.readFileSync(configPath, "utf8")) as LearningConfigFile
      : {}
    assert.equal(config.learning?.capture, undefined)
  })

  it("interactive init continues after consent EOF before overwrite prompt", () => {
    const configPath =
      process.platform === "darwin"
        ? path.join(home, "Library/Application Support/Claude/claude_desktop_config.json")
        : path.join(home, ".config/Claude/claude_desktop_config.json")
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { "memory-lane": { command: "old-memory-lane" } } }), "utf8")

    const result = runWithStatus(["init"], {
      HOME: home,
      NO_COLOR: "1",
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    }, undefined, "3\n")

    assert.equal(result.status, 0)
    assert.match(result.stdout, /Enable local learning\? \[y\/N\]/u)
    assert.match(result.stdout, /Claude Desktop\s+configured/u)
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
    assert.equal(config.mcpServers["memory-lane"].command, binaryPath)
  })

  it("--yes init does not enable local trace capture implicitly", () => {
    run(["init", "--yes"], {
      HOME: home,
      MEMORY_LANE_INSTALL_BINARY: binaryPath,
    })

    type LearningConfigFile = { learning?: { capture?: "on" | "off" } }
    const configPath = path.join(home, ".memory-lane", "config.json")
    const config = fs.existsSync(configPath)
      ? JSON.parse(fs.readFileSync(configPath, "utf8")) as LearningConfigFile
      : {}
    assert.notEqual(config.learning?.capture, "on")
  })
})
