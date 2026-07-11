import * as fs from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import {
  containsLikelySecret,
  loadConfig,
  type LocalLearningEventInput,
  type LocalLearningEventSink,
  type MemoryRecord,
  type MemoryRevisionActor,
  type MemorySource,
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
  suggestionId: string
  suggestionType: NonNullable<MemoryRecord["kind"]>
  subjectRef: string
  projectRef: string
  source?: MemorySource
  initialReviewState?: "pending" | "approved"
  provenanceRef?: string
  triggerContextDigest?: string
  recommendationId?: string
  recommendedAction?: { type: "update-kind"; value: "workflow_rule" }
  decision?: {
    type: LearningDecisionType
    actor: MemoryRevisionActor | "lifecycle"
    reasonCode: LearningReasonCode
    reasonDigest?: string
  }
  relatedSuggestionId?: string
}

export interface LearningEventCaptureOptions {
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

function triggerContextDigest(triggerContext: string | undefined): string | undefined {
  if (!triggerContext) return undefined
  const normalized = triggerContext.replace(/\s+/gu, " ").trim().slice(0, TRIGGER_CONTEXT_MAX_CHARS)
  if (!normalized) return undefined
  return digest(containsLikelySecret(normalized) ? "[redacted:secret]" : normalized)
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
  return {
    type: value[0],
    actor: actor ?? "manual",
    reasonCode: value[1],
    ...(reason ? { reasonDigest: digest(reason.slice(0, TRIGGER_CONTEXT_MAX_CHARS)) } : {}),
  }
}

function recommendationAction(input: LocalLearningEventInput): LearningEventV1["recommendedAction"] {
  if (!input.recommendedAction) return undefined
  return { type: "update-kind", value: "workflow_rule" }
}

function recommendationId(input: LocalLearningEventInput, subjectRef: string, action: LearningEventV1["recommendedAction"]): string | undefined {
  if (!action) return undefined
  const subject = input.eventType === "agreement-recommendation-accepted"
    ? input.previousMemory ?? input.memory
    : input.memory
  return digest({
    subjectRef,
    recommendationType: action.type,
    recommendedValue: action.value,
    subjectVersion: digest({ id: subject.id, updatedAt: subject.updatedAt, status: subject.status, kind: subject.kind }),
  })
}

export function createLearningEventSink(options: LearningEventCaptureOptions = {}): LocalLearningEventSink {
  return (input): void => {
    try {
      const config = loadConfig(options.configPath)
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
      event.eventId = digest({ ...event, eventId: undefined, occurredAt: undefined })

      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(path.join(directory, `${event.eventId}.json`), JSON.stringify(event, null, 2) + "\n", "utf8")
      enforceLocalLearningRetention(root, now)
    } catch { /* local learning capture is fail-open */ }
  }
}
