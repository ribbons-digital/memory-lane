import * as fs from "node:fs"
import * as path from "node:path"
import { createHash, randomBytes } from "node:crypto"

export const CAPTURE_OUTCOME_DATASET_SCHEMA_VERSION = 1
export const CAPTURE_OUTCOME_TRANSITION_LIMIT = 64
export const AGREEMENT_OBSERVATION_DAYS = 30
const AGREEMENT_OBSERVATION_MS = AGREEMENT_OBSERVATION_DAYS * 24 * 60 * 60 * 1000

const EVENT_TYPES = [
  "suggestion-created",
  "suggestion-shown",
  "suggestion-approved",
  "suggestion-rejected",
  "suggestion-deleted",
  "suggestion-superseded",
  "suggestion-replaced",
  "suggestion-reactivated",
  "agreement-recommendation-shown",
  "agreement-recommendation-accepted",
] as const
const SUGGESTION_TYPES = [
  "preference",
  "personal_context",
  "project_fact",
  "project_checkpoint",
  "workflow_rule",
  "decision",
  "correction",
  "procedure",
  "session_summary",
  "misc",
] as const
const SOURCES = ["manual", "user-suggested", "agent-suggested", "session-summary"] as const
const INITIAL_STATES = ["pending", "approved"] as const
const DECISION_TYPES = ["approve", "reject", "delete", "supersede", "replace", "reactivate"] as const
const DECISION_ACTORS = ["manual", "cli", "mcp", "lifecycle"] as const
const REASON_CODES = ["unspecified", "approved", "rejected", "deleted", "superseded", "replaced", "reactivated"] as const
const EVENT_TYPE_PRECEDENCE: Record<typeof EVENT_TYPES[number], number> = {
  "suggestion-created": 0,
  "suggestion-shown": 1,
  "suggestion-approved": 2,
  "suggestion-rejected": 2,
  "suggestion-deleted": 2,
  "suggestion-superseded": 2,
  "suggestion-replaced": 2,
  "suggestion-reactivated": 2,
  "agreement-recommendation-shown": 0,
  "agreement-recommendation-accepted": 1,
}
const HEX_DIGEST = /^[a-f0-9]{64}$/u

type EventType = typeof EVENT_TYPES[number]
type SuggestionType = typeof SUGGESTION_TYPES[number]
type SuggestionSource = typeof SOURCES[number]
type InitialReviewState = typeof INITIAL_STATES[number]
type DecisionType = typeof DECISION_TYPES[number]
type DecisionActor = typeof DECISION_ACTORS[number]
type CurrentObservableState = InitialReviewState | "rejected" | "deleted" | "superseded" | "unknown"
type TerminalOutcome = "deleted" | "rejected" | "superseded"

interface LearningDecisionV1 {
  type: DecisionType
  actor: DecisionActor
  reasonCode: typeof REASON_CODES[number]
  reasonDigest?: string
}

type RecommendedActionV1 =
  | { type: "update-kind"; value: "workflow_rule" }
  | { type: "replace" }
  | { type: "supersede" }

interface LearningEventV1 {
  schemaVersion: 1
  eventId: string
  eventType: EventType
  occurredAt: string
  occurrenceIndex?: number
  suggestionId: string
  suggestionType: SuggestionType
  subjectRef: string
  projectRef: string
  source?: SuggestionSource
  initialReviewState?: InitialReviewState
  provenanceRef?: string
  triggerContextDigest?: string
  recommendationId?: string
  recommendedAction?: RecommendedActionV1
  decision?: LearningDecisionV1
  relatedSuggestionId?: string
}

export interface CaptureOutcomeDatasetPaths {
  eventsDirectory: string
  asOf: string
  outputPath: string
  homeStorePath?: string
  projectStorePath?: string
  tracesDirectory?: string
}

export interface CaptureOutcomeTransition {
  eventId: string
  eventType: EventType
  occurredAt: string
  fromState: CurrentObservableState
  toState: CurrentObservableState
  decisionType: DecisionType | null
  actor: DecisionActor | null
  reasonCode: string | null
  reasonDigest: string | null
}

export interface CaptureOutcomeRecord {
  recordId: string
  suggestionId: string
  suggestionType: SuggestionType
  subjectRef: string
  projectRef: string
  source: SuggestionSource | null
  initialReviewState: InitialReviewState | null
  currentObservableState: CurrentObservableState
  everApproved: boolean
  approvedAt: string | null
  finalTerminalOutcome: TerminalOutcome | null
  finalTerminalAt: string | null
  observedSurvivalMs: number | null
  rightCensored: boolean
  resolutionState: "resolved-approved" | "resolved-rejected" | "unresolved" | "initial-approved" | "incomplete-history"
  incompleteHistory: boolean
  transitionHistory: CaptureOutcomeTransition[]
  omittedTransitionCount: number
  decisionType: DecisionType | null
  decisionActor: DecisionActor | null
  reasonCode: string | null
  reasonDigest: string | null
  provenanceRef: string | null
  triggerContextDigest: string | null
  supportingEvidence: {
    currentStoreRecordObserved: boolean | null
    matchingTraceObserved: boolean | null
  }
}

export interface AgreementOutcomeRecord {
  recordId: string
  recommendationId: string
  suggestionId: string
  suggestionType: SuggestionType
  subjectRef: string
  projectRef: string
  source: SuggestionSource | null
  shownAt: string | null
  acceptedAt: string | null
  recommendedAction: RecommendedActionV1
  resolutionState: "accepted" | "unresolved" | "expired-unacted" | "incomplete-history"
  repeatedDisplayCount: number
  observationWindowEndsAt: string | null
  provenanceRef: string | null
  matchingTraceObserved: boolean | null
}

export interface CaptureOutcomeMetricSet {
  suggestionCount: number
  pendingSuggestionCount: number
  reviewedResolvedCount: number
  reviewedApprovedCount: number
  reviewedSuggestionApprovalRate: number | null
  unresolvedPendingCount: number
  unresolvedRate: number | null
  initialApprovedCount: number
  survival: {
    observedCount: number
    meanObservedMs: number | null
    rightCensoredCount: number
    incompleteCount: number
  }
}

