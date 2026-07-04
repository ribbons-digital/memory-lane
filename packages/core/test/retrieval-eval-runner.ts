import { buildEvalReport, corpus } from "./retrieval-eval-harness.js"

const report = await buildEvalReport(corpus)
console.log(JSON.stringify(report, null, 2))
