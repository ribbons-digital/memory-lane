import { test } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { tempDir } from "../../core/test/helpers.js"
import { captureLifecycleTrace, type TraceRecordV1 } from "../src/trace-capture.ts"
import {
  TRACE_DATASET_SCHEMA_VERSION,
  TRACE_DATASET_THIN_THRESHOLD,
  buildTraceDataset,
  requireTraceDatasetPaths,
  serializeTraceDataset,
  writeTraceDataset,
} from "./trace-dataset-converter-harness.ts"

function trace(overrides: Partial<TraceRecordV1> = {}): TraceRecordV1 {
  return {
    schemaVersion: 1,
    capturedAt: "2026-07-02T12:00:00.000Z",
    projectKey: "trace-dataset-project",
    harness: "claude",
    event: "session-end",
    sessionId: "session-default",
    fidelity: "payload-messages",
    messages: [
      { role: "user", content: "What changed in the release?" },
      { role: "assistant", content: "The release added trace conversion." },
    ],
    redactedMessageCount: 0,
    meta: {},
    ...overrides,
  }
}

function writeTrace(directory: string, fileName: string, record: unknown, pretty = true): void {
  fs.mkdirSync(directory, { recursive: true })
  const serialized = pretty ? JSON.stringify(record, null, 2) + "\n" : JSON.stringify(record)
  fs.writeFileSync(path.join(directory, fileName), serialized, "utf8")
}

function writeConfig(configPath: string): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify({ learning: { capture: "on" } }, null, 2) + "\n", "utf8")
}

function projectWithScope(projectKey: string): string {
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: projectKey }), "utf8")
  return project
}

test("conversion is byte-stable, content-ordered, and reports fidelity and trace quality metadata", () => {
  const firstDirectory = tempDir()
  const secondDirectory = tempDir()
  const firstOutput = path.join(tempDir(), "trace-dataset.json")
  const secondOutput = path.join(tempDir(), "trace-dataset.json")

  const fullTranscript = trace({
    capturedAt: "2026-07-03T09:00:00.000Z",
    sessionId: "session-full",
    fidelity: "full-transcript",
    messages: [
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "  Which release is current?  " },
      { role: "assistant", content: "The July release is current." },
      { role: "user", content: "   " },
    ],
  })
  const payloadMessages = trace({
    capturedAt: "2026-07-01T09:00:00.000Z",
    harness: "codex",
    sessionId: "session-payload",
    fidelity: "payload-messages",
    messages: [
      { role: "user", content: "Where is the migration guide?" },
      { role: "assistant", content: "It is in the docs directory." },
    ],
  })
  const lastTurnFallback = trace({
    capturedAt: "2026-07-02T09:00:00.000Z",
    harness: "pi",
    event: "pre-compact",
    sessionId: "session-fallback",
    fidelity: "last-turn-fallback",
    messages: [
      { role: "tool", content: "Previous context was compacted." },
      { role: "user", content: "What should I do next?" },
    ],
  })
  const noUserMessage = trace({
    capturedAt: "2020-01-01T00:00:00.000Z",
    sessionId: "session-unusable",
    messages: [
      { role: "assistant", content: "No user question was captured." },
      { role: "tool", content: "capture complete" },
    ],
  })

  const records = [fullTranscript, payloadMessages, lastTurnFallback, noUserMessage]
  const firstNames = ["a-full.json", "b-payload.json", "c-fallback.json", "d-unusable.json"]
  const secondNames = ["z-full.json", "y-payload.json", "x-fallback.json", "w-unusable.json"]
  records.forEach((record, index) => {
    writeTrace(firstDirectory, firstNames[index]!, record)
    writeTrace(secondDirectory, secondNames[index]!, record)
  })
  writeTrace(firstDirectory, "e-full-duplicate.json", fullTranscript, false)
  writeTrace(secondDirectory, "v-full-duplicate.json", fullTranscript, false)

  const firstDataset = writeTraceDataset(firstDirectory, firstOutput)
  const firstBytes = fs.readFileSync(firstOutput, "utf8")
  const unchangedDataset = writeTraceDataset(firstDirectory, firstOutput)
  const unchangedBytes = fs.readFileSync(firstOutput, "utf8")
  const secondDataset = writeTraceDataset(secondDirectory, secondOutput)
  const secondBytes = fs.readFileSync(secondOutput, "utf8")

  assert.equal(firstBytes, unchangedBytes)
  assert.equal(firstBytes, secondBytes)
  assert.deepEqual(firstDataset, unchangedDataset)
  assert.deepEqual(firstDataset, secondDataset)
  assert.equal(firstDataset.schemaVersion, TRACE_DATASET_SCHEMA_VERSION)
  assert.equal(firstDataset.schemaVersion, 1)
  assert.deepEqual(firstDataset.metadata, {
    sourceTraceCount: 5,
    sessionCount: 3,
    unusableTraceCount: 1,
    duplicateTraceCount: 1,
    dateRange: {
      oldest: "2026-07-01T09:00:00.000Z",
      newest: "2026-07-03T09:00:00.000Z",
    },
    fidelityMix: {
      "full-transcript": 1,
      "payload-messages": 1,
      "last-turn-fallback": 1,
    },
    thinData: true,
    thinDataThreshold: TRACE_DATASET_THIN_THRESHOLD,
  })
  assert.equal(TRACE_DATASET_THIN_THRESHOLD, 50)

  const recordsByQuestion = new Map(firstDataset.records.map((record) => [record.question, record]))
  assert.deepEqual([...recordsByQuestion.keys()].sort(), [
    "Which release is current?",
    "What should I do next?",
    "Where is the migration guide?",
  ].sort())
  assert.equal(recordsByQuestion.get("Which release is current?")?.trace_fidelity, "full-transcript")
  assert.equal(recordsByQuestion.get("Where is the migration guide?")?.trace_fidelity, "payload-messages")
  assert.equal(recordsByQuestion.get("What should I do next?")?.trace_fidelity, "last-turn-fallback")
  assert.deepEqual(
    recordsByQuestion.get("Which release is current?")?.haystack_sessions,
    [fullTranscript.messages.map(({ role, content }) => ({ role, content }))],
  )

  const questionIds = firstDataset.records.map((record) => record.question_id)
  assert.equal(new Set(questionIds).size, 3)
  assert.deepEqual(questionIds, [...questionIds].sort())
  assert.equal(serializeTraceDataset(firstDataset), firstBytes)
})