export interface CaptureOutcomeDataset {
  schemaVersion: 1
  datasetId: string
  generatedAsOf: string
  noData: boolean
  sourceMetadata: {
    eventFileCount: number
    selectedStoreCount: number
    selectedTraceFileCount: number | null
    eventDateRange: { oldest: string; newest: string } | null
    observability: {
      eventLedger: "schema-v1"
      currentStores: "supporting-incomplete" | "not-selected"
      traces: "supporting-redacted" | "not-selected"
      retentionMayCensorHistory: true
    }
  }
  records: CaptureOutcomeRecord[]
  agreementRecommendations: AgreementOutcomeRecord[]
  metrics: {
    overall: CaptureOutcomeMetricSet
    bySource: Record<string, CaptureOutcomeMetricSet>
    bySuggestionType: Record<string, CaptureOutcomeMetricSet>
    byInitialReviewState: Record<string, CaptureOutcomeMetricSet>
    agreements: {
      uniqueRecommendationCount: number
      resolvedObservationWindowCount: number
      acceptedCount: number
      observedActionRate: number | null
      unresolvedCount: number
      expiredUnactedCount: number
      incompleteHistoryCount: number
    }
    coverage: {
      event: {
        suggestionRecordCount: number
        completeSuggestionRecordCount: number
        completeSuggestionRecordRatio: number | null
      }
      stores: {
        eligibleSuggestionCount: number
        observedCurrentRecordCount: number
        observedCurrentRecordRatio: number | null
      } | null
      traces: {
        eligibleEvidenceRefCount: number
        matchedEvidenceRefCount: number
        matchedEvidenceRefRatio: number | null
      } | null
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stableValue(value[key])]))
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a canonical ISO-8601 timestamp`)
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO-8601 timestamp`)
  }
  return value
}

function requiredString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key]
  if (typeof value !== "string" || !value) throw new Error(`${label} has invalid ${key}`)
  return value
}

function optionalString(record: Record<string, unknown>, key: string, label: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== "string" || !value) throw new Error(`${label} has invalid ${key}`)
  return value
}

function knownString<T extends string>(record: Record<string, unknown>, key: string, allowed: readonly T[], label: string): T {
  const value = requiredString(record, key, label)
  if (!allowed.includes(value as T)) throw new Error(`${label} has invalid ${key}`)
  return value as T
}

function digestString(record: Record<string, unknown>, key: string, label: string, optional = false): string | undefined {
  const value = optional ? optionalString(record, key, label) : requiredString(record, key, label)
  if (value === undefined) return undefined
  if (!HEX_DIGEST.test(value)) throw new Error(`${label} has invalid ${key}`)
  return value
}

function parseDecision(value: unknown, label: string): LearningDecisionV1 | undefined {
  if (value === undefined) return undefined
  if (!isObject(value)) throw new Error(`${label} has invalid decision`)
  const allowedKeys: Record<string, true> = { type: true, actor: true, reasonCode: true, reasonDigest: true }
  const unknownKey = Object.keys(value).find((key) => !Object.hasOwn(allowedKeys, key))
  if (unknownKey) throw new Error(`${label} has unsupported decision field ${unknownKey}`)
  const type = knownString(value, "type", DECISION_TYPES, `${label} decision`)
  const actor = knownString(value, "actor", DECISION_ACTORS, `${label} decision`)
  const reasonCode = knownString(value, "reasonCode", REASON_CODES, `${label} decision`)
  const reasonDigest = digestString(value, "reasonDigest", `${label} decision`, true)
  return { type, actor, reasonCode, ...(reasonDigest ? { reasonDigest } : {}) }
}

function parseRecommendedAction(value: unknown, label: string): RecommendedActionV1 | undefined {
  if (value === undefined) return undefined
  if (!isObject(value) || Object.keys(value).some((key) => key !== "type" && key !== "value")) {
    throw new Error(`${label} has invalid recommendedAction`)
  }
  if (value.type === "update-kind" && value.value === "workflow_rule") return { type: "update-kind", value: "workflow_rule" }
  if (value.type === "replace" && value.value === undefined) return { type: "replace" }
  if (value.type === "supersede" && value.value === undefined) return { type: "supersede" }
  throw new Error(`${label} has invalid recommendedAction`)
}

function assertConditionalEventFields(event: LearningEventV1, label: string): void {
  const expectedDecision: Partial<Record<EventType, DecisionType>> = {
    "suggestion-approved": "approve",
    "suggestion-rejected": "reject",
    "suggestion-deleted": "delete",
    "suggestion-superseded": "supersede",
    "suggestion-replaced": "replace",
    "suggestion-reactivated": "reactivate",
  }
  const decisionType = expectedDecision[event.eventType]
  if (decisionType && event.decision?.type !== decisionType) throw new Error(`${label} requires decision.type ${decisionType}`)
  if (!decisionType && event.decision !== undefined) throw new Error(`${label} has ambiguous decision for ${event.eventType}`)
  if (event.eventType === "suggestion-created" && (!event.source || !event.initialReviewState)) {
    throw new Error(`${label} suggestion-created requires source and initialReviewState`)
  }
  if (event.eventType !== "suggestion-created" && event.initialReviewState !== undefined) {
    throw new Error(`${label} has initialReviewState on ${event.eventType}`)
  }
  const agreement = event.eventType.startsWith("agreement-recommendation-")
  if (agreement && (!event.recommendationId || !event.recommendedAction)) {
    throw new Error(`${label} ${event.eventType} requires recommendationId and recommendedAction`)
  }
  if (!agreement && (event.recommendationId || event.recommendedAction)) {
    throw new Error(`${label} has agreement fields on ${event.eventType}`)
  }
}

