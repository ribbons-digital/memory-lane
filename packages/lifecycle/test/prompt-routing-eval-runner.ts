import { buildPromptRoutingEvalReport, reportIsSatisfactory } from "./prompt-routing-eval-harness.ts"

const report = buildPromptRoutingEvalReport()
console.log(JSON.stringify(report, null, 2))

if (!reportIsSatisfactory(report)) process.exitCode = 1
