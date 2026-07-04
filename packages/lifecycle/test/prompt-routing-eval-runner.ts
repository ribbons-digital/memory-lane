import { buildPromptRoutingEvalReport } from "./prompt-routing-eval-harness.ts"

const report = buildPromptRoutingEvalReport()
console.log(JSON.stringify(report, null, 2))

if (report.summary.failCount > 0 || report.summary.zeroToleranceFailures > 0) process.exitCode = 1
