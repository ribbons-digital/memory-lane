import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { readContinuityBaseline, writeContinuityBaseline } from "../src/continuity-baseline.ts"
import { tempDir } from "./helpers.ts"

test("writeContinuityBaseline preserves existing project markers", () => {
  const filePath = path.join(tempDir(), "continuity-baselines.json")
  const first = "2026-07-02T00:00:00.000Z"
  const second = "2026-07-02T01:00:00.000Z"

  assert.equal(writeContinuityBaseline(filePath, "project-a", first).ok, true)
  assert.equal(writeContinuityBaseline(filePath, "project-b", second).ok, true)

  assert.equal(readContinuityBaseline(filePath, "project-a").marker?.lastSeenAt, first)
  assert.equal(readContinuityBaseline(filePath, "project-b").marker?.lastSeenAt, second)
})

test("writeContinuityBaseline refuses to clobber unreadable baseline files", () => {
  const filePath = path.join(tempDir(), "continuity-baselines.json")
  fs.writeFileSync(filePath, "not json", "utf8")

  const result = writeContinuityBaseline(filePath, "project-a", "2026-07-02T00:00:00.000Z")

  assert.equal(result.ok, false)
  assert.match(result.warning ?? "", /unreadable/u)
  assert.equal(fs.readFileSync(filePath, "utf8"), "not json")
})
