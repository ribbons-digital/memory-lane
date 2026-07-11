import {
  requireCaptureOutcomeDatasetPaths,
  writeCaptureOutcomeDataset,
} from "./capture-outcome-dataset-harness.js"

const paths = requireCaptureOutcomeDatasetPaths(process.argv.slice(2))
const dataset = writeCaptureOutcomeDataset(paths)
console.log(JSON.stringify({
  outputPath: paths.outputPath,
  datasetId: dataset.datasetId,
  generatedAsOf: dataset.generatedAsOf,
  noData: dataset.noData,
}, null, 2))