test("record IDs derive from trace content rather than filenames or question text alone", () => {
  const firstDirectory = tempDir()
  const secondDirectory = tempDir()
  const firstAnswer = trace({
    sessionId: "shared-session",
    messages: [
      { role: "user", content: "What is the rollout status?" },
      { role: "assistant", content: "The rollout is at ten percent." },
    ],
  })
  const revisedAnswer = trace({
    sessionId: "shared-session",
    messages: [
      { role: "user", content: "What is the rollout status?" },
      { role: "assistant", content: "The rollout is at fifty percent." },
    ],
  })

  writeTrace(firstDirectory, "a-first.json", firstAnswer)
  writeTrace(firstDirectory, "b-revised.json", revisedAnswer)
  writeTrace(secondDirectory, "z-first.json", firstAnswer)
  writeTrace(secondDirectory, "y-revised.json", revisedAnswer)

  const firstDataset = buildTraceDataset(firstDirectory)
  const secondDataset = buildTraceDataset(secondDirectory)
  assert.deepEqual(firstDataset, secondDataset)

  const idByAnswer = (answer: string): string | undefined => firstDataset.records.find(
    (record) => record.haystack_sessions[0]?.[1]?.content === answer,
  )?.question_id
  const firstId = idByAnswer("The rollout is at ten percent.")
  const revisedId = idByAnswer("The rollout is at fifty percent.")
  assert.match(firstId ?? "", /^trace-question-[a-f0-9]{64}$/u)
  assert.match(revisedId ?? "", /^trace-question-[a-f0-9]{64}$/u)
  assert.notEqual(firstId, revisedId)
})

