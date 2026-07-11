import { test } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { MemoryEngine, type LocalLearningEventInput, type MemoryRecord } from "@memory-lane/core"
import { tempDir } from "../../core/test/helpers.js"
import { createLearningEventSink, type LearningEventV1 } from "../src/learning-events.ts"
import {
  AGREEMENT_OBSERVATION_DAYS,
  CAPTURE_OUTCOME_DATASET_SCHEMA_VERSION,
  buildCaptureOutcomeDataset,
  requireCaptureOutcomeDatasetPaths,
  serializeCaptureOutcomeDataset,
  stableJson,
  writeCaptureOutcomeDataset,
} from "./capture-outcome-dataset-harness.ts"

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_AS_OF = "2026-08-09T00:00:00.000Z"
const PRIVATE_MEMORY_TEXT = "PRIVATE MEMORY TEXT must not be exported"
const PRIVATE_TRANSCRIPT_TEXT = "PRIVATE TRANSCRIPT TEXT must not be exported"
const PRIVATE_PROJECT_PATH = "/private/absolute/project/path"

type EventOverrides = Partial<LearningEventV1> & Pick<LearningEventV1, "eventType" | "occurredAt" | "suggestionId">

function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex")
}

function ref(label: string): string {
  return digest({ label })
}

function event(overrides: EventOverrides): LearningEventV1 {
  const decisionByType: Partial<Record<LearningEventV1["eventType"], NonNullable<LearningEventV1["decision"]>["type"]>> = {
    "suggestion-approved": "approve",
    "suggestion-rejected": "reject",
    "suggestion-deleted": "delete",
    "suggestion-superseded": "supersede",
    "suggestion-replaced": "replace",
    "suggestion-reactivated": "reactivate",
  }
  const decisionType = decisionByType[overrides.eventType]
  const body: LearningEventV1 = {
    schemaVersion: 1,
    eventId: "",
    eventType: overrides.eventType,
    occurredAt: overrides.occurredAt,
    suggestionId: overrides.suggestionId,
    suggestionType: "project_fact",
    subjectRef: ref(`subject:${overrides.suggestionId}`),
    projectRef: ref("project:fixture"),
    source: "agent-suggested",
    ...(overrides.eventType === "suggestion-created" ? { initialReviewState: "pending" as const } : {}),
    ...(decisionType ? {
      decision: {
        type: decisionType,
        actor: "cli" as const,
        reasonCode: decisionType === "approve" ? "approved" as const : decisionType === "reject" ? "rejected" as const : decisionType === "delete" ? "deleted" as const : decisionType === "supersede" ? "superseded" as const : decisionType === "replace" ? "replaced" as const : "reactivated" as const,
      },
    } : {}),
    ...overrides,
  }
  body.eventId = digest({ ...body, eventId: undefined })
  return body
}

function writeEvent(directory: string, fileName: string, value: unknown): string {
  fs.mkdirSync(directory, { recursive: true })
  const filePath = path.join(directory, fileName)
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8")
  return filePath
}

function writeEvents(directory: string, values: LearningEventV1[], reverseNames = false): void {
  values.forEach((value, index) => {
    const ordinal = reverseNames ? values.length - index : index + 1
    writeEvent(directory, `${String(ordinal).padStart(3, "0")}-${value.eventType}.json`, value)
  })
}

function snapshotFiles(paths: string[]): Map<string, Buffer> {
  return new Map(paths.map((filePath) => [filePath, fs.readFileSync(filePath)]))
}

function assertFilesUnchanged(snapshot: Map<string, Buffer>): void {
  for (const [filePath, bytes] of snapshot) assert.deepEqual(fs.readFileSync(filePath), bytes, filePath)
}

function isUnsupportedSymlinkError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return ["EPERM", "EACCES", "ENOTSUP", "ENOSYS", "EINVAL", "UNKNOWN"].includes(code ?? "")
}

function memory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "private-memory-id",
    text: PRIVATE_MEMORY_TEXT,
    category: "project",
    scope: { type: "project", key: "owner-project" },
    source: "agent-suggested",
    status: "pending",
    kind: "project_fact",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    project: { cwd: PRIVATE_PROJECT_PATH, key: "owner-project", root: PRIVATE_PROJECT_PATH },
    provenance: {
      adapter: "codex",
      lifecycleEvent: "turn_stop",
      sessionId: "private-session-id",
      turnId: "private-turn-id",
      transcriptPath: "/private/absolute/transcript.jsonl",
    },
    ...overrides,
  }
}

function writeCaptureConfig(filePath: string): void {
  fs.writeFileSync(filePath, JSON.stringify({ learning: { capture: "on" } }), "utf8")
}

function capture(
  traceRoot: string,
  configPath: string,
  input: LocalLearningEventInput,
  now: string,
): void {
  createLearningEventSink({ traceRoot, configPath, now: () => new Date(now) })(input)
}

