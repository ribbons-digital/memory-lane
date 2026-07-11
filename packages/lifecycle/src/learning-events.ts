import * as fs from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { containsLikelySecret, loadConfig } from "@memory-lane/core"
import type {
  LocalLearningEventInput,
  LocalLearningEventSink,
  MemoryRecord,
  MemoryRevisionActor,
  MemorySource,
  SemanticMemoryConfig,
} from "@memory-lane/core"
import {
  enforceLocalLearningRetention,
  localLearningProjectHash,
  localLearningRoot,
} from "./trace-capture.js"

export const LEARNING_EVENT_SCHEMA_VERSION = 1
export const TRIGGER_CONTEXT_MAX_CHARS = 2048

export type LearningEventType = LocalLearningEventInput["eventType"]
export type LearningDecisionType = "approve" | "reject" | "delete" | "supersede" | "replace" | "reactivate"
export type LearningReasonCode = "unspecified" | "approved" | "rejected" | "deleted" | "superseded" | "replaced" | "reactivated"

export interface LearningEventV1 {
  schemaVersion: 1
  eventId: string
  eventType: LearningEventType
  occurredAt: string
  occurrenceIndex?: number
  suggestionId: string
  suggestionType: NonNullable<MemoryRecord["kind"]>
  subjectRef: string
  projectRef: string
  source?: MemorySource
  initialReviewState?: "pending" | "approved"
  provenanceRef?: string
  triggerContextDigest?: string
  recommendationId?: string
  recommendedAction?:
    | { type: "update-kind"; value: "workflow_rule" }
    | { type: "replace" }
    | { type: "supersede" }
  decision?: {
    type: LearningDecisionType
    actor: MemoryRevisionActor | "lifecycle"
    reasonCode: LearningReasonCode
    reasonDigest?: string
  }
  relatedSuggestionId?: string
}

export interface LearningEventCaptureOptions {
  /** Config path used to read opt-in learning.capture and excluded project keys. */
  configPath?: string
  env?: NodeJS.ProcessEnv
  traceRoot?: string
  now?: () => Date
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, stableValue(child)]))
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value)), "utf8").digest("hex")
}

function ownerProjectKey(memory: MemoryRecord): string | undefined {
  if (memory.scope.type !== "project") return undefined
  return memory.scope.key ?? memory.project?.key ?? memory.project?.root
}

function provenanceRef(memory: MemoryRecord): string | undefined {
  if (!memory.provenance) return undefined
  return digest({
    adapter: memory.provenance.adapter,
    lifecycleEvent: memory.provenance.lifecycleEvent,
    sessionId: memory.provenance.sessionId,
    turnId: memory.provenance.turnId,
    toolName: memory.provenance.toolName,
  })
}

function privateTextDigest(text: string | undefined): string | undefined {
  if (!text) return undefined
  const normalized = text.replace(/\s+/gu, " ").trim().slice(0, TRIGGER_CONTEXT_MAX_CHARS)
  if (!normalized) return undefined
  return digest(containsLikelySecret(normalized) ? "[redacted:secret]" : normalized)
}

function triggerContextDigest(triggerContext: string | undefined): string | undefined {
  return privateTextDigest(triggerContext)
}

function reasonDigest(reason: string | undefined): string | undefined {
  return privateTextDigest(reason)
}

function decision(eventType: LearningEventType, actor: LocalLearningEventInput["actor"], reason: string | undefined): LearningEventV1["decision"] {
  const values: Partial<Record<LearningEventType, [LearningDecisionType, LearningReasonCode]>> = {
    "suggestion-approved": ["approve", "approved"],
    "suggestion-rejected": ["reject", "rejected"],
    "suggestion-deleted": ["delete", "deleted"],
    "suggestion-superseded": ["supersede", "superseded"],
    "suggestion-replaced": ["replace", "replaced"],
    "suggestion-reactivated": ["reactivate", "reactivated"],
  }
  const value = values[eventType]
  if (!value) return undefined
  const redactedReasonDigest = reasonDigest(reason)
  return {
    type: value[0],
    actor: actor ?? "manual",
    reasonCode: value[1],
    ...(redactedReasonDigest ? { reasonDigest: redactedReasonDigest } : {}),
  }
}

function recommendationAction(input: LocalLearningEventInput): LearningEventV1["recommendedAction"] {
  switch (input.recommendedAction) {
    case "update-kind-workflow-rule": return { type: "update-kind", value: "workflow_rule" }
    case "replace": return { type: "replace" }
    case "supersede": return { type: "supersede" }
    case undefined: return undefined
  }
}