function parseEvent(filePath: string): LearningEventV1 {
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to parse event ${filePath}: ${message}`)
  }
  if (!isObject(parsed)) throw new Error(`${filePath} must contain an event object`)
  if (parsed.schemaVersion !== 1) throw new Error(`${filePath} uses unsupported event schemaVersion ${String(parsed.schemaVersion)}`)
  const allowedKeys: Record<string, true> = {
    schemaVersion: true, eventId: true, eventType: true, occurredAt: true, occurrenceIndex: true, suggestionId: true, suggestionType: true,
    subjectRef: true, projectRef: true, source: true, initialReviewState: true, provenanceRef: true, triggerContextDigest: true,
    recommendationId: true, recommendedAction: true, decision: true, relatedSuggestionId: true,
  }
  const unknownKey = Object.keys(parsed).find((key) => !Object.hasOwn(allowedKeys, key))
  if (unknownKey) throw new Error(`${filePath} has unsupported field ${unknownKey}`)
  const sourceValue = optionalString(parsed, "source", filePath)
  const initialValue = optionalString(parsed, "initialReviewState", filePath)
  if (sourceValue && !SOURCES.includes(sourceValue as SuggestionSource)) throw new Error(`${filePath} has invalid source`)
  if (initialValue && !INITIAL_STATES.includes(initialValue as InitialReviewState)) throw new Error(`${filePath} has invalid initialReviewState`)
  const occurrenceIndex = parsed.occurrenceIndex
  if (occurrenceIndex !== undefined && (!Number.isInteger(occurrenceIndex) || Number(occurrenceIndex) < 1)) {
    throw new Error(`${filePath} has invalid occurrenceIndex`)
  }
  const recommendedAction = parseRecommendedAction(parsed.recommendedAction, filePath)
  const eventDecision = parseDecision(parsed.decision, filePath)
  const event: LearningEventV1 = {
    schemaVersion: 1,
    eventId: digestString(parsed, "eventId", filePath)!,
    eventType: knownString(parsed, "eventType", EVENT_TYPES, filePath),
    occurredAt: canonicalTimestamp(parsed.occurredAt, `${filePath} occurredAt`),
    ...(occurrenceIndex === undefined ? {} : { occurrenceIndex: Number(occurrenceIndex) }),
    suggestionId: digestString(parsed, "suggestionId", filePath)!,
    suggestionType: knownString(parsed, "suggestionType", SUGGESTION_TYPES, filePath),
    subjectRef: digestString(parsed, "subjectRef", filePath)!,
    projectRef: digestString(parsed, "projectRef", filePath)!,
    ...(sourceValue ? { source: sourceValue as SuggestionSource } : {}),
    ...(initialValue ? { initialReviewState: initialValue as InitialReviewState } : {}),
    ...(digestString(parsed, "provenanceRef", filePath, true) ? { provenanceRef: String(parsed.provenanceRef) } : {}),
    ...(digestString(parsed, "triggerContextDigest", filePath, true) ? { triggerContextDigest: String(parsed.triggerContextDigest) } : {}),
    ...(digestString(parsed, "recommendationId", filePath, true) ? { recommendationId: String(parsed.recommendationId) } : {}),
    ...(recommendedAction ? { recommendedAction } : {}),
    ...(eventDecision ? { decision: eventDecision } : {}),
    ...(digestString(parsed, "relatedSuggestionId", filePath, true) ? { relatedSuggestionId: String(parsed.relatedSuggestionId) } : {}),
  }
  if (event.eventId !== digest({ ...event, eventId: undefined })) throw new Error(`${filePath} has content-mismatched eventId`)
  if (event.occurrenceIndex !== undefined && !event.eventType.endsWith("-shown")) {
    throw new Error(`${filePath} has occurrenceIndex on ${event.eventType}`)
  }
  assertConditionalEventFields(event, filePath)
  return event
}

function directJsonFiles(directory: string, label: string): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to read ${label} directory ${directory}: ${message}`)
  }
  return entries.filter((entry) => entry.name.endsWith(".json")).map((entry) => {
    const filePath = path.join(directory, entry.name)
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`${label} entry ${filePath} must be a regular non-symlink file`)
    return filePath
  }).sort()
}

function readEvents(eventsDirectory: string): { events: LearningEventV1[]; fileCount: number } {
  const files = directJsonFiles(eventsDirectory, "events")
  const events = files.map(parseEvent)
  const ids = new Set<string>()
  for (const event of events) {
    if (ids.has(event.eventId)) throw new Error(`Duplicate learning eventId ${event.eventId}`)
    ids.add(event.eventId)
  }
  events.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || EVENT_TYPE_PRECEDENCE[left.eventType] - EVENT_TYPE_PRECEDENCE[right.eventType] || left.eventId.localeCompare(right.eventId))
  return { events, fileCount: files.length }
}

function validateOptionalStringField(record: Record<string, unknown>, key: string, label: string): void {
  if (record[key] !== undefined && typeof record[key] !== "string") throw new Error(`${label} has invalid ${key}`)
}

