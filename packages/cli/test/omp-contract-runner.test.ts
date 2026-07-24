import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { tempDir } from "../../core/test/helpers.js"
import { OMP_CONTRACT_DIAGNOSTIC } from "../../core/src/integration-diagnostics.js"
import { installOmp, installPi, piAdapterImportSource, piCliBridgeSource } from "../src/installer/config.js"
import {
  CONTRACT_EVENTS,
  CONTRACT_TOOL_LOAD_MODE,
  EXPECTED_REGISTRATIONS,
  OMP_WORKER_ROLE_SENTINEL,
  PINNED_OMP_VERSION,
  REQUIRED_FLAGS,
  ompContractOverallPass,
  compiledHostRuntimeResult,
  inputVerificationResult,
  manualInputVerificationPass,
  isolatedOmpEnvironment,
  ompContractWrapperSource,
  ompRpcCommandPlan,
  taskSessionResult,
  validateOmpContract,
  type ContractEvent,
  type EventStatus,
  type SourceForm,
} from "./omp-contract-runner.js"

const fixturePath = fileURLToPath(new URL("fixtures/omp-contract-17.1.0.json", import.meta.url))

type FixtureEvent = { status: string; evidence: string[] }
type FixtureSourceForm = {
  sourceForm: SourceForm
  registrations: string[]
  missingRegistrations: string[]
  incompleteEvents: string[]
  inputVerification: {
    rpc: { status: string; evidence: string[] }
    interactive: { status: string; evidence: string[] }
  }
  events: Record<string, FixtureEvent>
}
type ContractFixture = {
  schemaVersion: number
  host: string
  expectedVersion: string
  actualVersion: string
  testedAt: string
  execution: Record<string, unknown>
  sourceForms: FixtureSourceForm[]
  overallPass: boolean
  harnessArtifacts: Array<{
    sourceForm: SourceForm
    providerRegistered: boolean
    contractToolRegisteredEssential: boolean
    productionToolsRegisteredEssential: boolean
  }>
  toolError: { status: string }
  deferredCompaction: { status: string }
  compiledHostRuntime: {
    status: string
    compiledOmpExecPathIsOmpExecutable: boolean
    sourceForms: Array<{ sourceForm: SourceForm; execPaths: string[]; ompExecutableObserved: boolean }>
  }
  taskSessions: {
    status: string
    sourceForms: Array<{
      sourceForm: SourceForm
      missingEvents: string[]
      taskSignals: { nestedSessionFile: boolean; subagentRole: boolean; workerRoleSentinel: string; parentLineageObserved: boolean }
      taskResult: { status: string; evidence: Array<{ outputMatchesSentinel: boolean; resolvedModel: string; requests: number }> }
      automaticCaptureSuppressed: boolean
    }>
  }
}

function readFixture(): ContractFixture {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as ContractFixture
}

function installOptions(homeDir: string, binaryPath: string) {
  return {
    binaryPath,
    dataDir: path.join(homeDir, ".memory-lane"),
    projectMode: false,
    yes: true,
    homeDir,
  }
}
function passingSourceForms(): Array<{
  sourceForm: SourceForm
  registrations: string[]
  events: Record<ContractEvent, { status: EventStatus }>
}> {
  return (["development-bridge", "release-bridge"] as const).map((sourceForm) => ({
    sourceForm,
    registrations: [...EXPECTED_REGISTRATIONS[sourceForm]],
    events: Object.fromEntries(CONTRACT_EVENTS.map((event) => [event, { status: "pass" }])) as Record<ContractEvent, { status: EventStatus }>,
  }))
}


