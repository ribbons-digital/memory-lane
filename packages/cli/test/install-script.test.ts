import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { tempDir } from "../../core/test/helpers.js"

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..")

function writeExecutable(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, "utf8")
  fs.chmodSync(filePath, 0o755)
}

test("install.sh restores previous binary when the new binary fails smoke test", { skip: process.platform === "win32" }, () => {
  const root = tempDir()
  const home = path.join(root, "home")
  const installDir = path.join(root, "bin")
  const installPath = path.join(installDir, "memory-lane")
  const badBinary = path.join(root, "bad-memory-lane")
  fs.mkdirSync(installDir, { recursive: true })
  fs.mkdirSync(home, { recursive: true })
  writeExecutable(installPath, "#!/bin/sh\necho old-binary\n")
  writeExecutable(badBinary, "#!/bin/sh\nexit 137\n")

  const result = spawnSync("sh", [path.join(repoRoot, "install.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      INSTALL_DIR: installDir,
      MEMORY_LANE_INSTALL_BINARY: badBinary,
      PATH: process.env.PATH ?? "",
    },
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr + result.stdout, /installed binary failed smoke test/u)
  assert.equal(fs.readFileSync(installPath, "utf8"), "#!/bin/sh\necho old-binary\n")
})

test("install.sh installs a binary that passes smoke test", { skip: process.platform === "win32" }, () => {
  const root = tempDir()
  const home = path.join(root, "home")
  const installDir = path.join(root, "bin")
  const goodBinary = path.join(root, "good-memory-lane")
  fs.mkdirSync(home, { recursive: true })
  writeExecutable(goodBinary, "#!/bin/sh\nif [ \"$1\" = \"--smoke-test\" ]; then exit 0; fi\necho good-binary\n")

  const result = spawnSync("sh", [path.join(repoRoot, "install.sh")], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      INSTALL_DIR: installDir,
      MEMORY_LANE_INSTALL_BINARY: goodBinary,
      PATH: process.env.PATH ?? "",
    },
  })

  assert.equal(result.status, 0, result.stderr + result.stdout)
  const installed = path.join(installDir, "memory-lane")
  assert.equal(spawnSync(installed, ["--smoke-test"]).status, 0)
})
