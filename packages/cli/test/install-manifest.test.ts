import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { tempDir } from "../../core/test/helpers.js"
import {
  integrationConfigPath,
  mergeManifestIntegrations,
  ompDiagnosticTarget,
  readInstallManifest,
  validateAbsoluteManifestPath,
  writeInstallManifest,
} from "../src/installer/manifest.js"

describe("install manifest", () => {
  it("distinguishes missing malformed and partial manifests", () => {
    const dataDir = tempDir()
    assert.equal(readInstallManifest(dataDir).status, "missing")

    fs.writeFileSync(path.join(dataDir, "install.json"), "{", "utf8")
    const malformed = readInstallManifest(dataDir)
    assert.equal(malformed.status, "malformed")
    assert.match(malformed.warnings.join("\n"), /Invalid JSON/u)

    fs.writeFileSync(path.join(dataDir, "install.json"), JSON.stringify({ binaryPath: "/bin/memory-lane" }), "utf8")
    const partial = readInstallManifest(dataDir)
    assert.equal(partial.status, "partial")
    assert.match(partial.warnings.join("\n"), /integrations must be an array/u)
  })

  it("preserves unknown and malformed integration entries for diagnostics", () => {
    const dataDir = tempDir()
    writeInstallManifest(dataDir, {
      version: "0.1.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      binaryPath: "/bin/memory-lane",
      dataDir,
      integrations: [
        { harness: "future-harness", configPath: "/future/config" },
        { harness: "omp" },
      ],
    })
    const read = readInstallManifest(dataDir)
    assert.equal(read.status, "valid")
    if (read.status !== "valid") return
    assert.equal(read.manifest.integrations.length, 2)
    assert.match(read.warnings.join("\n"), /no usable configPath/u)
  })

  it("merges configured harnesses without dropping unselected or unknown entries", () => {
    const previous = [
      { harness: "pi", configPath: "/old/pi" },
      { harness: "future-harness", configPath: "/future/config" },
      { harness: "omp", configPath: "/old/omp" },
    ]
    assert.deepEqual(mergeManifestIntegrations(previous, [
      { harness: "omp", configPath: "/new/omp" },
    ]), [
      { harness: "pi", configPath: "/old/pi" },
      { harness: "future-harness", configPath: "/future/config" },
      { harness: "omp", configPath: "/new/omp" },
    ])
  })

  it("requires normalized absolute POSIX and Windows paths", () => {
    assert.deepEqual(validateAbsoluteManifestPath("/opt/../opt/memory-lane", "binary", path.posix), {
      ok: true,
      value: "/opt/memory-lane",
    })
    assert.equal(validateAbsoluteManifestPath("relative/memory-lane", "binary", path.posix).ok, false)
    assert.deepEqual(validateAbsoluteManifestPath("C:\\Tools\\..\\Tools\\memory-lane.exe", "binary", path.win32), {
      ok: true,
      value: "C:\\Tools\\memory-lane.exe",
    })
    assert.equal(validateAbsoluteManifestPath("Tools\\memory-lane.exe", "binary", path.win32).ok, false)
  })

  it("validates integration paths without inferring the environment", () => {
    assert.deepEqual(integrationConfigPath({ harness: "omp", configPath: "/custom/extensions/memory-lane/index.ts" }, path.posix), {
      ok: true,
      value: "/custom/extensions/memory-lane/index.ts",
    })
    assert.equal(integrationConfigPath({ harness: "omp", configPath: "extensions/memory-lane/index.ts" }, path.posix).ok, false)
  })

  it("uses recorded OMP paths before the resolver and reports unusable recorded paths", () => {
    const dataDir = tempDir()
    const home = tempDir()
    writeInstallManifest(dataDir, {
      version: "0.1.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      binaryPath: path.join(home, "bin", "memory-lane"),
      dataDir,
      integrations: [{ harness: "omp", configPath: path.join(home, "override", "extensions", "memory-lane", "index.ts") }],
    })
    const read = readInstallManifest(dataDir)
    assert.deepEqual(ompDiagnosticTarget(read, {}, home), {
      path: path.join(home, "override", "extensions", "memory-lane", "index.ts"),
      warnings: [],
    })

    writeInstallManifest(dataDir, {
      version: "0.1.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      binaryPath: path.join(home, "bin", "memory-lane"),
      dataDir,
      integrations: [{ harness: "omp", configPath: "relative/index.ts" }],
    })
    const unusable = ompDiagnosticTarget(readInstallManifest(dataDir), {}, home)
    assert.equal(unusable.path, null)
    assert.match(unusable.warnings.join("\n"), /must be an absolute path/u)
  })
})
