const rawVersion = process.env.MEMORY_LANE_VERSION ?? "0.0.0-dev"

export const VERSION = rawVersion.replace(/^v/u, "")
