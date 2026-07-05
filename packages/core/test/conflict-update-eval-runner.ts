import { buildConflictUpdateEvalReport, reportIsSatisfactory } from "./conflict-update-eval-harness.js"

const report = await buildConflictUpdateEvalReport()
console.log(JSON.stringify(report, null, 2))

if (!reportIsSatisfactory(report)) process.exitCode = 1