function recommendationId(input: LocalLearningEventInput, subjectRef: string, action: LearningEventV1["recommendedAction"]): string | undefined {
  if (!action) return undefined
  const subject = input.eventType === "agreement-recommendation-accepted"
    ? input.previousMemory ?? input.memory
    : input.memory
  return digest({
    subjectRef,
    recommendationType: action.type,
    recommendedValue: action.type === "update-kind" ? action.value : undefined,
    subjectVersion: digest({ id: subject.id, updatedAt: subject.updatedAt, status: subject.status, kind: subject.kind }),
  })
}

function eventIdFor(event: LearningEventV1): string {
  return digest({ ...event, eventId: undefined })
}

function writeEventFile(directory: string, event: LearningEventV1): void {
  if (!event.eventType.endsWith("-shown")) {
    event.eventId = eventIdFor(event)
    fs.writeFileSync(path.join(directory, `${event.eventId}.json`), JSON.stringify(event, null, 2) + "\n", "utf8")
    return
  }

  for (let occurrenceIndex: number | undefined; ; occurrenceIndex = occurrenceIndex === undefined ? 1 : occurrenceIndex + 1) {
    if (occurrenceIndex === undefined) delete event.occurrenceIndex
    else event.occurrenceIndex = occurrenceIndex
    event.eventId = eventIdFor(event)
    try {
      fs.writeFileSync(path.join(directory, `${event.eventId}.json`), JSON.stringify(event, null, 2) + "\n", { encoding: "utf8", flag: "wx" })
      return
    } catch (error) {
      if (!error || typeof error !== "object" || (error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
  }
}

/**
 * Create a fail-open sink for opt-in, content-free local learning events.
 * The sink writes only hashed ids, digests, timestamps, enums, and metadata needed for local outcome analysis.
 * It caches config for the sink lifetime and enforces local learning retention at most once per sink.
 */
export function createLearningEventSink(options: LearningEventCaptureOptions = {}): LocalLearningEventSink {
  let config: SemanticMemoryConfig | undefined
  let configLoadFailed = false
  let retentionEnforced = false
  return (input): void => {
    try {
      if (configLoadFailed) return
      try {
        config ??= loadConfig(options.configPath)
      } catch {
        configLoadFailed = true
        return
      }
      if (config.learning?.capture !== "on") return

      const ownerKey = ownerProjectKey(input.memory)
      const excluded = config.learning?.excludedProjects ?? []
      if (ownerKey && excluded.includes(ownerKey)) return
      if (input.actingProjectKey && excluded.includes(input.actingProjectKey)) return

      const root = localLearningRoot(options.traceRoot, options.env)
      const ownerDirectory = ownerKey ? localLearningProjectHash(ownerKey) : "_global"
      const directory = path.join(root, ownerDirectory, "events")
      const subjectRef = digest({ memoryId: input.memory.id })
      const action = recommendationAction(input)
      const eventDecision = decision(input.eventType, input.actor, input.reason)
      const now = options.now?.() ?? new Date()
      const provenanceDigest = provenanceRef(input.memory)
      const triggerDigest = triggerContextDigest(input.triggerContext)
      const stableRecommendationId = recommendationId(input, subjectRef, action)
      const event: LearningEventV1 = {
        schemaVersion: LEARNING_EVENT_SCHEMA_VERSION,
        eventId: "",
        eventType: input.eventType,
        occurredAt: input.eventType.endsWith("-shown") ? now.toISOString() : input.memory.updatedAt,
        suggestionId: digest({ suggestionId: input.memory.id }),
        suggestionType: input.memory.kind ?? "misc",
        subjectRef,
        projectRef: digest({ project: ownerKey ?? "_global" }),
        source: input.memory.source,
        ...((input.eventType === "suggestion-created") ? { initialReviewState: input.memory.status === "approved" ? "approved" as const : "pending" as const } : {}),
        ...(provenanceDigest ? { provenanceRef: provenanceDigest } : {}),
        ...(triggerDigest ? { triggerContextDigest: triggerDigest } : {}),
        ...(action ? { recommendedAction: action } : {}),
        ...(stableRecommendationId ? { recommendationId: stableRecommendationId } : {}),
        ...(eventDecision ? { decision: eventDecision } : {}),
        ...(input.relatedMemory ? { relatedSuggestionId: digest({ suggestionId: input.relatedMemory.id }) } : {}),
      }
      fs.mkdirSync(directory, { recursive: true })
      writeEventFile(directory, event)
      if (!retentionEnforced) {
        retentionEnforced = true
        enforceLocalLearningRetention(root, now)
      }
    } catch { /* local learning capture is fail-open */ }
  }
}