function validateStoreRecord(parsed: Record<string, unknown>, label: string): string {
  const id = requiredString(parsed, "id", label)
  if (typeof parsed.text !== "string") throw new Error(`${label} has invalid text`)
  knownString(parsed, "status", ["pending", "approved", "rejected", "deleted"] as const, label)
  knownString(parsed, "category", ["preference", "personal", "project"] as const, label)
  knownString(parsed, "source", SOURCES, label)
  canonicalTimestamp(parsed.createdAt, `${label} createdAt`)
  canonicalTimestamp(parsed.updatedAt, `${label} updatedAt`)
  if (!isObject(parsed.scope)) throw new Error(`${label} has invalid scope`)
  const scopeType = knownString(parsed.scope, "type", ["global", "project"] as const, `${label} scope`)
  validateOptionalStringField(parsed.scope, "key", `${label} scope`)
  if (scopeType === "project" && !parsed.scope.key) throw new Error(`${label} project scope requires key`)
  if (parsed.kind !== undefined && (typeof parsed.kind !== "string" || !SUGGESTION_TYPES.includes(parsed.kind as SuggestionType))) throw new Error(`${label} has invalid kind`)
  if (parsed.project !== undefined) {
    if (!isObject(parsed.project)) throw new Error(`${label} has invalid project`)
    requiredString(parsed.project, "cwd", `${label} project`)
    validateOptionalStringField(parsed.project, "root", `${label} project`)
    validateOptionalStringField(parsed.project, "key", `${label} project`)
  }
  if (parsed.provenance !== undefined) {
    if (!isObject(parsed.provenance)) throw new Error(`${label} has invalid provenance`)
    requiredString(parsed.provenance, "adapter", `${label} provenance`)
    knownString(parsed.provenance, "lifecycleEvent", ["user_prompt", "turn_stop", "post_tool_use", "session_start", "session_end", "pre_compact"] as const, `${label} provenance`)
    for (const key of ["sessionId", "turnId", "toolName"]) validateOptionalStringField(parsed.provenance, key, `${label} provenance`)
  }
  if (parsed.revision !== undefined) {
    if (!isObject(parsed.revision)) throw new Error(`${label} has invalid revision`)
    canonicalTimestamp(parsed.revision.revisedAt, `${label} revision revisedAt`)
    knownString(parsed.revision, "revisedBy", ["manual", "cli", "mcp"] as const, `${label} revision`)
    validateOptionalStringField(parsed.revision, "supersededBy", `${label} revision`)
    validateOptionalStringField(parsed.revision, "reason", `${label} revision`)
    if (parsed.revision.supersedes !== undefined && (!Array.isArray(parsed.revision.supersedes) || parsed.revision.supersedes.some((value) => typeof value !== "string" || !value))) throw new Error(`${label} has invalid revision supersedes`)
  }
  if (parsed.freshness !== undefined) {
    if (!isObject(parsed.freshness)) throw new Error(`${label} has invalid freshness`)
    if (parsed.freshness.expiresAt !== undefined) canonicalTimestamp(parsed.freshness.expiresAt, `${label} freshness expiresAt`)
    if (parsed.freshness.capturedAt !== undefined) canonicalTimestamp(parsed.freshness.capturedAt, `${label} freshness capturedAt`)
    if (parsed.freshness.staleAfterDays !== undefined && (!Number.isInteger(parsed.freshness.staleAfterDays) || Number(parsed.freshness.staleAfterDays) <= 0)) throw new Error(`${label} has invalid freshness staleAfterDays`)
  }
  if (parsed.descriptor !== undefined) {
    if (!isObject(parsed.descriptor)) throw new Error(`${label} has invalid descriptor`)
    validateOptionalStringField(parsed.descriptor, "description", `${label} descriptor`)
    validateOptionalStringField(parsed.descriptor, "fetchHint", `${label} descriptor`)
    if (parsed.descriptor.keywords !== undefined && (!Array.isArray(parsed.descriptor.keywords) || parsed.descriptor.keywords.some((value) => typeof value !== "string"))) throw new Error(`${label} has invalid descriptor keywords`)
  }
  return id
}

