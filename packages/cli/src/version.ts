// Release builds define MEMORY_LANE_VERSION at compile time so CLI metadata,
// install manifests, and migration provenance share the same release version.
const rawVersion = process.env.MEMORY_LANE_VERSION ?? "0.0.0-dev"

export const VERSION = rawVersion.replace(/^v/u, "")