test("malformed JSON, invalid message timestamps, and unsupported trace schemas fail the whole conversion", () => {
  const malformedDirectory = tempDir()
  writeTrace(malformedDirectory, "valid.json", trace())
  fs.writeFileSync(path.join(malformedDirectory, "malformed.json"), "{not json", "utf8")

  assert.throws(
    () => buildTraceDataset(malformedDirectory),
    /Unable to parse trace .*malformed\.json/u,
  )

  const invalidTimestampCases = [
    { name: "empty timestamp", timestamp: "" },
    { name: "non-date timestamp", timestamp: "not-a-date" },
  ]
  for (const item of invalidTimestampCases) {
    const invalidTimestampDirectory = tempDir()
    writeTrace(invalidTimestampDirectory, "invalid-timestamp.json", trace({
      messages: [{ role: "user", content: "When was this captured?", timestamp: item.timestamp }],
    }))

    assert.throws(
      () => buildTraceDataset(invalidTimestampDirectory),
      /invalid message timestamp/u,
      item.name,
    )
  }

  const unsupportedDirectory = tempDir()
  writeTrace(unsupportedDirectory, "valid.json", trace())
  writeTrace(unsupportedDirectory, "unsupported.json", { ...trace(), schemaVersion: 2 })

  assert.throws(
    () => buildTraceDataset(unsupportedDirectory),
    /unsupported\.json uses unsupported trace schemaVersion 2/u,
  )
})

test("zero usable traces fail instead of emitting an empty dataset", () => {
  const tracesDirectory = tempDir()
  writeTrace(tracesDirectory, "assistant-only.json", trace({
    messages: [
      { role: "assistant", content: "There is no user message here." },
      { role: "tool", content: "capture complete" },
    ],
  }))

  assert.throws(
    () => buildTraceDataset(tracesDirectory),
    /Trace dataset converter found zero usable traces/u,
  )
})

test("writeTraceDataset leaves no output when conversion fails", () => {
  const tracesDirectory = tempDir()
  const outputDirectory = path.join(tempDir(), "not-created")
  const outputPath = path.join(outputDirectory, "trace-dataset.json")
  fs.writeFileSync(path.join(tracesDirectory, "malformed.json"), "[", "utf8")

  assert.throws(() => writeTraceDataset(tracesDirectory, outputPath), /Unable to parse trace/u)
  assert.equal(fs.existsSync(outputPath), false)
  assert.equal(fs.existsSync(outputDirectory), false)
})

test("writeTraceDataset rejects output paths inside the selected traces directory", () => {
  const tracesDirectory = tempDir()
  writeTrace(tracesDirectory, "valid.json", trace())

  const insideOutput = path.join(tracesDirectory, "trace-dataset.json")
  assert.throws(
    () => writeTraceDataset(tracesDirectory, insideOutput),
    /--out must resolve outside --traces/u,
  )
  assert.equal(fs.existsSync(insideOutput), false)

  const nestedOutput = path.join(tracesDirectory, "nested", "trace-dataset.json")
  assert.throws(
    () => writeTraceDataset(tracesDirectory, nestedOutput),
    /--out must resolve outside --traces/u,
  )
  assert.equal(fs.existsSync(nestedOutput), false)
  assert.equal(fs.existsSync(path.dirname(nestedOutput)), false)

  assert.throws(
    () => writeTraceDataset(tracesDirectory, path.join(tracesDirectory, "..dataset.json")),
    /--out must resolve outside --traces/u,
  )

  assert.throws(
    () => writeTraceDataset(tracesDirectory, tracesDirectory),
    /--out must resolve outside --traces/u,
  )
})

test("writeTraceDataset rejects a symlinked output parent that resolves inside the traces directory", (t) => {
  const workspace = tempDir()
  const tracesDirectory = path.join(workspace, "traces")
  const physicalOutputParent = path.join(tracesDirectory, "physical-output")
  const symlinkedOutputParent = path.join(workspace, "output-link")
  const outputPath = path.join(symlinkedOutputParent, "trace-dataset.json")
  writeTrace(tracesDirectory, "valid.json", trace())
  fs.mkdirSync(physicalOutputParent)

  try {
    fs.symlinkSync(physicalOutputParent, symlinkedOutputParent, process.platform === "win32" ? "junction" : "dir")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP" || code === "ENOSYS" || code === "EINVAL" || code === "UNKNOWN") {
      t.skip(`directory symlinks are unsupported: ${code}`)
      return
    }
    throw error
  }

  assert.throws(
    () => writeTraceDataset(tracesDirectory, outputPath),
    /--out must resolve outside --traces/u,
  )
  assert.equal(fs.existsSync(outputPath), false)
  assert.deepEqual(fs.readdirSync(physicalOutputParent), [])
})

