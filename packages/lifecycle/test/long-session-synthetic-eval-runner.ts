import { buildLongSessionEvalReport, reportIsSatisfactory } from "./long-session-synthetic-eval-harness.js"

const report = await buildLongSessionEvalReport()
console.log(JSON.stringify(report, null, 2))

if (!reportIsSatisfactory(report)) process.exitCode = 1
