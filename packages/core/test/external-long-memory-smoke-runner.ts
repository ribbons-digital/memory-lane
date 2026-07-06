import {
  DEFAULT_K,
  DEFAULT_LIMIT,
  buildLongMemorySmokeReport,
  numberFlagFromArgs,
  reportIsSatisfactory,
  requireDatasetPath,
} from "./external-long-memory-smoke-harness.js"

const datasetPath = requireDatasetPath(process.argv.slice(2))
const report = await buildLongMemorySmokeReport({
  datasetPath,
  limit: numberFlagFromArgs(process.argv.slice(2), "limit", DEFAULT_LIMIT),
  k: numberFlagFromArgs(process.argv.slice(2), "k", DEFAULT_K),
})
console.log(JSON.stringify(report, null, 2))

if (!reportIsSatisfactory(report)) process.exitCode = 1