describe("OMP contract runner", () => {
  it("certifies the committed OMP 17.1.0 real-runtime contract", () => {
    const report = readFixture()
    assert.deepEqual(OMP_CONTRACT_DIAGNOSTIC, {
      testedVersion: report.expectedVersion,
      testedAt: report.testedAt,
      overallPass: report.overallPass,
    })
    assert.equal(report.schemaVersion, 1)
    assert.equal(report.host, "omp")
    assert.equal(report.expectedVersion, "17.1.0")
    assert.equal(report.actualVersion, "omp/17.1.0")
    assert.equal(report.testedAt, "2026-07-24")
    assert.equal(report.overallPass, true)
    assert.deepEqual(report.execution, {
      realRuntime: true,
      mode: "rpc",
      extensionFlag: true,
      scratchHome: true,
      scratchProfile: true,
      scratchAgentDir: true,
      manualRealTtyInput: true,
      compactionMechanism: "rpc compact",
      modelMechanism: "loopback OpenAI-compatible deterministic contract provider available to main and delegated child sessions",
    })
    assert.deepEqual(report.sourceForms.map((form) => form.sourceForm), ["development-bridge", "release-bridge"])
    for (const form of report.sourceForms) {
      assert.deepEqual(Object.keys(form.events), [...CONTRACT_EVENTS])
      assert.ok(Object.values(form.events).every((event) => event.status === "pass"))
      assert.deepEqual(form.incompleteEvents, [])
      assert.equal(form.inputVerification.rpc.status, "pass")
      assert.equal(form.inputVerification.interactive.status, "pass")
      assert.ok(form.inputVerification.interactive.evidence.includes("genuine real-TTY input and accepted pass-through result were observed"))
      assert.ok(form.events.turn_end.evidence.includes("raw payload omits legacy Pi fields consumed before normalization: turnId, lastUserMessage, lastAssistantMessage"))
      assert.ok(form.events.tool_result.evidence.includes("deterministic registered tool executed successfully before live tool_result delivery"))
    }
    assert.equal(report.toolError.status, "pass")
    assert.equal(report.deferredCompaction.status, "pass")
    assert.equal(report.compiledHostRuntime.status, "pass")
    assert.equal(report.compiledHostRuntime.compiledOmpExecPathIsOmpExecutable, true)
    assert.ok(report.compiledHostRuntime.sourceForms.every((form) =>
      form.ompExecutableObserved && form.execPaths.every((execPath) => execPath === "<official-omp-17.1.0-executable>")))
    assert.ok(report.harnessArtifacts.every((artifact) =>
      artifact.providerRegistered && artifact.contractToolRegisteredEssential && artifact.productionToolsRegisteredEssential))
    assert.equal(report.taskSessions.status, "pass")
    assert.ok(report.taskSessions.sourceForms.every((form) =>
      form.missingEvents.length === 0
      && form.taskSignals.nestedSessionFile
      && form.taskSignals.subagentRole
      && form.taskSignals.workerRoleSentinel === OMP_WORKER_ROLE_SENTINEL
      && !form.taskSignals.parentLineageObserved
      && form.taskResult.status === "completed"
      && form.taskResult.evidence.some((entry) => entry.outputMatchesSentinel && entry.requests > 0)
      && form.automaticCaptureSuppressed))
  })

  it("keeps current bridge registration expectations aligned with the certified fixture", () => {
    const report = readFixture()
    assert.deepEqual(report.sourceForms.map((form) => form.sourceForm), ["development-bridge", "release-bridge"])
    for (const sourceForm of ["development-bridge", "release-bridge"] as const) {
      const fixtureForm = report.sourceForms.find((form) => form.sourceForm === sourceForm)
      assert.ok(fixtureForm)
      for (const registration of EXPECTED_REGISTRATIONS[sourceForm]) {
        assert.ok(fixtureForm.registrations.includes(registration), `${sourceForm} fixture is missing ${registration}`)
      }
      assert.deepEqual(fixtureForm.missingRegistrations, [])
    }
  })

  it("committed fixture is bounded sanitized and free of machine-local evidence", () => {
    const fixture = fs.readFileSync(fixturePath, "utf8")
    assert.ok(Buffer.byteLength(fixture) < 50_000)
    assert.doesNotMatch(fixture, /\/Users\/|\/var\/folders\/|\/private\/(?:tmp|var)\/|\/tmp\//u)
    assert.doesNotMatch(fixture, /MEMORY_LANE_CONTRACT_KEY|contract-only/u)
    assert.doesNotMatch(fixture, /Released v9\.9\.9 after OMP contract verification/u)
  })

  it("reports OMP task-session ownership and worker-role signals independently", () => {
    const requiredEvents = ["before_agent_start", "turn_end", "tool_result"]
    for (const [nestedSessionFile, subagentRole] of [[true, false], [false, true]] as const) {
      const entries = requiredEvents.map((name) => ({
        kind: "event" as const,
        name,
        owner: "production" as const,
        contextValues: {
          taskSession: true,
          nestedSessionFile,
          subagentRole,
          workerRoleSentinel: subagentRole ? OMP_WORKER_ROLE_SENTINEL : "",
          parentLineage: false,
        },
        resultShape: {},
      }))
      const result = taskSessionResult([{ form: "development-bridge", entries, memoryText: "" }])
      assert.equal(result.status, "fail")
      assert.deepEqual(result.sourceForms[0].taskSignals, {
        nestedSessionFile,
        subagentRole,
        workerRoleSentinel: OMP_WORKER_ROLE_SENTINEL,
        parentLineageObserved: false,
      })
    }
  })

  it("cannot certify suppression when the delegated task result failed", () => {
    const childEntries = ["before_agent_start", "turn_end", "tool_result"].map((name) => ({
      kind: "event" as const,
      name,
      owner: "production" as const,
      contextValues: {
        taskSession: true,
        nestedSessionFile: true,
        subagentRole: true,
        workerRoleSentinel: OMP_WORKER_ROLE_SENTINEL,
        parentLineage: false,
      },
      resultShape: {},
    }))
    const failedTaskResult = {
      kind: "event" as const,
      name: "tool_result",
      owner: "production" as const,
      contextValues: { taskSession: false },
      eventValues: {
        toolName: "task",
        isError: true,
        taskStatus: "failed",
        taskResultCount: 1,
        taskExitCode: 1,
        taskAborted: false,
        taskOutputMatchesSentinel: false,
        taskResolvedModel: "memory-lane-contract/contract-model",
        taskRequests: 1,
      },
      resultShape: {},
    }

    const result = taskSessionResult([{
      form: "development-bridge",
      entries: [...childEntries, failedTaskResult],
      memoryText: "",
    }])
    assert.equal(result.status, "fail")
    assert.equal(result.sourceForms[0].taskResult.status, "failed")
    assert.equal(result.sourceForms[0].automaticCaptureSuppressed, false)
  })

  it("certifies a completed delegated task only with lifecycle, exact worker-role, and suppression signals", () => {
    const childEntries = ["before_agent_start", "turn_end", "tool_result"].map((name) => ({
      kind: "event" as const,
      name,
      owner: "production" as const,
      contextValues: {
        taskSession: true,
        nestedSessionFile: true,
        subagentRole: true,
        workerRoleSentinel: OMP_WORKER_ROLE_SENTINEL,
        parentLineage: false,
      },
      resultShape: {},
    }))
    const completedTaskResult = {
      kind: "event" as const,
      name: "tool_result",
      owner: "production" as const,
      contextValues: { taskSession: false },
      eventValues: {
        toolName: "task",
        isError: false,
        taskStatus: "completed",
        taskResultCount: 1,
        taskExitCode: 0,
        taskAborted: false,
        taskOutputMatchesSentinel: true,
        taskResolvedModel: "memory-lane-contract/contract-model",
        taskRequests: 1,
      },
      resultShape: {},
    }

    const result = taskSessionResult([{
      form: "release-bridge",
      entries: [...childEntries, completedTaskResult],
      memoryText: "",
    }])
    assert.equal(result.status, "pass")
    assert.equal(result.sourceForms[0].taskSignals.workerRoleSentinel, "You are a worker agent for delegated tasks.")
    assert.equal(result.sourceForms[0].taskResult.status, "completed")
    assert.equal(result.sourceForms[0].automaticCaptureSuppressed, true)
  })

  it("requires every lifecycle event to pass, including production-design omissions", () => {
    const sourceForms = passingSourceForms()
    assert.equal(ompContractOverallPass(sourceForms), true, "complete lifecycle and registration coverage should pass")

    sourceForms[1].events.input.status = "not-registered-by-production-design"
    sourceForms[1].events.turn_end.status = "not-registered-by-production-design"
    sourceForms[1].events.tool_result.status = "not-registered-by-production-design"

    assert.equal(ompContractOverallPass(sourceForms), false)
  })

  it("requires every expected command and tool registration when lifecycle events pass", () => {
    const missingRegistrationCases = [
      { sourceForm: "development-bridge", registration: "command:remember" },
      { sourceForm: "release-bridge", registration: "tool:memory_get" },
    ] as const

    for (const { sourceForm, registration } of missingRegistrationCases) {
      const sourceForms = passingSourceForms()
      const result = sourceForms.find((candidate) => candidate.sourceForm === sourceForm)!
      result.registrations = result.registrations.filter((observed) => observed !== registration)

      assert.equal(ompContractOverallPass(sourceForms), false, `${sourceForm} without ${registration}`)
    }
  })

  it("accepts only OMP 17.1.0", () => {
    const help = REQUIRED_FLAGS.join(" ")
    assert.equal(PINNED_OMP_VERSION, "17.1.0")
    assert.doesNotThrow(() => validateOmpContract("omp/17.1.0", help))
    assert.doesNotThrow(() => validateOmpContract("omp v17.1.0", help))
    for (const versionOutput of ["omp/16.4.8", "omp/17.1.1", "omp v17.0.0", "unexpected version output", ""]) {
      assert.throws(
        () => validateOmpContract(versionOutput, help),
        new RegExp(`OMP contract requires ${PINNED_OMP_VERSION.replaceAll(".", "\\.")}`),
        versionOutput || "empty version output",
      )
    }
  })

  it("reports every required OMP flag missing from help output", () => {
    const help = REQUIRED_FLAGS.filter((flag) => flag !== "--extension" && flag !== "--max-time").join(" ")
    assert.throws(
      () => validateOmpContract(`omp/${PINNED_OMP_VERSION}`, help),
      /missing required flags: --extension, --max-time/u,
    )
    assert.throws(
      () => validateOmpContract(`omp/${PINNED_OMP_VERSION}`, "--extension-dir " + REQUIRED_FLAGS.filter((flag) => flag !== "--extension").join(" ")),
      /missing required flags: --extension/u,
      "a longer flag name must not satisfy the required --extension option",
    )
  })
  it("isolates loopback OMP execution from package-manager proxy injection", () => {
    const env = isolatedOmpEnvironment({
      HTTP_PROXY: "http://socket-firewall.invalid",
      HTTPS_PROXY: "http://socket-firewall.invalid",
      ALL_PROXY: "http://socket-firewall.invalid",
      http_proxy: "http://socket-firewall.invalid",
      https_proxy: "http://socket-firewall.invalid",
      all_proxy: "http://socket-firewall.invalid",
      KEEP_ME: "preserved",
    }, { HOME: "/scratch/home" })
    for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
      assert.equal(env[key], undefined)
    }
    assert.equal(env.NO_PROXY, "127.0.0.1,localhost")
    assert.equal(env.no_proxy, env.NO_PROXY)
    assert.equal(env.KEEP_ME, "preserved")
    assert.equal(env.HOME, "/scratch/home")
  })

  it("keeps extension-defined tools out of startup selection and exposes the contract tool as essential", () => {
    const plan = ompRpcCommandPlan({
      executable: "/opt/omp/bin/omp",
      profile: "memory-lane-contract-adapter-42",
      projectDir: "/scratch/project",
      sessionDir: "/scratch/sessions",
      configPath: "/scratch/omp-contract.yml",
      extensionPath: "/scratch/memory-lane-contract.ts",
    })
    const toolsIndex = plan.args.indexOf("--tools")
    assert.notEqual(toolsIndex, -1)
    assert.equal(plan.args[toolsIndex + 1], "task")
    assert.ok(!plan.args.some((arg) => arg.includes("shell:memory-lane-contract")))

    const wrapper = ompContractWrapperSource("/target.ts", "/events.jsonl", "http://127.0.0.1:1234/v1")
    assert.equal(CONTRACT_TOOL_LOAD_MODE, "essential")
    assert.match(wrapper, /name: "shell:memory-lane-contract",[\s\S]*?loadMode: "essential"/u)
    assert.match(wrapper, /name: "host-runtime"[\s\S]*?execPath: process\.execPath/u)
    assert.match(wrapper, /apiKey: "MEMORY_LANE_CONTRACT_KEY"/u)
    assert.match(wrapper, /workerRoleSentinel = "You are a worker agent for delegated tasks\."/u)
  })

  it("sanitizes matching compiled OMP executable paths after checking the raw paths", () => {
    const executable = process.execPath
    const matchingEntry = {
      kind: "mechanism" as const,
      name: "host-runtime",
      eventValues: { execPath: executable },
    }
    const mismatchedPath = path.join(path.dirname(executable), "not-the-selected-omp")
    const mismatchedEntry = {
      kind: "mechanism" as const,
      name: "host-runtime",
      eventValues: { execPath: mismatchedPath },
    }

    const matching = compiledHostRuntimeResult(executable, [{ form: "development-bridge", entries: [matchingEntry] }])
    assert.equal(matching.status, "pass")
    assert.deepEqual(matching.sourceForms[0].execPaths, ["<official-omp-17.1.0-executable>"])

    const mismatched = compiledHostRuntimeResult(executable, [{ form: "development-bridge", entries: [mismatchedEntry] }])
    assert.equal(mismatched.status, "fail")
    assert.deepEqual(mismatched.sourceForms[0].execPaths, [mismatchedPath])
  })

  it("requires requested real-TTY input verification to pass overall gating", () => {
    const interactive = (status: "pass" | "fail" | "not-run") => [{ inputVerification: { interactive: { status } } }]
    assert.equal(manualInputVerificationPass(true, interactive("pass")), true)
    assert.equal(manualInputVerificationPass(true, interactive("fail")), false)
    assert.equal(manualInputVerificationPass(true, interactive("not-run")), false)
    assert.equal(manualInputVerificationPass(false, interactive("not-run")), true)
  })

  it("represents RPC input absence separately from optional real-TTY evidence", () => {
    const registration = { kind: "registration" as const, name: "input", owner: "production" as const }
    assert.deepEqual(inputVerificationResult([registration], [registration], false), {
      rpc: { status: "pass", evidence: ["input handler registered; RPC prompts correctly emitted no interactive input event"] },
      interactive: { status: "not-run", evidence: ["real-TTY input verification was not requested and is not inferred from RPC"] },
    })

    const unexpectedRpcInput = {
      kind: "event" as const,
      name: "input",
      owner: "production" as const,
      contextValues: { taskSession: false },
    }
    assert.equal(inputVerificationResult([registration, unexpectedRpcInput], [registration, unexpectedRpcInput], false).rpc.status, "fail")

    const interactiveInput = {
      kind: "event" as const,
      name: "input",
      owner: "production" as const,
      eventValues: { source: "interactive", textMatchesSentinel: true },
      resultValues: { action: "continue" },
    }
    const manualEvidence = {
      kind: "mechanism" as const,
      name: "input",
      owner: "harness" as const,
      note: "genuine real-TTY editor submission observed in this contract run",
    }
    const verified = inputVerificationResult([registration], [registration, interactiveInput, manualEvidence], true)
    assert.equal(verified.rpc.status, "pass")
    assert.equal(verified.interactive.status, "pass")
  })

  it("constructs the isolated RPC launch plan without invoking OMP", () => {
    assert.deepEqual(ompRpcCommandPlan({
      executable: "/opt/omp/bin/omp",
      profile: "memory-lane-contract-adapter-42",
      projectDir: "/scratch/project",
      sessionDir: "/scratch/sessions",
      configPath: "/scratch/omp-contract.yml",
      extensionPath: "/scratch/memory-lane-contract.ts",
    }), {
      command: "/opt/omp/bin/omp",
      args: [
        "--mode", "rpc",
        "--profile", "memory-lane-contract-adapter-42",
        "--cwd", "/scratch/project",
        "--session-dir", "/scratch/sessions",
        "--no-skills",
        "--no-rules",
        "--config", "/scratch/omp-contract.yml",
        "--extension", "/scratch/memory-lane-contract.ts",
        "--auto-approve",
        "--model", "memory-lane-contract/contract-model",
        "--tools", "task",
        "--append-system-prompt", "Memory Lane contract runtime. Follow the current user request exactly.",
        "--max-time", "180",
      ],
    })
  })
})

