import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { tempDir } from "../../core/test/helpers.js"
import { detectHarnesses, harnessName } from "../src/installer/detect.js"

function ompDetection(homeDir: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  const detected = detectHarnesses({ homeDir, env }).find((entry) => entry.harness === "omp")
  assert.ok(detected)
  return detected
}

describe("OMP harness detection", () => {
  it("uses the required display name", () => {
    assert.equal(harnessName("omp"), "OMP (Oh My Pi)")
  })

  it("detects OMP from the default agent directory", () => {
    const home = tempDir()
    fs.mkdirSync(path.join(home, ".omp", "agent"), { recursive: true })
    const detected = ompDetection(home, { PATH: "" })
    assert.equal(detected.detected, true)
    assert.equal(detected.configPath, path.join(home, ".omp", "agent", "extensions", "memory-lane", "index.ts"))
  })

  it("detects OMP from an isolated command path", () => {
    const home = tempDir()
    const bin = path.join(tempDir(), "bin")
    fs.mkdirSync(bin, { recursive: true })
    fs.writeFileSync(path.join(bin, process.platform === "win32" ? "omp.exe" : "omp"), "stub", "utf8")
    const detected = ompDetection(home, { PATH: bin })
    assert.equal(detected.detected, true)
  })

  it("does not detect OMP when the directory and command are absent", () => {
    const home = tempDir()
    const detected = ompDetection(home, { PATH: path.join(tempDir(), "empty-bin") })
    assert.equal(detected.detected, false)
  })

  it("honors an explicit OMP agent root", () => {
    const home = tempDir()
    const agentDir = path.join(tempDir(), "custom-agent")
    fs.mkdirSync(agentDir, { recursive: true })
    const detected = ompDetection(home, { PATH: "", PI_CODING_AGENT_DIR: agentDir })
    assert.equal(detected.detected, true)
    assert.equal(detected.configPath, path.join(agentDir, "extensions", "memory-lane", "index.ts"))
    assert.equal(fs.existsSync(path.join(home, ".omp")), false)
  })
})
