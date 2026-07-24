import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  ESSENTIAL_TOOL_ALLOWLIST,
  EXPECTED_PI_TOOLS,
  PINNED_PI_VERSION,
  evaluatePiSourceForm,
  isolatedPiEnvironment,
  piRpcCommandPlan,
  validatePiVersion,
} from "./pi-compatibility-runner.js"

describe("Pi 0.81.1 compatibility runner", () => {
  it("requires the exact pinned Pi version", () => {
    validatePiVersion(`${PINNED_PI_VERSION}\n`)
    for (const output of ["0.81.0", "pi 0.81.1", "0.81.1-next", ""]) {
      assert.throws(
        () => validatePiVersion(output),
        /requires exact 0\.81\.1/u,
        output || "empty version output",
      )
    }
  })

  it("constructs an isolated real-RPC plan with the explicit memory_save allowlist", () => {
    assert.deepEqual(piRpcCommandPlan({
      executable: "/opt/pi/bin/pi",
      extensionPath: "/scratch/extension.ts",
      sessionDir: "/scratch/sessions",
    }), {
      command: "/opt/pi/bin/pi",
      args: [
        "--mode", "rpc",
        "--session-dir", "/scratch/sessions",
        "--no-extensions",
        "--extension", "/scratch/extension.ts",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--approve",
        "--provider", "memory-lane-compat",
        "--model", "compat-model",
        "--tools", "memory_save",
        "--thinking", "off",
      ],
    })
    assert.deepEqual(ESSENTIAL_TOOL_ALLOWLIST, ["memory_save"])
  })

  it("isolates Pi configuration, sessions, storage, XDG state, and loopback networking", () => {
    const env = isolatedPiEnvironment({
      HOME: "/real/home",
      PI_CODING_AGENT_DIR: "/real/pi-agent",
      HTTP_PROXY: "http://proxy.invalid",
      KEEP_ME: "yes",
    }, {
      homeDir: "/scratch/home",
      agentDir: "/scratch/pi-agent",
      configDir: "/scratch/config",
      cacheDir: "/scratch/cache",
      dataDir: "/scratch/data",
      memoryPath: "/scratch/storage/memory.jsonl",
      embeddingsPath: "/scratch/storage/embeddings.jsonl",
      memoryConfigPath: "/scratch/storage/config.json",
    })

    assert.equal(env.HOME, "/scratch/home")
    assert.equal(env.PI_CODING_AGENT_DIR, "/scratch/pi-agent")
    assert.equal(env.XDG_CONFIG_HOME, "/scratch/config")
    assert.equal(env.XDG_CACHE_HOME, "/scratch/cache")
    assert.equal(env.XDG_DATA_HOME, "/scratch/data")
    assert.equal(env.MEMORY_LANE_FILE, "/scratch/storage/memory.jsonl")
    assert.equal(env.PI_MEMORY_FILE, env.MEMORY_LANE_FILE)
    assert.equal(env.HTTP_PROXY, undefined)
    assert.equal(env.NO_PROXY, "127.0.0.1,localhost")
    assert.equal(env.PI_OFFLINE, "1")
    assert.equal(env.PI_TELEMETRY, "0")
    assert.equal(env.KEEP_ME, "yes")
  })

  it("passes only when production definitions, real selection, execution, and persistence all agree", () => {
    for (const form of ["adapter", "bridge"] as const) {
      const passing = evaluatePiSourceForm({
        form,
        registrations: EXPECTED_PI_TOOLS[form].map((name) => ({ name, loadMode: "essential" })),
        selections: [{ activeTools: ["memory_save"], allTools: ["memory_save"], selectedTools: ["memory_save"] }],
        providerRequests: [
          { toolNames: ["memory_save"], roles: ["system", "user"] },
          { toolNames: ["memory_save"], roles: ["system", "user", "assistant", "tool"] },
        ],
        toolEvents: [{ type: "tool_execution_end", toolName: "memory_save", isError: false }],
        persistedTexts: ["Pi 0.81.1 compatibility sentinel"],
      })
      assert.equal(passing.pass, true)
      assert.ok(Object.values(passing.checks).every(Boolean))

      const missingAllowlist = evaluatePiSourceForm({
        form,
        registrations: EXPECTED_PI_TOOLS[form].map((name) => ({ name, loadMode: "essential" })),
        selections: [{ activeTools: [], allTools: ["memory_save"], selectedTools: [] }],
        providerRequests: [],
        toolEvents: [],
        persistedTexts: [],
      })
      assert.equal(missingAllowlist.pass, false)
      assert.equal(missingAllowlist.checks.allowlistSelectionPreserved, false)
      assert.equal(missingAllowlist.checks.providerSchemaVisible, false)
      assert.equal(missingAllowlist.checks.memorySaveExecuted, false)
      assert.equal(missingAllowlist.checks.isolatedPersistenceSucceeded, false)
    }
  })
})
