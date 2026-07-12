import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { tempDir } from "../../core/test/helpers.js"
import { installPi, piAdapterImportSource, piCliBridgeSource } from "../src/installer/config.js"
import {
  CONTRACT_EVENTS,
  EXPECTED_REGISTRATIONS,
  PINNED_OMP_VERSION,
  REQUIRED_FLAGS,
  ompRpcCommandPlan,
  validateOmpContract,
} from "./omp-contract-runner.js"

const fixturePath = fileURLToPath(new URL("fixtures/omp-contract-16.4.5.json", import.meta.url))

type FixtureEvent = { status: string; evidence: string[] }
type FixtureSourceForm = {
  sourceForm: "adapter" | "bridge"
  registrations: string[]
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

describe("OMP contract runner", () => {
  it("committed fixture preserves the pinned report contract and recorded lifecycle result matrix", () => {
    const report = readFixture()

    assert.deepEqual({
      schemaVersion: report.schemaVersion,
      host: report.host,
      expectedVersion: report.expectedVersion,
      actualVersion: report.actualVersion,
      testedAt: report.testedAt,
      execution: report.execution,
      sourceForms: report.sourceForms.map(({ sourceForm, events }) => ({
        sourceForm,
        eventNames: Object.keys(events),
        statuses: Object.fromEntries(Object.entries(events).map(([name, result]) => [name, result.status])),
      })),
      overallPass: report.overallPass,
    }, {
      schemaVersion: 1,
      host: "omp",
      expectedVersion: PINNED_OMP_VERSION,
      actualVersion: `omp/${PINNED_OMP_VERSION}`,
      testedAt: "2026-07-12",
      execution: {
        realRuntime: true,
        mode: "rpc",
        extensionFlag: true,
        scratchProfile: true,
        scratchAgentDir: true,
        compactionMechanism: "rpc compact",
      },
      sourceForms: [
        {
          sourceForm: "adapter",
          eventNames: [...CONTRACT_EVENTS],
          statuses: {
            input: "fail",
            before_agent_start: "pass",
            turn_end: "pass",
            tool_result: "fail",
            session_before_compact: "pass",
          },
        },
        {
          sourceForm: "bridge",
          eventNames: [...CONTRACT_EVENTS],
          statuses: {
            input: "not-registered-by-production-design",
            before_agent_start: "pass",
            turn_end: "not-registered-by-production-design",
            tool_result: "not-registered-by-production-design",
            session_before_compact: "pass",
          },
        },
      ],
      overallPass: false,
    })
    assert.ok(report.sourceForms[0].events.turn_end.evidence.includes("raw payload omits legacy Pi fields consumed before normalization: turnId, lastUserMessage, lastAssistantMessage"))
    assert.ok(report.sourceForms[1].events.tool_result.evidence.includes("packages/cli/src/installer/config.ts: piCliBridgeSource omits this handler"))
  })

  it("committed fixture matches the expected registration matrix for both production source forms", () => {
    const report = readFixture()
    assert.deepEqual(
      Object.fromEntries(report.sourceForms.map(({ sourceForm, registrations }) => [sourceForm, [...registrations].sort()])),
      Object.fromEntries(Object.entries(EXPECTED_REGISTRATIONS).map(([sourceForm, registrations]) => [sourceForm, [...registrations].sort()])),
    )
  })

  it("rejects OMP versions other than the pinned contract version", () => {
    const help = REQUIRED_FLAGS.join(" ")
    for (const versionOutput of ["omp/16.4.4", "omp v17.0.0", "unexpected version output", ""]) {
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
        "--tools", "bash",
        "--append-system-prompt", "Contract instruction: obey explicit requests to call the bash tool exactly once.",
        "--max-time", "180",
      ],
    })
  })
})

describe("production Pi extension source equivalence", () => {
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
})