function onlyEventDirectory(traceRoot: string): string {
  const ownerDirectories = fs.readdirSync(traceRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  assert.equal(ownerDirectories.length, 1)
  return path.join(traceRoot, ownerDirectories[0]!.name, "events")
}

// fallow-ignore-next-line complexity
test("identical content produces byte-identical privacy-bounded output with honest segmented outcomes", () => {
  const firstEvents = tempDir()
  const secondEvents = tempDir()
  const firstOutput = path.join(tempDir(), "capture-outcomes.json")
  const secondOutput = path.join(tempDir(), "capture-outcomes.json")
  const storePath = path.join(tempDir(), "memory.jsonl")
  const tracesDirectory = tempDir()

  const approvedId = ref("suggestion:approved-deleted")
  const rejectedId = ref("suggestion:rejected")
  const initialApprovedId = ref("suggestion:initial-approved")
  const unresolvedId = ref("suggestion:unresolved")
  const incompleteId = ref("suggestion:incomplete-retention")
  const approvedProvenance = digest({ adapter: "codex", lifecycleEvent: "turn_stop", sessionId: "private-session-id", turnId: "private-turn-id", toolName: undefined })
  const reasonDigest = ref("private-reason")
  const acceptedRecommendationId = ref("recommendation:accepted")
  const expiredRecommendationId = ref("recommendation:expired")
  const pendingRecommendationId = ref("recommendation:pending")
  const recommendationAction = { type: "update-kind" as const, value: "workflow_rule" as const }

  const values = [
    event({ eventType: "suggestion-created", occurredAt: "2026-07-01T00:00:00.000Z", suggestionId: approvedId, provenanceRef: approvedProvenance, triggerContextDigest: ref("private-trigger") }),
    event({ eventType: "suggestion-shown", occurredAt: "2026-07-01T12:00:00.000Z", suggestionId: approvedId, provenanceRef: approvedProvenance }),
    event({ eventType: "suggestion-approved", occurredAt: "2026-07-02T00:00:00.000Z", suggestionId: approvedId, provenanceRef: approvedProvenance, decision: { type: "approve", actor: "mcp", reasonCode: "approved", reasonDigest } }),
    event({ eventType: "suggestion-deleted", occurredAt: "2026-07-05T00:00:00.000Z", suggestionId: approvedId, provenanceRef: approvedProvenance, decision: { type: "delete", actor: "cli", reasonCode: "deleted" } }),
    event({ eventType: "suggestion-created", occurredAt: "2026-07-03T00:00:00.000Z", suggestionId: rejectedId, suggestionType: "preference", source: "user-suggested" }),
    event({ eventType: "suggestion-rejected", occurredAt: "2026-07-04T00:00:00.000Z", suggestionId: rejectedId, suggestionType: "preference", source: "user-suggested", decision: { type: "reject", actor: "manual", reasonCode: "rejected" } }),
    event({ eventType: "suggestion-created", occurredAt: "2026-07-05T00:00:00.000Z", suggestionId: initialApprovedId, suggestionType: "workflow_rule", source: "manual", initialReviewState: "approved" }),
    event({ eventType: "suggestion-created", occurredAt: "2026-07-06T00:00:00.000Z", suggestionId: unresolvedId, suggestionType: "correction", source: "session-summary" }),
    event({ eventType: "suggestion-approved", occurredAt: "2026-07-07T00:00:00.000Z", suggestionId: incompleteId, suggestionType: "procedure", source: "agent-suggested", decision: { type: "approve", actor: "lifecycle", reasonCode: "approved" } }),
    event({ eventType: "agreement-recommendation-shown", occurredAt: "2026-07-01T00:00:00.000Z", suggestionId: approvedId, recommendationId: acceptedRecommendationId, recommendedAction: recommendationAction, provenanceRef: approvedProvenance }),
    event({ eventType: "agreement-recommendation-shown", occurredAt: "2026-07-02T00:00:00.000Z", suggestionId: approvedId, recommendationId: acceptedRecommendationId, recommendedAction: recommendationAction, provenanceRef: ref("second-display") }),
    event({ eventType: "agreement-recommendation-accepted", occurredAt: "2026-07-03T00:00:00.000Z", suggestionId: approvedId, recommendationId: acceptedRecommendationId, recommendedAction: recommendationAction }),
    event({ eventType: "agreement-recommendation-shown", occurredAt: "2026-07-10T00:00:00.000Z", suggestionId: unresolvedId, suggestionType: "correction", source: "session-summary", recommendationId: expiredRecommendationId, recommendedAction: recommendationAction }),
    event({ eventType: "agreement-recommendation-shown", occurredAt: "2026-07-20T00:00:00.000Z", suggestionId: rejectedId, suggestionType: "preference", source: "user-suggested", recommendationId: pendingRecommendationId, recommendedAction: recommendationAction }),
  ]
  writeEvents(firstEvents, values)
  writeEvents(secondEvents, [...values].reverse(), true)

  fs.writeFileSync(storePath, JSON.stringify(memory({ id: "unrelated-private-id", status: "approved" })) + "\n", "utf8")
  writeEvent(tracesDirectory, "trace.json", {
    schemaVersion: 1,
    capturedAt: "2026-07-01T12:00:00.000Z",
    projectKey: "private-project-key",
    harness: "codex",
    event: "session-end",
    sessionId: "private-session-id",
    turnId: "private-turn-id",
    fidelity: "full-transcript",
    messages: [{ role: "user", content: PRIVATE_TRANSCRIPT_TEXT }],
    redactedMessageCount: 0,
    meta: {},
  })
  const sourcePaths = [
    ...fs.readdirSync(firstEvents).map((name) => path.join(firstEvents, name)),
    storePath,
    path.join(tracesDirectory, "trace.json"),
  ]
  const before = snapshotFiles(sourcePaths)

  const firstDataset = writeCaptureOutcomeDataset({ eventsDirectory: firstEvents, homeStorePath: storePath, tracesDirectory, asOf: DEFAULT_AS_OF, outputPath: firstOutput })
  const repeatedDataset = writeCaptureOutcomeDataset({ eventsDirectory: firstEvents, homeStorePath: storePath, tracesDirectory, asOf: DEFAULT_AS_OF, outputPath: firstOutput })
  const secondDataset = writeCaptureOutcomeDataset({ eventsDirectory: secondEvents, homeStorePath: storePath, tracesDirectory, asOf: DEFAULT_AS_OF, outputPath: secondOutput })
  const firstBytes = fs.readFileSync(firstOutput, "utf8")

  assert.deepEqual(firstDataset, repeatedDataset)
  assert.deepEqual(firstDataset, secondDataset)
  assert.equal(firstBytes, fs.readFileSync(secondOutput, "utf8"))
  assert.equal(firstBytes, serializeCaptureOutcomeDataset(firstDataset))
  assert.equal(firstBytes.endsWith("\n"), true)
  assert.equal(firstDataset.schemaVersion, CAPTURE_OUTCOME_DATASET_SCHEMA_VERSION)
  assert.equal(firstDataset.schemaVersion, 1)
  assert.match(firstDataset.datasetId, /^[a-f0-9]{64}$/u)
  assert.equal(firstDataset.generatedAsOf, DEFAULT_AS_OF)
  assert.equal(firstDataset.noData, false)
  assert.deepEqual(firstDataset.sourceMetadata.eventDateRange, { oldest: "2026-07-01T00:00:00.000Z", newest: "2026-07-20T00:00:00.000Z" })

  const bySuggestion = new Map(firstDataset.records.map((record) => [record.suggestionId, record]))
  const approved = bySuggestion.get(approvedId)!
  assert.deepEqual({
    currentObservableState: approved.currentObservableState,
    everApproved: approved.everApproved,
    approvedAt: approved.approvedAt,
    finalTerminalOutcome: approved.finalTerminalOutcome,
    finalTerminalAt: approved.finalTerminalAt,
    observedSurvivalMs: approved.observedSurvivalMs,
    rightCensored: approved.rightCensored,
    resolutionState: approved.resolutionState,
    decisionType: approved.decisionType,
    decisionActor: approved.decisionActor,
    reasonCode: approved.reasonCode,
  }, {
    currentObservableState: "deleted",
    everApproved: true,
    approvedAt: "2026-07-02T00:00:00.000Z",
    finalTerminalOutcome: "deleted",
    finalTerminalAt: "2026-07-05T00:00:00.000Z",
    observedSurvivalMs: 3 * DAY_MS,
    rightCensored: false,
    resolutionState: "resolved-approved",
    decisionType: "delete",
    decisionActor: "cli",
    reasonCode: "deleted",
  })
  assert.deepEqual(approved.transitionHistory.map(({ fromState, toState }) => [fromState, toState]), [["pending", "approved"], ["approved", "deleted"]])
  assert.equal(bySuggestion.get(rejectedId)?.resolutionState, "resolved-rejected")
  assert.equal(bySuggestion.get(initialApprovedId)?.resolutionState, "initial-approved")
  assert.equal(bySuggestion.get(initialApprovedId)?.rightCensored, true)
  assert.equal(bySuggestion.get(unresolvedId)?.resolutionState, "unresolved")
  assert.equal(bySuggestion.get(incompleteId)?.resolutionState, "incomplete-history")
  assert.equal(bySuggestion.get(incompleteId)?.incompleteHistory, true)

  assert.deepEqual(firstDataset.metrics.overall, {
    suggestionCount: 4,
    pendingSuggestionCount: 3,
    reviewedResolvedCount: 2,
    reviewedApprovedCount: 1,
    reviewedSuggestionApprovalRate: 0.5,
    unresolvedPendingCount: 1,
    unresolvedRate: 1 / 3,
    initialApprovedCount: 1,
    survival: { observedCount: 1, meanObservedMs: 3 * DAY_MS, rightCensoredCount: 1, incompleteCount: 1 },
  })
  assert.equal(firstDataset.metrics.bySource.manual.initialApprovedCount, 1)
  assert.equal(firstDataset.metrics.bySource["agent-suggested"].reviewedSuggestionApprovalRate, 1)
  assert.equal(firstDataset.metrics.bySource["user-suggested"].reviewedSuggestionApprovalRate, 0)
  assert.equal(firstDataset.metrics.bySuggestionType.preference.reviewedSuggestionApprovalRate, 0)
  assert.equal(firstDataset.metrics.byInitialReviewState.pending.reviewedSuggestionApprovalRate, 0.5)
  assert.equal(firstDataset.metrics.byInitialReviewState.approved.reviewedSuggestionApprovalRate, null)

  const agreements = new Map(firstDataset.agreementRecommendations.map((record) => [record.recommendationId, record]))
  assert.equal(agreements.get(acceptedRecommendationId)?.repeatedDisplayCount, 1)
  assert.equal(agreements.get(acceptedRecommendationId)?.resolutionState, "accepted")
  assert.equal(agreements.get(expiredRecommendationId)?.resolutionState, "expired-unacted")
  assert.equal(agreements.get(pendingRecommendationId)?.resolutionState, "unresolved")
  assert.deepEqual(firstDataset.metrics.agreements, {
    uniqueRecommendationCount: 3,
    resolvedObservationWindowCount: 2,
    acceptedCount: 1,
    observedActionRate: 0.5,
    unresolvedCount: 1,
    expiredUnactedCount: 1,
    incompleteHistoryCount: 0,
  })

  assert.equal(firstDataset.metrics.coverage.event.completeSuggestionRecordRatio, 4 / 5)
  assert.equal(firstDataset.metrics.coverage.stores?.observedCurrentRecordRatio, 0)
  assert.equal(firstDataset.metrics.coverage.traces?.matchedEvidenceRefRatio, 1)
  assert.deepEqual(firstDataset.records.map((record) => record.recordId), [...firstDataset.records.map((record) => record.recordId)].sort())
  assert.deepEqual(firstDataset.agreementRecommendations.map((record) => record.recordId), [...firstDataset.agreementRecommendations.map((record) => record.recordId)].sort())

  for (const forbidden of [PRIVATE_MEMORY_TEXT, PRIVATE_TRANSCRIPT_TEXT, PRIVATE_PROJECT_PATH, "private-memory-id", "private-session-id", "private-turn-id", "private-project-key", "private-reason"]) {
    assert.equal(firstBytes.includes(forbidden), false, forbidden)
  }
  assertFilesUnchanged(before)
})

test("empty eligible input emits noData with null ratios rather than NaN or invented history", () => {
  const eventsDirectory = tempDir()
  const dataset = buildCaptureOutcomeDataset({ eventsDirectory, asOf: DEFAULT_AS_OF })
  const bytes = serializeCaptureOutcomeDataset(dataset)

  assert.equal(dataset.noData, true)
  assert.deepEqual(dataset.records, [])
  assert.deepEqual(dataset.agreementRecommendations, [])
  assert.equal(dataset.metrics.overall.reviewedSuggestionApprovalRate, null)
  assert.equal(dataset.metrics.overall.unresolvedRate, null)
  assert.equal(dataset.metrics.overall.survival.meanObservedMs, null)
  assert.equal(dataset.metrics.agreements.observedActionRate, null)
  assert.equal(dataset.metrics.coverage.event.completeSuggestionRecordRatio, null)
  assert.equal(dataset.metrics.coverage.stores, null)
  assert.equal(dataset.metrics.coverage.traces, null)
  assert.equal(bytes.includes("NaN"), false)
})

test("canonical as-of and explicit runner paths reject aliases, ambiguity, and missing inputs without output residue", () => {
  assert.deepEqual(requireCaptureOutcomeDatasetPaths([
    "--",
    "--events=events",
    "--home-store", "home.jsonl",
    "--project-store=project.jsonl",
    "--traces", "traces",
    "--as-of", DEFAULT_AS_OF,
    "--out=dataset.json",
  ]), {
    eventsDirectory: "events",
    asOf: DEFAULT_AS_OF,
    outputPath: "dataset.json",
    homeStorePath: "home.jsonl",
    projectStorePath: "project.jsonl",
    tracesDirectory: "traces",
  })

  const invalidArguments = [
    { name: "missing events", argv: ["--as-of", DEFAULT_AS_OF, "--out", "dataset.json"], error: /requires explicit --events/u },
    { name: "unknown option", argv: ["--events", "events", "--as-of", DEFAULT_AS_OF, "--out", "dataset.json", "--wat", "x"], error: /Unknown option --wat/u },
    { name: "duplicate option", argv: ["--events", "events", "--events", "other", "--as-of", DEFAULT_AS_OF, "--out", "dataset.json"], error: /Duplicate option --events/u },
    { name: "positional input", argv: ["events", "--as-of", DEFAULT_AS_OF, "--out", "dataset.json"], error: /Unexpected positional argument events/u },
    { name: "empty value", argv: ["--events=", "--as-of", DEFAULT_AS_OF, "--out", "dataset.json"], error: /--events requires a value/u },
    { name: "noncanonical timezone", argv: ["--events", "events", "--as-of", "2026-08-09T00:00:00Z", "--out", "dataset.json"], error: /canonical ISO-8601/u },
    { name: "timezone alias", argv: ["--events", "events", "--as-of", "2026-08-09T01:00:00.000+01:00", "--out", "dataset.json"], error: /canonical ISO-8601/u },
  ]
  for (const item of invalidArguments) assert.throws(() => requireCaptureOutcomeDatasetPaths(item.argv), item.error, item.name)

  const eventsDirectory = tempDir()
  writeEvent(eventsDirectory, "future.json", event({ eventType: "suggestion-created", occurredAt: "2026-08-10T00:00:00.000Z", suggestionId: ref("future") }))
  assert.throws(
    () => buildCaptureOutcomeDataset({ eventsDirectory, asOf: DEFAULT_AS_OF }),
    /precedes newest selected event 2026-08-10T00:00:00.000Z/u,
  )

  const duplicateInputEvents = tempDir()
  const duplicateStore = path.join(tempDir(), "memory.jsonl")
  const duplicateOutput = path.join(tempDir(), "not-created", "dataset.json")
  fs.writeFileSync(duplicateStore, "", "utf8")
  const duplicateStoreBefore = snapshotFiles([duplicateStore])
  assert.throws(
    () => writeCaptureOutcomeDataset({
      eventsDirectory: duplicateInputEvents,
      homeStorePath: duplicateStore,
      projectStorePath: duplicateStore,
      asOf: DEFAULT_AS_OF,
      outputPath: duplicateOutput,
    }),
    /Selected memory stores resolve to the same input/u,
  )
  assert.equal(fs.existsSync(duplicateOutput), false)
  assertFilesUnchanged(duplicateStoreBefore)

  const missingRoot = path.join(tempDir(), "missing-events")
  const outputPath = path.join(tempDir(), "not-created", "dataset.json")
  assert.throws(
    () => writeCaptureOutcomeDataset({ eventsDirectory: missingRoot, asOf: DEFAULT_AS_OF, outputPath }),
    /ENOENT/u,
  )
  assert.equal(fs.existsSync(outputPath), false)
  assert.equal(fs.existsSync(path.dirname(outputPath)), false)
})

test("malformed, unsupported, duplicate, and ambiguous events fail deterministically without mutating inputs", () => {
  const suggestionId = ref("validation-suggestion")
  const created = event({ eventType: "suggestion-created", occurredAt: "2026-07-01T00:00:00.000Z", suggestionId })
  const cases: Array<{ name: string; files: Array<[string, unknown | string]>; error: RegExp }> = [
    { name: "malformed JSON", files: [["bad.json", "{not json"]], error: /Unable to parse event .*bad\.json/u },
    { name: "unsupported schema", files: [["bad.json", { ...created, schemaVersion: 2 }]], error: /unsupported event schemaVersion 2/u },
    { name: "unsupported field", files: [["bad.json", { ...created, memoryText: PRIVATE_MEMORY_TEXT }]], error: /unsupported field memoryText/u },
    { name: "content-mismatched identity", files: [["bad.json", { ...created, subjectRef: ref("tampered") }]], error: /content-mismatched eventId/u },
    { name: "duplicate event", files: [["a.json", created], ["b.json", created]], error: /Duplicate learning eventId/u },
    { name: "duplicate creation", files: [["a.json", created], ["b.json", event({ ...created, occurredAt: "2026-07-02T00:00:00.000Z", triggerContextDigest: ref("new-trigger") })]], error: /Duplicate suggestion-created event/u },
    { name: "ambiguous suggestion identity", files: [["a.json", created], ["b.json", event({ eventType: "suggestion-shown", occurredAt: "2026-07-02T00:00:00.000Z", suggestionId, subjectRef: ref("other-subject") })]], error: /Ambiguous identity for suggestionId/u },
    { name: "initial review state on non-creation", files: [["bad.json", event({ eventType: "suggestion-reactivated", occurredAt: "2026-07-02T00:00:00.000Z", suggestionId, initialReviewState: "approved" })]], error: /has initialReviewState on suggestion-reactivated/u },
    { name: "lifecycle event before retained creation", files: [
      ["a.json", event({ eventType: "suggestion-approved", occurredAt: "2026-06-30T00:00:00.000Z", suggestionId })],
      ["b.json", created],
    ], error: /suggestion-approved occurs before suggestion-created/u },
    { name: "ambiguous simultaneous transition", files: [
      ["a.json", created],
      ["b.json", event({ eventType: "suggestion-approved", occurredAt: "2026-07-02T00:00:00.000Z", suggestionId })],
      ["c.json", event({ eventType: "suggestion-rejected", occurredAt: "2026-07-02T00:00:00.000Z", suggestionId })],
    ], error: /Ambiguous simultaneous transitions/u },
  ]

  for (const item of cases) {
    const eventsDirectory = tempDir()
    const outputPath = path.join(tempDir(), "not-created", "dataset.json")
    const files = item.files.map(([name, value]) => {
      if (typeof value === "string") {
        const filePath = path.join(eventsDirectory, name)
        fs.writeFileSync(filePath, value, "utf8")
        return filePath
      }
      return writeEvent(eventsDirectory, name, value)
    })
    const before = snapshotFiles(files)

    assert.throws(
      () => writeCaptureOutcomeDataset({ eventsDirectory, asOf: DEFAULT_AS_OF, outputPath }),
      item.error,
      item.name,
    )
    assert.equal(fs.existsSync(outputPath), false, item.name)
    assert.equal(fs.existsSync(path.dirname(outputPath)), false, item.name)
    assertFilesUnchanged(before)
  }
})

test("path preflight rejects input and output symlink escapes and selected-input aliases", (t) => {
  const workspace = tempDir()
  const eventsDirectory = path.join(workspace, "events")
  const outside = path.join(workspace, "outside")
  fs.mkdirSync(eventsDirectory)
  fs.mkdirSync(outside)
  const selectedEvent = writeEvent(eventsDirectory, "event.json", event({ eventType: "suggestion-created", occurredAt: "2026-07-01T00:00:00.000Z", suggestionId: ref("path") }))
  const before = snapshotFiles([selectedEvent])

  const insideOutputs = [
    path.join(eventsDirectory, "dataset.json"),
    path.join(eventsDirectory, "nested", "dataset.json"),
    selectedEvent,
  ]
  for (const outputPath of insideOutputs) {
    assert.throws(
      () => writeCaptureOutcomeDataset({ eventsDirectory, asOf: DEFAULT_AS_OF, outputPath }),
      /--out must (?:resolve outside --events|not resolve to a selected input)/u,
      outputPath,
    )
  }

  const inputLink = path.join(workspace, "events-link")
  const outputParentLink = path.join(workspace, "output-link")
  const childLink = path.join(eventsDirectory, "linked.json")
  const outputLink = path.join(workspace, "output.json")
  try {
    fs.symlinkSync(eventsDirectory, inputLink, process.platform === "win32" ? "junction" : "dir")
    fs.symlinkSync(eventsDirectory, outputParentLink, process.platform === "win32" ? "junction" : "dir")
    fs.symlinkSync(selectedEvent, childLink, "file")
    fs.symlinkSync(path.join(outside, "real-output.json"), outputLink, "file")
  } catch (error) {
    if (isUnsupportedSymlinkError(error)) {
      t.skip(`symlinks are unsupported: ${(error as NodeJS.ErrnoException).code}`)
      return
    }
    throw error
  }

  assert.throws(
    () => writeCaptureOutcomeDataset({ eventsDirectory: inputLink, asOf: DEFAULT_AS_OF, outputPath: path.join(outside, "input-link.json") }),
    /--events must not be a symbolic link/u,
  )
  assert.throws(
    () => writeCaptureOutcomeDataset({ eventsDirectory, asOf: DEFAULT_AS_OF, outputPath: path.join(outputParentLink, "escaped.json") }),
    /--out must resolve outside --events/u,
  )
  assert.throws(
    () => writeCaptureOutcomeDataset({ eventsDirectory, asOf: DEFAULT_AS_OF, outputPath: outputLink }),
    /--out must not be a symbolic link/u,
  )
  assert.throws(
    () => writeCaptureOutcomeDataset({ eventsDirectory, asOf: DEFAULT_AS_OF, outputPath: path.join(outside, "child-link.json") }),
    /events entry .*linked\.json must be a regular non-symlink file/u,
  )
  assert.equal(fs.existsSync(path.join(eventsDirectory, "escaped.json")), false)
  assertFilesUnchanged(before)
})

test("captured suggestion approval survives source compaction and exports the reviewed outcome", () => {
  const workspace = tempDir()
  const traceRoot = path.join(workspace, "traces")
  const configPath = path.join(workspace, "config.json")
  const storePath = path.join(workspace, "memory.jsonl")
  const outputPath = path.join(workspace, "output", "dataset.json")
  writeCaptureConfig(configPath)
  const pending = memory()
  const approved = memory({ status: "approved", updatedAt: "2026-07-02T00:00:00.000Z" })

  capture(traceRoot, configPath, { eventType: "suggestion-created", memory: pending, actingProjectKey: "owner-project", triggerContext: PRIVATE_TRANSCRIPT_TEXT }, "2026-07-01T00:00:00.000Z")
  capture(traceRoot, configPath, { eventType: "suggestion-shown", memory: pending, actingProjectKey: "owner-project", actor: "cli" }, "2026-07-01T12:00:00.000Z")
  capture(traceRoot, configPath, { eventType: "suggestion-approved", memory: approved, previousMemory: pending, actingProjectKey: "owner-project", actor: "mcp", reason: PRIVATE_MEMORY_TEXT }, "2026-07-02T00:00:00.000Z")

  fs.writeFileSync(storePath, "", "utf8")
  const eventsDirectory = onlyEventDirectory(traceRoot)
  const eventPaths = fs.readdirSync(eventsDirectory).map((name) => path.join(eventsDirectory, name))
  const sourceBefore = snapshotFiles([...eventPaths, storePath])
  const dataset = writeCaptureOutcomeDataset({ eventsDirectory, projectStorePath: storePath, asOf: "2026-08-01T00:00:00.000Z", outputPath })

  assert.equal(dataset.records.length, 1)
  assert.deepEqual({
    state: dataset.records[0]!.currentObservableState,
    everApproved: dataset.records[0]!.everApproved,
    resolution: dataset.records[0]!.resolutionState,
    storeObserved: dataset.records[0]!.supportingEvidence.currentStoreRecordObserved,
    reviewedRate: dataset.metrics.overall.reviewedSuggestionApprovalRate,
  }, {
    state: "approved",
    everApproved: true,
    resolution: "resolved-approved",
    storeObserved: false,
    reviewedRate: 1,
  })
  assert.equal(fs.readFileSync(outputPath, "utf8").includes(PRIVATE_MEMORY_TEXT), false)
  assert.equal(fs.readFileSync(outputPath, "utf8").includes(PRIVATE_TRANSCRIPT_TEXT), false)
  assertFilesUnchanged(sourceBefore)
})

test("captured repeated agreement display has one denominator identity and one matching accepted action", () => {
  const workspace = tempDir()
  const traceRoot = path.join(workspace, "traces")
  const configPath = path.join(workspace, "config.json")
  const outputPath = path.join(workspace, "dataset.json")
  writeCaptureConfig(configPath)
  const subject = memory({ status: "approved", kind: "preference", updatedAt: "2026-07-01T00:00:00.000Z" })
  const updated = memory({ status: "approved", kind: "workflow_rule", updatedAt: "2026-07-03T00:00:00.000Z" })
  const shown: LocalLearningEventInput = {
    eventType: "agreement-recommendation-shown",
    memory: subject,
    actingProjectKey: "owner-project",
    actor: "cli",
    recommendedAction: "update-kind-workflow-rule",
  }

  capture(traceRoot, configPath, shown, "2026-07-01T00:00:00.000Z")
  capture(traceRoot, configPath, shown, "2026-07-01T00:00:00.000Z")
  capture(traceRoot, configPath, {
    eventType: "agreement-recommendation-accepted",
    memory: updated,
    previousMemory: subject,
    actingProjectKey: "owner-project",
    actor: "mcp",
    recommendedAction: "update-kind-workflow-rule",
  }, "2026-07-03T00:00:00.000Z")

  const eventsDirectory = onlyEventDirectory(traceRoot)
  assert.equal(fs.readdirSync(eventsDirectory).length, 3)
  const dataset = writeCaptureOutcomeDataset({ eventsDirectory, asOf: DEFAULT_AS_OF, outputPath })

  assert.equal(dataset.agreementRecommendations.length, 1)
  assert.equal(dataset.agreementRecommendations[0]!.resolutionState, "accepted")
  assert.equal(dataset.agreementRecommendations[0]!.repeatedDisplayCount, 1)
  assert.equal(dataset.metrics.agreements.uniqueRecommendationCount, 1)
  assert.equal(dataset.metrics.agreements.resolvedObservationWindowCount, 1)
  assert.equal(dataset.metrics.agreements.acceptedCount, 1)
  assert.equal(dataset.metrics.agreements.observedActionRate, 1)
})

test("shown agreement inactivity is unresolved before 30 days and expired-unacted at the boundary, never rejected or ignored", () => {
  const eventsDirectory = tempDir()
  const recommendationId = ref("boundary-recommendation")
  writeEvent(eventsDirectory, "shown.json", event({
    eventType: "agreement-recommendation-shown",
    occurredAt: "2026-07-01T00:00:00.000Z",
    suggestionId: ref("boundary-suggestion"),
    recommendationId,
    recommendedAction: { type: "update-kind", value: "workflow_rule" },
  }))

  const beforeBoundary = buildCaptureOutcomeDataset({ eventsDirectory, asOf: "2026-07-30T23:59:59.999Z" })
  const atBoundary = buildCaptureOutcomeDataset({ eventsDirectory, asOf: "2026-07-31T00:00:00.000Z" })

  assert.equal(AGREEMENT_OBSERVATION_DAYS, 30)
  assert.equal(beforeBoundary.agreementRecommendations[0]?.resolutionState, "unresolved")
  assert.equal(beforeBoundary.metrics.agreements.unresolvedCount, 1)
  assert.equal(beforeBoundary.metrics.agreements.resolvedObservationWindowCount, 0)
  assert.equal(beforeBoundary.metrics.agreements.observedActionRate, null)
  assert.equal(atBoundary.agreementRecommendations[0]?.resolutionState, "expired-unacted")
  assert.equal(atBoundary.metrics.agreements.expiredUnactedCount, 1)
  assert.equal(atBoundary.metrics.agreements.resolvedObservationWindowCount, 1)
  assert.equal(atBoundary.metrics.agreements.observedActionRate, 0)
  assert.equal(serializeCaptureOutcomeDataset(atBoundary).includes("ignored"), false)
  assert.equal(serializeCaptureOutcomeDataset(atBoundary).includes("rejected"), false)
})

test("engine replace exports linked replaced and superseded transitions emitted at the same timestamp", () => {
  const workspace = tempDir()
  const traceRoot = path.join(workspace, "traces")
  const configPath = path.join(workspace, "config.json")
  const memoryPath = path.join(workspace, "memory.jsonl")
  const outputPath = path.join(workspace, "dataset.json")
  writeCaptureConfig(configPath)
  const engine = new MemoryEngine({
    memoryPath,
    embeddingsPath: path.join(workspace, "embeddings.jsonl"),
    configPath,
    learningEventSink: createLearningEventSink({ configPath, traceRoot }),
    autoCompact: false,
  })
  const saved = engine.save({
    text: "Original approved replacement subject",
    status: "approved",
    scopeType: "global",
    source: "agent-suggested",
    kind: "project_fact",
  })
  assert.equal(saved.status, "saved")
  if (saved.status !== "saved") throw new Error("expected saved replacement fixture")

  const replacement = engine.replace([saved.memory.id], {
    text: "Approved replacement successor",
    status: "approved",
    kind: "workflow_rule",
    reason: "PRIVATE replacement reason",
    revisedBy: "mcp",
  })
  const eventsDirectory = onlyEventDirectory(traceRoot)
  const capturedEvents = fs.readdirSync(eventsDirectory).map((name) => JSON.parse(fs.readFileSync(path.join(eventsDirectory, name), "utf8")) as LearningEventV1)
  const oldSuggestionId = capturedEvents.find((captured) => captured.eventType === "suggestion-replaced")?.suggestionId
  assert.ok(oldSuggestionId)
  const linkedTerminals = capturedEvents.filter((captured) => captured.suggestionId === oldSuggestionId && ["suggestion-replaced", "suggestion-superseded"].includes(captured.eventType))
  assert.deepEqual(linkedTerminals.map((captured) => captured.eventType).sort(), ["suggestion-replaced", "suggestion-superseded"])
  assert.equal(new Set(linkedTerminals.map((captured) => captured.occurredAt)).size, 1)
  assert.equal(new Set(linkedTerminals.map((captured) => captured.relatedSuggestionId)).size, 1)

  const asOf = capturedEvents.map((captured) => captured.occurredAt).sort().at(-1)!
  const dataset = writeCaptureOutcomeDataset({ eventsDirectory, projectStorePath: memoryPath, asOf, outputPath })
  const replacedRecord = dataset.records.find((record) => record.suggestionId === oldSuggestionId)
  assert.ok(replacedRecord)
  assert.equal(replacedRecord.everApproved, true)
  assert.equal(replacedRecord.finalTerminalOutcome, "superseded")
  assert.equal(replacedRecord.currentObservableState, "superseded")
  assert.equal(replacedRecord.transitionHistory.some((transition) => transition.eventType === "suggestion-replaced"), true)
  assert.equal(replacedRecord.transitionHistory.some((transition) => transition.eventType === "suggestion-superseded"), true)
  assert.equal(dataset.records.some((record) => record.suggestionId !== oldSuggestionId && record.currentObservableState === replacement.successor.status), true)
})
