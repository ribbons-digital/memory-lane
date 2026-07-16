import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { resolveMcpConfigPath } from "../src/commands/mcp.js"

describe("MCP config path", () => {
  it("uses the OS home directory when HOME is unset", () => {
    const previousHome = process.env.HOME
    const previousConfig = process.env.MEMORY_LANE_CONFIG
    delete process.env.HOME
    delete process.env.MEMORY_LANE_CONFIG

    try {
      assert.equal(resolveMcpConfigPath(), path.join(os.homedir(), ".memory-lane", "config.json"))
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      if (previousConfig === undefined) delete process.env.MEMORY_LANE_CONFIG
      else process.env.MEMORY_LANE_CONFIG = previousConfig
    }
  })

  it("uses a defined HOME before the OS home directory", () => {
    const previousHome = process.env.HOME
    const previousConfig = process.env.MEMORY_LANE_CONFIG
    const home = path.join(os.tmpdir(), "memory-lane-home-override")
    process.env.HOME = home
    delete process.env.MEMORY_LANE_CONFIG

    try {
      assert.equal(resolveMcpConfigPath(), path.join(home, ".memory-lane", "config.json"))
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      if (previousConfig === undefined) delete process.env.MEMORY_LANE_CONFIG
      else process.env.MEMORY_LANE_CONFIG = previousConfig
    }
  })

  it("preserves the explicit config override", () => {
    const previousHome = process.env.HOME
    const previousConfig = process.env.MEMORY_LANE_CONFIG
    const expected = path.join(os.tmpdir(), "memory-lane-explicit-config.json")
    process.env.HOME = path.join(os.tmpdir(), "ignored-memory-lane-home")
    process.env.MEMORY_LANE_CONFIG = expected

    try {
      assert.equal(resolveMcpConfigPath(), expected)
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      if (previousConfig === undefined) delete process.env.MEMORY_LANE_CONFIG
      else process.env.MEMORY_LANE_CONFIG = previousConfig
    }
  })
})
