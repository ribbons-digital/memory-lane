import { buildEvalReport, corpus, reportIsSatisfactory } from "./retrieval-eval-harness.js"

const report = await buildEvalReport(corpus)
console.log(JSON.stringify(report, null, 2))

if (!reportIsSatisfactory(report)) process.exitCode = 1
