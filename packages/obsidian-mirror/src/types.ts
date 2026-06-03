export interface MirrorMemoryProvenance {
  adapter?: string
  lifecycleEvent?: string
  sessionId?: string
  turnId?: string
  toolName?: string
}

export interface MirrorMemoryScope {
  type: string
  key?: string
}

export interface MirrorMemoryRecord {
  id: string
  status: "pending" | "approved" | "rejected" | "deleted"
  text: string
  category: string
  scope: MirrorMemoryScope
  source: string
  createdAt: string
  updatedAt: string
  kind?: string
  provenance?: MirrorMemoryProvenance
}
