import { test } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { tempDir } from "../../core/test/helpers.js"
import {
  REDACTED_SECRET_CONTENT,
  TRACE_RETENTION_DAYS,
  TRACE_RETENTION_MAX_BYTES,
  captureLifecycleTrace,
} from "../src/trace-capture.ts"
import type { CaptureTraceOptions, TraceRecordV1 } from "../src/trace-capture.ts"
import type { SessionMessage } from "../src/types.ts"

function writeConfig(configPath: string, learning: { capture?: "on" | "off"; excludedProjects?: string[] }): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify({ learning }, null, 2) + "\n", "utf8")
}

function projectWithScope(projectKey: string): string {
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: projectKey }), "utf8")
  return project
}

function traceJsonFiles(root: string): string[] {
  if (!fs.existsSync(root)) return []
  const files: string[] = []
  for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    const dir = path.join(root, dirent.name)
    for (const child of fs.readdirSync(dir)) {
      if (child.endsWith(".json")) files.push(path.join(dir, child))
    }
  }
  return files.sort()
}

function readTraceFile(root: string): TraceRecordV1 {
  const files = traceJsonFiles(root)
  assert.equal(files.length, 1)
  return JSON.parse(fs.readFileSync(files[0], "utf8")) as TraceRecordV1
}

const messages: SessionMessage[] = [
  { role: "user", content: "Please summarize the release plan", timestamp: "2026-07-09T10:00:00.000Z" },
  { role: "assistant", content: "Release plan is ready" },
]

test("capture is default-off and creates no trace directory when learning.capture is absent", () => {
  const dir = tempDir()
  const traceRoot = path.join(dir, "traces")
  const project = projectWithScope("trace-default-off")

  const record = captureLifecycleTrace({ cwd: project, sessionId: "s-default", messages }, {
    adapter: "claude",
    lifecycleEvent: "session_end",
    configPath: path.join(dir, "missing-config.json"),
    traceRoot,
    now: new Date("2026-07-09T10:01:00.000Z"),
  })

  assert.equal(record, undefined)
  assert.equal(fs.existsSync(traceRoot), false)
})

test("enabled capture writes schema v1 traces with harness event and fidelity for each adapter path", () => {
  const dir = tempDir()
  const configPath = path.join(dir, "config.json")
  const traceRoot = path.join(dir, "traces")
  const project = projectWithScope("trace-schema-project")
  writeConfig(configPath, { capture: "on" })

  const cases: Array<{
    name: string
    adapter: "claude" | "codex" | "pi"
    lifecycleEvent: CaptureTraceOptions["lifecycleEvent"]
    expectedEvent: TraceRecordV1["event"]
    transcriptPath?: string
    fidelity?: TraceRecordV1["fidelity"]
    expectedFidelity: TraceRecordV1["fidelity"]
  }> = [
    { name: "claude session end", adapter: "claude", lifecycleEvent: "session_end", expectedEvent: "session-end", transcriptPath: "/tmp/claude-transcript.jsonl", expectedFidelity: "full-transcript" },
    { name: "claude pre compact", adapter: "claude", lifecycleEvent: "pre_compact", expectedEvent: "pre-compact", expectedFidelity: "payload-messages" },
    { name: "codex session end", adapter: "codex", lifecycleEvent: "session_end", expectedEvent: "session-end", expectedFidelity: "payload-messages" },
    { name: "codex pre compact", adapter: "codex", lifecycleEvent: "pre_compact", expectedEvent: "pre-compact", expectedFidelity: "payload-messages" },
    { name: "pi session end", adapter: "pi", lifecycleEvent: "session_end", expectedEvent: "session-end", expectedFidelity: "payload-messages" },
    { name: "pi pre compact fallback", adapter: "pi", lifecycleEvent: "pre_compact", expectedEvent: "pre-compact", fidelity: "last-turn-fallback", expectedFidelity: "last-turn-fallback" },
  ]

  cases.forEach((item, index) => {
    const record = captureLifecycleTrace({
      cwd: project,
      sessionId: `session-${index}`,
      turnId: `turn-${index}`,
      transcriptPath: item.transcriptPath,
      messages,
      model: "gpt-test",
    }, {
      adapter: item.adapter,
      lifecycleEvent: item.lifecycleEvent,
      fidelity: item.fidelity,
      trigger: item.lifecycleEvent === "pre_compact" ? "manual" : undefined,
      reason: item.adapter === "pi" ? "session_before_compact" : undefined,
      configPath,
      traceRoot,
      now: new Date(Date.parse("2026-07-09T10:02:00.000Z") + index),
    })

    assert.equal(record?.schemaVersion, 1, item.name)
    assert.equal(record?.harness, item.adapter, item.name)
    assert.equal(record?.event, item.expectedEvent, item.name)
    assert.equal(record?.fidelity, item.expectedFidelity, item.name)
    assert.equal(record?.projectKey, "trace-schema-project", item.name)
    assert.equal(record?.messages[0]?.timestamp, "2026-07-09T10:00:00.000Z", item.name)
    assert.equal(record?.meta.model, "gpt-test", item.name)
  })

  assert.equal(traceJsonFiles(traceRoot).length, cases.length)
  const projectIndex = JSON.parse(fs.readFileSync(path.join(traceRoot, "_projects.json"), "utf8")) as Record<string, string>
  assert.equal(Object.values(projectIndex).includes("trace-schema-project"), true)
})