test("a captured lifecycle trace converts into the local smoke dataset contract", () => {
  const workspace = tempDir()
  const configPath = path.join(workspace, "config.json")
  const traceRoot = path.join(workspace, "traces")
  const outputPath = path.join(workspace, "output", "trace-dataset.json")
  const project = projectWithScope("captured-trace-dataset-project")
  const capturedAt = "2026-07-04T10:30:00.000Z"
  const capturedMessages = [
    { role: "user" as const, content: "Which rollout step is next?" },
    { role: "assistant" as const, content: "The canary rollout is next." },
  ]
  writeConfig(configPath)

  const captured = captureLifecycleTrace({
    cwd: project,
    sessionId: "captured-session",
    messages: capturedMessages,
  }, {
    adapter: "claude",
    lifecycleEvent: "session_end",
    fidelity: "full-transcript",
    configPath,
    traceRoot,
    now: new Date(capturedAt),
  })
  assert.ok(captured)

  const projectTraceDirectories = fs.readdirSync(traceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(traceRoot, entry.name))
  assert.equal(projectTraceDirectories.length, 1)

  const writtenDataset = writeTraceDataset(projectTraceDirectories[0]!, outputPath)
  const emittedDataset = JSON.parse(fs.readFileSync(outputPath, "utf8")) as typeof writtenDataset
  assert.deepEqual(emittedDataset, writtenDataset)
  assert.equal(emittedDataset.schemaVersion, 1)
  assert.match(emittedDataset.dataset_id, /^memory-lane-trace-smoke-[a-f0-9]{64}$/u)
  assert.equal(emittedDataset.records.length, 1)

  const converted = emittedDataset.records[0]!
  assert.match(converted.question_id, /^trace-question-[a-f0-9]{64}$/u)
  const contentDigest = converted.question_id.slice("trace-question-".length)
  const expectedSessionId = `trace-session-${contentDigest}`
  assert.equal(converted.category, "single-session-user")
  assert.equal(converted.question, "Which rollout step is next?")
  assert.deepEqual(converted.answer_session_ids, [expectedSessionId])
  assert.deepEqual(converted.haystack_session_ids, [expectedSessionId])
  assert.deepEqual(converted.haystack_dates, [capturedAt])
  assert.deepEqual(converted.haystack_sessions, [[
    { role: "user", content: "Which rollout step is next?" },
    { role: "assistant", content: "The canary rollout is next." },
  ]])
  assert.equal(converted.trace_fidelity, "full-transcript")
})

test("converter paths require explicit traces and output flags without implied defaults", () => {
  assert.deepEqual(
    requireTraceDatasetPaths(["--traces", "project-traces", "--out", "dataset.json"]),
    { tracesDirectory: "project-traces", outputPath: "dataset.json" },
  )
  assert.deepEqual(
    requireTraceDatasetPaths(["--out", "other-dataset.json", "--traces=other-traces"]),
    { tracesDirectory: "other-traces", outputPath: "other-dataset.json" },
  )

  assert.throws(
    () => requireTraceDatasetPaths(["--out", "dataset.json"]),
    /requires explicit --traces <dir> and --out <file>; no default path is implied/u,
  )
  assert.throws(
    () => requireTraceDatasetPaths(["--traces", "project-traces"]),
    /requires explicit --traces <dir> and --out <file>; no default path is implied/u,
  )
  assert.throws(
    () => requireTraceDatasetPaths([]),
    /no default path is implied/u,
  )
  assert.throws(() => requireTraceDatasetPaths(["--traces", "--out", "dataset.json"]), /--traces requires a value/u)
  assert.throws(() => requireTraceDatasetPaths(["--traces=", "--out", "dataset.json"]), /--traces requires a value/u)
  assert.throws(() => requireTraceDatasetPaths(["--traces", "project-traces", "--out"]), /--out requires a value/u)
})
