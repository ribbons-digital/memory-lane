import { buildInjectionEvalReport, reportIsSatisfactory } from "./lifecycle-injection-eval-harness.ts"

const report = await buildInjectionEvalReport()
console.log(JSON.stringify(report, null, 2))
if (!reportIsSatisfactory(report)) process.exitCode = 1