test("redacts likely secret messages before bytes reach the trace file", () => {
  const dir = tempDir()
  const configPath = path.join(dir, "config.json")
  const traceRoot = path.join(dir, "traces")
  const project = projectWithScope("trace-redaction-project")
  const secret = "OpenAI key is sk-abc123def456ghi789jkl"
  writeConfig(configPath, { capture: "on" })

  captureLifecycleTrace({
    cwd: project,
    sessionId: "s-secret",
    messages: [
      { role: "user", content: secret },
      { role: "assistant", content: "I will not store that token." },
    ],
  }, {
    adapter: "codex",
    lifecycleEvent: "session_end",
    configPath,
    traceRoot,
    now: new Date("2026-07-09T10:03:00.000Z"),
  })

  const files = traceJsonFiles(traceRoot)
  assert.equal(files.length, 1)
  const bytes = fs.readFileSync(files[0], "utf8")
  assert.equal(bytes.includes(secret), false)
  const record = JSON.parse(bytes) as TraceRecordV1
  assert.equal(record.redactedMessageCount, 1)
  assert.deepEqual(record.messages.map((message) => message.role), ["user", "assistant"])
  assert.equal(record.messages[0]?.content, REDACTED_SECRET_CONTENT)
  assert.equal(record.messages[1]?.content, "I will not store that token.")
})

test("excluded projects do not write trace files even when capture is enabled", () => {
  const dir = tempDir()
  const configPath = path.join(dir, "config.json")
  const traceRoot = path.join(dir, "traces")
  const project = projectWithScope("trace-excluded-project")
  writeConfig(configPath, { capture: "on", excludedProjects: ["trace-excluded-project"] })

  const record = captureLifecycleTrace({ cwd: project, sessionId: "s-excluded", messages }, {
    adapter: "pi",
    lifecycleEvent: "pre_compact",
    configPath,
    traceRoot,
    now: new Date("2026-07-09T10:04:00.000Z"),
  })

  assert.equal(record, undefined)
  assert.deepEqual(traceJsonFiles(traceRoot), [])
})

test("capture-time retention evicts old traces and prunes oldest files over the size cap", () => {
  const dir = tempDir()
  const configPath = path.join(dir, "config.json")
  const traceRoot = path.join(dir, "traces")
  const project = projectWithScope("trace-retention-project")
  const retainedDir = path.join(traceRoot, "retention-fixtures")
  fs.mkdirSync(retainedDir, { recursive: true })
  writeConfig(configPath, { capture: "on" })

  const now = new Date("2026-07-09T10:05:00.000Z")
  const tooOld = path.join(retainedDir, "too-old.json")
  fs.writeFileSync(tooOld, JSON.stringify({ old: true }), "utf8")
  const oldTime = new Date(now.getTime() - (TRACE_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000)
  fs.utimesSync(tooOld, oldTime, oldTime)

  const oversizedOldest = path.join(retainedDir, "oversized-oldest.json")
  fs.writeFileSync(oversizedOldest, "{}", "utf8")
  fs.truncateSync(oversizedOldest, TRACE_RETENTION_MAX_BYTES + 1)
  const withinAgeOlderThanCapture = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  fs.utimesSync(oversizedOldest, withinAgeOlderThanCapture, withinAgeOlderThanCapture)

  const record = captureLifecycleTrace({ cwd: project, sessionId: "s-retention", messages }, {
    adapter: "claude",
    lifecycleEvent: "session_end",
    configPath,
    traceRoot,
    now,
  })

  assert.equal(record?.event, "session-end")
  assert.equal(fs.existsSync(tooOld), false)
  assert.equal(fs.existsSync(oversizedOldest), false)
  const remaining = traceJsonFiles(traceRoot)
  assert.equal(remaining.length, 1)
  assert.match(path.basename(remaining[0]), /2026-07-09T10-05-00-000Z-session-end-[a-f0-9]{8}\.json/u)
  assert.equal(readTraceFile(traceRoot).sessionId, "s-retention")
})

test("capture failures are fail-open when the trace root cannot be used as a directory", () => {
  const dir = tempDir()
  const configPath = path.join(dir, "config.json")
  const blockedTraceRoot = path.join(dir, "trace-root-is-a-file")
  const project = projectWithScope("trace-fail-open-project")
  writeConfig(configPath, { capture: "on" })
  fs.writeFileSync(blockedTraceRoot, "not a directory", "utf8")

  assert.doesNotThrow(() => {
    const record = captureLifecycleTrace({ cwd: project, sessionId: "s-fail-open", messages }, {
      adapter: "claude",
      lifecycleEvent: "session_end",
      configPath,
      traceRoot: blockedTraceRoot,
      now: new Date("2026-07-09T10:06:00.000Z"),
    })
    assert.equal(record, undefined)
  })

  assert.equal(fs.readFileSync(blockedTraceRoot, "utf8"), "not a directory")
})