describe("production Pi and OMP extension source equivalence", () => {
  it("installPi writes byte-identical adapter-import source for a development checkout", () => {
    const root = tempDir()
    const homeDir = path.join(root, "home")
    const binaryPath = path.join(root, "packages/cli/dist/index.js")
    const adapterPath = path.join(root, "packages/pi-adapter/dist/index.js")
    fs.mkdirSync(path.dirname(adapterPath), { recursive: true })
    fs.writeFileSync(adapterPath, "export default function () {}\n", "utf8")

    const result = installPi(installOptions(homeDir, binaryPath))

    assert.equal(fs.readFileSync(result.configPath!, "utf8"), piAdapterImportSource(adapterPath))
  })

  it("installPi writes byte-identical CLI bridge source for a release binary", () => {
    const root = tempDir()
    const homeDir = path.join(root, "home")
    const binaryPath = path.join(root, "bin/memory-lane")

    const result = installPi(installOptions(homeDir, binaryPath))

    assert.equal(fs.readFileSync(result.configPath!, "utf8"), piCliBridgeSource(binaryPath))
  })

  it("installOmp writes a CLI bridge for a development checkout while Pi keeps the adapter import", () => {
    const root = tempDir()
    const homeDir = path.join(root, "home")
    const agentDir = path.join(root, "omp-agent")
    const binaryPath = path.join(root, "packages/cli/dist/index.js")
    const adapterPath = path.join(root, "packages/pi-adapter/dist/index.js")
    fs.mkdirSync(path.dirname(adapterPath), { recursive: true })
    fs.writeFileSync(adapterPath, "export default function () {}\n", "utf8")

    const piResult = installPi(installOptions(homeDir, binaryPath))
    const ompResult = installOmp({
      ...installOptions(homeDir, binaryPath),
      env: { PI_CODING_AGENT_DIR: agentDir },
    })

    assert.equal(ompResult.configPath, path.join(agentDir, "extensions", "memory-lane", "index.ts"))
    assert.equal(fs.readFileSync(piResult.configPath!, "utf8"), piAdapterImportSource(adapterPath))
    assert.equal(fs.readFileSync(ompResult.configPath!, "utf8"), piCliBridgeSource(binaryPath))
    assert.equal(fs.readFileSync(ompResult.configPath!, "utf8").includes("pi-adapter/dist/index.js"), false)
  })

  it("installOmp writes byte-identical CLI bridge source for a release binary", () => {
    const root = tempDir()
    const homeDir = path.join(root, "home")
    const binaryPath = path.join(root, "bin/memory-lane")
    const result = installOmp({ ...installOptions(homeDir, binaryPath), env: {} })

    assert.equal(result.configPath, path.join(homeDir, ".omp", "agent", "extensions", "memory-lane", "index.ts"))
    assert.equal(fs.readFileSync(result.configPath!, "utf8"), piCliBridgeSource(binaryPath))
  })
})
