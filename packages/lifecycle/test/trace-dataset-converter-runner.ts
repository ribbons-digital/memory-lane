import { requireTraceDatasetPaths, writeTraceDataset } from "./trace-dataset-converter-harness.js"

const paths = requireTraceDatasetPaths(process.argv.slice(2))
const dataset = writeTraceDataset(paths.tracesDirectory, paths.outputPath)
console.log(JSON.stringify({ outputPath: paths.outputPath, datasetId: dataset.dataset_id, metadata: dataset.metadata }, null, 2))