function parseStore(storePath: string): Set<string> {
  let content: string
  try {
    content = fs.readFileSync(storePath, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to read store ${storePath}: ${message}`)
  }
  const ids = new Set<string>()
  for (const [index, line] of content.split("\n").entries()) {
    if (!line.trim()) continue
    let parsed: unknown
    try { parsed = JSON.parse(line) as unknown } catch { throw new Error(`${storePath} has malformed JSONL at line ${index + 1}`) }
    if (!isObject(parsed)) throw new Error(`${storePath} has invalid memory record at line ${index + 1}`)
    const id = validateStoreRecord(parsed, `${storePath} line ${index + 1}`)
    ids.add(digest({ suggestionId: id }))
    ids.add(digest({ memoryId: id }))
  }
  return ids
}

function validateTraceRecord(parsed: Record<string, unknown>, label: string): void {
  canonicalTimestamp(parsed.capturedAt, `${label} capturedAt`)
  requiredString(parsed, "projectKey", label)
  knownString(parsed, "harness", ["claude", "codex", "pi"] as const, label)
  knownString(parsed, "event", ["session-end", "pre-compact"] as const, label)
  knownString(parsed, "fidelity", ["full-transcript", "payload-messages", "last-turn-fallback"] as const, label)
  validateOptionalStringField(parsed, "sessionId", label)
  validateOptionalStringField(parsed, "turnId", label)
  if (!Array.isArray(parsed.messages)) throw new Error(`${label} has invalid messages`)
  for (const [index, message] of parsed.messages.entries()) {
    if (!isObject(message)) throw new Error(`${label} has invalid message ${index + 1}`)
    knownString(message, "role", ["user", "assistant", "tool"] as const, `${label} message ${index + 1}`)
    if (typeof message.content !== "string") throw new Error(`${label} has invalid message content ${index + 1}`)
    if (message.timestamp !== undefined) canonicalTimestamp(message.timestamp, `${label} message ${index + 1} timestamp`)
  }
  if (!Number.isInteger(parsed.redactedMessageCount) || Number(parsed.redactedMessageCount) < 0) throw new Error(`${label} has invalid redactedMessageCount`)
  if (!isObject(parsed.meta)) throw new Error(`${label} has invalid meta`)
  for (const key of ["model", "trigger", "reason"]) validateOptionalStringField(parsed.meta, key, `${label} meta`)
}

function traceEvidenceRefs(tracesDirectory: string): { refs: Set<string>; fileCount: number } {
  const files = directJsonFiles(tracesDirectory, "traces")
  const refs = new Set<string>()
  for (const filePath of files) {
    let parsed: unknown
    try { parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown } catch { throw new Error(`Unable to parse trace ${filePath}`) }
    if (!isObject(parsed) || parsed.schemaVersion !== 1) throw new Error(`${filePath} has invalid trace schemaVersion`)
    validateTraceRecord(parsed, filePath)
    const adapter = String(parsed.harness)
    const sessionId = typeof parsed.sessionId === "string" ? parsed.sessionId : undefined
    const turnId = typeof parsed.turnId === "string" ? parsed.turnId : undefined
    const lifecycleEvents = ["user_prompt", "turn_stop", "post_tool_use", "session_start", "session_end", "pre_compact"]
    for (const lifecycleEvent of lifecycleEvents) refs.add(digest({ adapter, lifecycleEvent, sessionId, turnId, toolName: undefined }))
  }
  return { refs, fileCount: files.length }
}

function validateSuggestionIdentity(events: LearningEventV1[]): void {
  const identities = new Map<string, Pick<LearningEventV1, "suggestionType" | "subjectRef" | "projectRef" | "source">>()
  const created = new Set<string>()
  const eventTimes = new Map<string, LearningEventV1>()
  const recommendations = new Map<string, Pick<LearningEventV1, "suggestionId" | "subjectRef" | "projectRef" | "recommendedAction">>()
  const priorSuggestionEvent = new Map<string, LearningEventV1>()
  for (const event of events) {
    if (event.eventType !== "agreement-recommendation-accepted") {
      const identity = identities.get(event.suggestionId)
      const candidate = { suggestionType: event.suggestionType, subjectRef: event.subjectRef, projectRef: event.projectRef, source: event.source }
      if (identity && stableJson(identity) !== stableJson(candidate)) throw new Error(`Ambiguous identity for suggestionId ${event.suggestionId}`)
      identities.set(event.suggestionId, candidate)
    }
    const changesSuggestionState = event.eventType.startsWith("suggestion-") && event.eventType !== "suggestion-shown"
    const timeKey = `${event.suggestionId}:${event.occurredAt}`
    const simultaneous = eventTimes.get(timeKey)
    if (changesSuggestionState && simultaneous) {
      const types = new Set([simultaneous.eventType, event.eventType])
      const isCompositeReplace = types.size === 2 && types.has("suggestion-replaced") && types.has("suggestion-superseded") &&
        simultaneous.relatedSuggestionId === event.relatedSuggestionId && simultaneous.decision?.actor === event.decision?.actor &&
        simultaneous.decision?.reasonDigest === event.decision?.reasonDigest
      if (!isCompositeReplace) throw new Error(`Ambiguous simultaneous transitions for suggestionId ${event.suggestionId}`)
    }
    if (changesSuggestionState && event.eventType !== "suggestion-created") eventTimes.set(timeKey, event)
    if (event.eventType.startsWith("suggestion-") && event.eventType !== "suggestion-created") {
      priorSuggestionEvent.set(event.suggestionId, priorSuggestionEvent.get(event.suggestionId) ?? event)
    }
    if (event.eventType === "suggestion-created") {
      if (created.has(event.suggestionId)) throw new Error(`Duplicate suggestion-created event for ${event.suggestionId}`)
      const prior = priorSuggestionEvent.get(event.suggestionId)
      if (prior) throw new Error(`Suggestion lifecycle event ${prior.eventType} occurs before suggestion-created for ${event.suggestionId}`)
      created.add(event.suggestionId)
    }
    if (event.recommendationId) {
      const recommendation = recommendations.get(event.recommendationId)
      const next = { suggestionId: event.suggestionId, subjectRef: event.subjectRef, projectRef: event.projectRef, recommendedAction: event.recommendedAction }
      if (recommendation && stableJson(recommendation) !== stableJson(next)) throw new Error(`Ambiguous recommendationId ${event.recommendationId}`)
      recommendations.set(event.recommendationId, next)
    }
  }
}

function stateAfter(event: LearningEventV1, current: CurrentObservableState): CurrentObservableState {
  switch (event.eventType) {
    case "suggestion-created": return event.initialReviewState!
    case "suggestion-approved": return "approved"
    case "suggestion-rejected": return "rejected"
    case "suggestion-deleted": return "deleted"
    case "suggestion-superseded":
    case "suggestion-replaced": return "superseded"
    case "suggestion-reactivated": return event.initialReviewState ?? "approved"
    default: return current
  }
}

function buildSuggestionRecord(
  suggestionEvents: LearningEventV1[],
  storeIds: Set<string> | null,
  traceRefs: Set<string> | null,
  asOfMs: number,
): CaptureOutcomeRecord {
  const first = suggestionEvents[0]!
  const creation = suggestionEvents.find((event) => event.eventType === "suggestion-created")
  if (suggestionEvents.some((event) => Date.parse(event.occurredAt) > asOfMs)) throw new Error(`Event ${first.suggestionId} occurs after --as-of`)
  let state: CurrentObservableState = creation?.initialReviewState ?? "unknown"
  const transitions: CaptureOutcomeTransition[] = []
  for (const event of suggestionEvents) {
    const next = stateAfter(event, state)
    if (next === state && !event.decision) continue
    transitions.push({
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      fromState: state,
      toState: next,
      decisionType: event.decision?.type ?? null,
      actor: event.decision?.actor ?? null,
      reasonCode: event.decision?.reasonCode ?? null,
      reasonDigest: event.decision?.reasonDigest ?? null,
    })
    state = next
  }
  const approvalEvents = suggestionEvents.filter((event) => event.eventType === "suggestion-approved" || event.eventType === "suggestion-reactivated")
  const initialApprovedAt = creation?.initialReviewState === "approved" ? creation.occurredAt : undefined
  const approvedAt = [initialApprovedAt, ...approvalEvents.map((event) => event.occurredAt)].filter((value): value is string => Boolean(value)).sort()[0] ?? null
  const latestApprovalAt = approvalEvents.at(-1)?.occurredAt ?? initialApprovedAt ?? null
  const activationCutoff = [...suggestionEvents].reverse().find((event) => event.eventType === "suggestion-approved" || event.eventType === "suggestion-reactivated" || event.eventType === "suggestion-created")?.occurredAt
  const terminalCandidates = suggestionEvents.filter((event) => (!activationCutoff || event.occurredAt >= activationCutoff) && ["suggestion-deleted", "suggestion-rejected", "suggestion-superseded", "suggestion-replaced"].includes(event.eventType))
  const terminalPrecedence: Array<{ eventTypes: EventType[]; outcome: TerminalOutcome }> = [
    { eventTypes: ["suggestion-deleted"], outcome: "deleted" },
    { eventTypes: ["suggestion-rejected"], outcome: "rejected" },
    { eventTypes: ["suggestion-superseded", "suggestion-replaced"], outcome: "superseded" },
  ]
  let terminalEvent: LearningEventV1 | undefined
  let terminalOutcome: TerminalOutcome | null = null
  for (const precedence of terminalPrecedence) {
    const matches = terminalCandidates.filter((event) => precedence.eventTypes.includes(event.eventType))
    if (matches.length) {
      terminalEvent = matches[matches.length - 1]
      terminalOutcome = precedence.outcome
      break
    }
  }
  const survivalTerminal = terminalOutcome === "deleted" || terminalOutcome === "superseded" ? terminalEvent : undefined
  const observedSurvivalMs = latestApprovalAt && survivalTerminal && survivalTerminal.occurredAt >= latestApprovalAt
    ? Date.parse(survivalTerminal.occurredAt) - Date.parse(latestApprovalAt)
    : null
  const pending = creation?.initialReviewState === "pending"
  const approvedReview = pending && approvalEvents.length > 0
  const rejectedReview = pending && suggestionEvents.some((event) => event.eventType === "suggestion-rejected") && !approvedReview
  const incompleteHistory = !creation
  const resolutionState: CaptureOutcomeRecord["resolutionState"] = incompleteHistory
    ? "incomplete-history"
    : creation.initialReviewState === "approved"
      ? "initial-approved"
      : approvedReview
        ? "resolved-approved"
        : rejectedReview
          ? "resolved-rejected"
          : "unresolved"
  const lastDecision = [...suggestionEvents].reverse().find((event) => event.decision)?.decision
  const provenanceRef = suggestionEvents.find((event) => event.provenanceRef)?.provenanceRef ?? null
  const triggerContextDigest = creation?.triggerContextDigest ?? null
  const visibleTransitions = transitions.slice(-CAPTURE_OUTCOME_TRANSITION_LIMIT)
  const recordBody = {
    suggestionId: first.suggestionId,
    suggestionType: first.suggestionType,
    subjectRef: first.subjectRef,
    projectRef: first.projectRef,
    source: creation?.source ?? first.source ?? null,
    initialReviewState: creation?.initialReviewState ?? null,
    currentObservableState: state,
    everApproved: Boolean(approvedAt),
    approvedAt,
    finalTerminalOutcome: terminalOutcome,
    finalTerminalAt: terminalEvent?.occurredAt ?? null,
    observedSurvivalMs,
    rightCensored: Boolean(approvedAt && !terminalEvent),
    resolutionState,
    incompleteHistory,
    transitionHistory: visibleTransitions,
    omittedTransitionCount: transitions.length - visibleTransitions.length,
    decisionType: lastDecision?.type ?? null,
    decisionActor: lastDecision?.actor ?? null,
    reasonCode: lastDecision?.reasonCode ?? null,
    reasonDigest: lastDecision?.reasonDigest ?? null,
    provenanceRef,
    triggerContextDigest,
    supportingEvidence: {
      currentStoreRecordObserved: storeIds ? storeIds.has(first.suggestionId) || storeIds.has(first.subjectRef) : null,
      matchingTraceObserved: traceRefs && provenanceRef ? traceRefs.has(provenanceRef) : traceRefs ? false : null,
    },
  }
  return { recordId: digest(recordBody), ...recordBody }
}

function buildAgreementRecords(events: LearningEventV1[], traceRefs: Set<string> | null, asOfMs: number): AgreementOutcomeRecord[] {
  const grouped = new Map<string, LearningEventV1[]>()
  for (const event of events.filter((candidate) => candidate.eventType.startsWith("agreement-recommendation-"))) {
    const group = grouped.get(event.recommendationId!) ?? []
    group.push(event)
    grouped.set(event.recommendationId!, group)
  }
  return [...grouped.entries()].map(([recommendationId, group]) => {
    const shown = group.filter((event) => event.eventType === "agreement-recommendation-shown")
    const firstShown = shown[0]
    const acceptedEvents = group.filter((event) => event.eventType === "agreement-recommendation-accepted")
    if (acceptedEvents.length > 1) throw new Error(`Duplicate accepted action for agreement recommendation ${recommendationId}`)
    const accepted = acceptedEvents[0]
    if (accepted && firstShown && accepted.occurredAt < firstShown.occurredAt) throw new Error(`Agreement recommendation ${recommendationId} was accepted before it was shown`)
    const anchor = firstShown ?? accepted!
    const windowEndsMs = firstShown ? Date.parse(firstShown.occurredAt) + AGREEMENT_OBSERVATION_MS : null
    const resolutionState: AgreementOutcomeRecord["resolutionState"] = !firstShown
      ? "incomplete-history"
      : accepted
        ? "accepted"
        : asOfMs >= windowEndsMs!
          ? "expired-unacted"
          : "unresolved"
    const provenanceRef = anchor.provenanceRef ?? null
    const body = {
      recommendationId,
      suggestionId: anchor.suggestionId,
      suggestionType: anchor.suggestionType,
      subjectRef: anchor.subjectRef,
      projectRef: anchor.projectRef,
      source: anchor.source ?? null,
      shownAt: firstShown?.occurredAt ?? null,
      acceptedAt: accepted?.occurredAt ?? null,
      recommendedAction: anchor.recommendedAction!,
      resolutionState,
      repeatedDisplayCount: Math.max(0, shown.length - 1),
      observationWindowEndsAt: windowEndsMs === null ? null : new Date(windowEndsMs).toISOString(),
      provenanceRef,
      matchingTraceObserved: traceRefs && provenanceRef ? traceRefs.has(provenanceRef) : traceRefs ? false : null,
    }
    return { recordId: digest(body), ...body }
  }).sort((left, right) => left.recordId.localeCompare(right.recordId))
}

function metricSet(records: CaptureOutcomeRecord[]): CaptureOutcomeMetricSet {
  const complete = records.filter((record) => !record.incompleteHistory)
  const pending = complete.filter((record) => record.initialReviewState === "pending")
  const reviewed = pending.filter((record) => record.resolutionState === "resolved-approved" || record.resolutionState === "resolved-rejected")
  const approved = reviewed.filter((record) => record.resolutionState === "resolved-approved")
  const unresolved = pending.filter((record) => record.resolutionState === "unresolved")
  const observedSurvival = complete.map((record) => record.observedSurvivalMs).filter((value): value is number => value !== null)
  return {
    suggestionCount: complete.length,
    pendingSuggestionCount: pending.length,
    reviewedResolvedCount: reviewed.length,
    reviewedApprovedCount: approved.length,
    reviewedSuggestionApprovalRate: ratio(approved.length, reviewed.length),
    unresolvedPendingCount: unresolved.length,
    unresolvedRate: ratio(unresolved.length, pending.length),
    initialApprovedCount: complete.filter((record) => record.initialReviewState === "approved").length,
    survival: {
      observedCount: observedSurvival.length,
      meanObservedMs: observedSurvival.length ? observedSurvival.reduce((sum, value) => sum + value, 0) / observedSurvival.length : null,
      rightCensoredCount: complete.filter((record) => record.rightCensored).length,
      incompleteCount: records.filter((record) => record.incompleteHistory).length,
    },
  }
}

function segmented(records: CaptureOutcomeRecord[], key: "source" | "suggestionType" | "initialReviewState"): Record<string, CaptureOutcomeMetricSet> {
  const values = [...new Set(records.flatMap((record) => record[key] === null ? [] : [record[key]]))].sort()
  return Object.fromEntries(values.map((value) => [value, metricSet(records.filter((record) => record[key] === value))]))
}

export function buildCaptureOutcomeDataset(paths: Omit<CaptureOutcomeDatasetPaths, "outputPath">): CaptureOutcomeDataset {
  const asOf = canonicalTimestamp(paths.asOf, "--as-of")
  const asOfMs = Date.parse(asOf)
  const prepared = readEvents(paths.eventsDirectory)
  validateSuggestionIdentity(prepared.events)
  const newestEvent = prepared.events.at(-1)
  if (newestEvent && Date.parse(newestEvent.occurredAt) > asOfMs) throw new Error(`--as-of ${asOf} precedes newest selected event ${newestEvent.occurredAt}`)
  const storePaths = [paths.homeStorePath, paths.projectStorePath].filter((value): value is string => Boolean(value))
  if (new Set(storePaths.map((value) => fs.realpathSync(value))).size !== storePaths.length) throw new Error("Selected memory stores resolve to the same input")
  const storeIds = storePaths.length ? new Set(storePaths.flatMap((storePath) => [...parseStore(storePath)])) : null
  const traceEvidence = paths.tracesDirectory ? traceEvidenceRefs(paths.tracesDirectory) : null
  const bySuggestion = new Map<string, LearningEventV1[]>()
  for (const event of prepared.events.filter((candidate) => !candidate.eventType.startsWith("agreement-recommendation-"))) {
    const group = bySuggestion.get(event.suggestionId) ?? []
    group.push(event)
    bySuggestion.set(event.suggestionId, group)
  }
  const records = [...bySuggestion.values()].map((events) => buildSuggestionRecord(events, storeIds, traceEvidence?.refs ?? null, asOfMs)).sort((left, right) => left.recordId.localeCompare(right.recordId))
  const agreementRecommendations = buildAgreementRecords(prepared.events, traceEvidence?.refs ?? null, asOfMs)
  const completeAgreements = agreementRecommendations.filter((record) => record.resolutionState !== "incomplete-history")
  const agreementsResolved = completeAgreements.filter((record) => record.resolutionState !== "unresolved")
  const agreementsAccepted = completeAgreements.filter((record) => record.resolutionState === "accepted")
  const completeRecords = records.filter((record) => !record.incompleteHistory)
  const traceEligible = [...records.map((record) => record.provenanceRef), ...agreementRecommendations.map((record) => record.provenanceRef)].filter((value): value is string => value !== null)
  const traceMatched = [...records.filter((record) => record.supportingEvidence.matchingTraceObserved).map((record) => record.provenanceRef!), ...agreementRecommendations.filter((record) => record.matchingTraceObserved).map((record) => record.provenanceRef!)]
  const eventDates = prepared.events.map((event) => event.occurredAt).sort()
  const withoutId = {
    schemaVersion: CAPTURE_OUTCOME_DATASET_SCHEMA_VERSION as 1,
    generatedAsOf: asOf,
    noData: records.length === 0 && agreementRecommendations.length === 0,
    sourceMetadata: {
      eventFileCount: prepared.fileCount,
      selectedStoreCount: storePaths.length,
      selectedTraceFileCount: traceEvidence?.fileCount ?? null,
      eventDateRange: eventDates.length ? { oldest: eventDates[0]!, newest: eventDates[eventDates.length - 1]! } : null,
      observability: {
        eventLedger: "schema-v1" as const,
        currentStores: storePaths.length ? "supporting-incomplete" as const : "not-selected" as const,
        traces: traceEvidence ? "supporting-redacted" as const : "not-selected" as const,
        retentionMayCensorHistory: true as const,
      },
    },
    records,
    agreementRecommendations,
    metrics: {
      overall: metricSet(records),
      bySource: segmented(records, "source"),
      bySuggestionType: segmented(records, "suggestionType"),
      byInitialReviewState: segmented(records, "initialReviewState"),
      agreements: {
        uniqueRecommendationCount: completeAgreements.length,
        resolvedObservationWindowCount: agreementsResolved.length,
        acceptedCount: agreementsAccepted.length,
        observedActionRate: ratio(agreementsAccepted.length, agreementsResolved.length),
        unresolvedCount: agreementRecommendations.filter((record) => record.resolutionState === "unresolved").length,
        expiredUnactedCount: agreementRecommendations.filter((record) => record.resolutionState === "expired-unacted").length,
        incompleteHistoryCount: agreementRecommendations.length - completeAgreements.length,
      },
      coverage: {
        event: {
          suggestionRecordCount: records.length,
          completeSuggestionRecordCount: completeRecords.length,
          completeSuggestionRecordRatio: ratio(completeRecords.length, records.length),
        },
        stores: storeIds ? {
          eligibleSuggestionCount: records.length,
          observedCurrentRecordCount: records.filter((record) => record.supportingEvidence.currentStoreRecordObserved).length,
          observedCurrentRecordRatio: ratio(records.filter((record) => record.supportingEvidence.currentStoreRecordObserved).length, records.length),
        } : null,
        traces: traceEvidence ? {
          eligibleEvidenceRefCount: traceEligible.length,
          matchedEvidenceRefCount: traceMatched.length,
          matchedEvidenceRefRatio: ratio(traceMatched.length, traceEligible.length),
        } : null,
      },
    },
  }
  return { ...withoutId, datasetId: digest(withoutId) }
}

export function serializeCaptureOutcomeDataset(dataset: CaptureOutcomeDataset): string {
  return JSON.stringify(stableValue(dataset), null, 2) + "\n"
}

function realPathWithMissingTail(targetPath: string): string {
  let existingPath = path.resolve(targetPath)
  const missingSegments: string[] = []
  while (!fs.existsSync(existingPath)) {
    const parent = path.dirname(existingPath)
    if (parent === existingPath) break
    missingSegments.unshift(path.basename(existingPath))
    existingPath = parent
  }
  return path.join(fs.realpathSync(existingPath), ...missingSegments)
}

function isWithin(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function assertRegularInput(inputPath: string, label: string, directory: boolean): string {
  const stat = fs.lstatSync(inputPath)
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`)
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error(`${label} must be ${directory ? "a directory" : "a regular file"}`)
  return fs.realpathSync(inputPath)
}

function assertSafePaths(paths: CaptureOutcomeDatasetPaths): string {
  const eventsReal = assertRegularInput(paths.eventsDirectory, "--events", true)
  const tracesReal = paths.tracesDirectory ? assertRegularInput(paths.tracesDirectory, "--traces", true) : undefined
  const storeReals = [
    paths.homeStorePath ? assertRegularInput(paths.homeStorePath, "--home-store", false) : undefined,
    paths.projectStorePath ? assertRegularInput(paths.projectStorePath, "--project-store", false) : undefined,
  ].filter((value): value is string => Boolean(value))
  const outputParentReal = realPathWithMissingTail(path.dirname(paths.outputPath))
  const outputReal = path.join(outputParentReal, path.basename(paths.outputPath))
  let outputStat: fs.Stats | undefined
  try { outputStat = fs.lstatSync(paths.outputPath) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  if (outputStat?.isSymbolicLink()) throw new Error("--out must not be a symbolic link")
  if (isWithin(eventsReal, outputReal)) throw new Error("--out must resolve outside --events")
  if (tracesReal && isWithin(tracesReal, outputReal)) throw new Error("--out must resolve outside --traces")
  const inputFiles = [...storeReals, ...directJsonFiles(eventsReal, "events").map((file) => fs.realpathSync(file)), ...(tracesReal ? directJsonFiles(tracesReal, "traces").map((file) => fs.realpathSync(file)) : [])]
  if (inputFiles.includes(fs.existsSync(outputReal) ? fs.realpathSync(outputReal) : outputReal)) throw new Error("--out must not resolve to a selected input")
  return outputReal
}

export function writeCaptureOutcomeDataset(paths: CaptureOutcomeDatasetPaths): CaptureOutcomeDataset {
  const outputReal = assertSafePaths(paths)
  const dataset = buildCaptureOutcomeDataset(paths)
  const serialized = serializeCaptureOutcomeDataset(dataset)
  const outputDirectory = path.dirname(outputReal)
  fs.mkdirSync(outputDirectory, { recursive: true })
  const temporaryPath = path.join(outputDirectory, `.${path.basename(outputReal)}.${process.pid}-${randomBytes(8).toString("hex")}.tmp`)
  let fileDescriptor: number | undefined
  try {
    fileDescriptor = fs.openSync(temporaryPath, "wx", 0o600)
    fs.writeFileSync(fileDescriptor, serialized, "utf8")
    fs.fsyncSync(fileDescriptor)
    fs.closeSync(fileDescriptor)
    fileDescriptor = undefined
    fs.renameSync(temporaryPath, outputReal)
  } catch (error) {
    if (fileDescriptor !== undefined) {
      try { fs.closeSync(fileDescriptor) } catch { /* best effort */ }
    }
    try { fs.unlinkSync(temporaryPath) } catch { /* best effort */ }
    throw error
  }
  return dataset
}

function requireFlagValue(value: string | undefined, flag: string): string {
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`)
  return value
}

export function requireCaptureOutcomeDatasetPaths(argv: readonly string[]): CaptureOutcomeDatasetPaths {
  const allowed: Record<string, true> = { events: true, "home-store": true, "project-store": true, traces: true, "as-of": true, out: true }
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!
    if (argument === "--" && index === 0) continue
    if (!argument.startsWith("--")) throw new Error(`Unexpected positional argument ${argument}`)
    const equals = argument.indexOf("=")
    const name = argument.slice(2, equals === -1 ? undefined : equals)
    if (!Object.hasOwn(allowed, name)) throw new Error(`Unknown option --${name}`)
    if (values.has(name)) throw new Error(`Duplicate option --${name}`)
    const value = equals === -1 ? requireFlagValue(argv[++index], `--${name}`) : requireFlagValue(argument.slice(equals + 1), `--${name}`)
    values.set(name, value)
  }
  const eventsDirectory = values.get("events")
  const asOf = values.get("as-of")
  const outputPath = values.get("out")
  if (!eventsDirectory || !asOf || !outputPath) {
    throw new Error("Capture outcome dataset requires explicit --events <dir>, --as-of <ISO-8601>, and --out <file>; no default path is implied")
  }
  canonicalTimestamp(asOf, "--as-of")
  return {
    eventsDirectory,
    asOf,
    outputPath,
    ...(values.get("home-store") ? { homeStorePath: values.get("home-store")! } : {}),
    ...(values.get("project-store") ? { projectStorePath: values.get("project-store")! } : {}),
    ...(values.get("traces") ? { tracesDirectory: values.get("traces")! } : {}),
  }
}
