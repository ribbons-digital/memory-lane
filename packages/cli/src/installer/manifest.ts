import { resolveOmpAgentDir } from "@memory-lane/core"
import * as fs from "node:fs"
import * as path from "node:path"

export type InstallManifestEntry = Record<string, unknown>

export interface InstallManifest {
  version?: unknown
  installedAt?: unknown
  binaryPath?: unknown
  dataDir?: unknown
  integrations: InstallManifestEntry[]
}

export type InstallManifestReadResult =
  | { status: "missing"; path: string; warnings: [] }
  | { status: "malformed"; path: string; warnings: string[] }
  | { status: "partial"; path: string; warnings: string[]; value?: Record<string, unknown> }
  | { status: "valid"; path: string; warnings: string[]; manifest: InstallManifest }

export interface ValidatedPath {
  ok: true
  value: string
}

export interface InvalidPath {
  ok: false
  warning: string
}

export type PathValidation = ValidatedPath | InvalidPath

export interface PathApi {
  normalize(value: string): string
  isAbsolute(value: string): boolean
  join(...parts: string[]): string
  basename(value: string): string
  dirname(value: string): string
  sep: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function installManifestPath(dataDir: string): string {
  return path.join(dataDir, "install.json")
}

export function readInstallManifest(dataDir: string): InstallManifestReadResult {
  const file = installManifestPath(dataDir)
  if (!fs.existsSync(file)) return { status: "missing", path: file, warnings: [] }

  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return { status: "malformed", path: file, warnings: [`Invalid JSON in install manifest: ${file}`] }
  }

  if (!isRecord(parsed)) {
    return { status: "partial", path: file, warnings: [`Install manifest root must be an object: ${file}`] }
  }
  if (!Array.isArray(parsed.integrations)) {
    return {
      status: "partial",
      path: file,
      value: parsed,
      warnings: [`Install manifest integrations must be an array: ${file}`],
    }
  }

  const integrations: InstallManifestEntry[] = []
  const warnings: string[] = []
  for (const [index, integration] of parsed.integrations.entries()) {
    if (!isRecord(integration)) {
      warnings.push(`Install manifest integration ${index + 1} must be an object.`)
      integrations.push({ value: integration })
      continue
    }
    integrations.push(integration)
    if (typeof integration.harness !== "string" || !integration.harness.trim()) {
      warnings.push(`Install manifest integration ${index + 1} has no usable harness.`)
    }
    if (typeof integration.configPath !== "string" || !integration.configPath.trim()) {
      warnings.push(`Install manifest integration ${index + 1} has no usable configPath.`)
    }
  }

  return {
    status: "valid",
    path: file,
    warnings,
    manifest: {
      version: parsed.version,
      installedAt: parsed.installedAt,
      binaryPath: parsed.binaryPath,
      dataDir: parsed.dataDir,
      integrations,
    },
  }
}

export function writeInstallManifest(dataDir: string, manifest: InstallManifest): void {
  fs.writeFileSync(installManifestPath(dataDir), JSON.stringify(manifest, null, 2) + "\n", "utf8")
}

export function validateAbsoluteManifestPath(
  value: unknown,
  label: string,
  pathApi: PathApi = path,
): PathValidation {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, warning: `${label} must be a non-empty absolute path.` }
  }
  const normalized = pathApi.normalize(value)
  if (!pathApi.isAbsolute(normalized)) {
    return { ok: false, warning: `${label} must be an absolute path: ${value}` }
  }
  return { ok: true, value: normalized }
}

export function integrationHarness(entry: InstallManifestEntry): string | undefined {
  return typeof entry.harness === "string" && entry.harness.trim() ? entry.harness : undefined
}

export function integrationConfigPath(
  entry: InstallManifestEntry,
  pathApi: PathApi = path,
): PathValidation {
  const harness = integrationHarness(entry) ?? "unknown"
  return validateAbsoluteManifestPath(entry.configPath, `Install manifest ${harness} configPath`, pathApi)
}

export function validateOmpExtensionConfigPath(
  value: unknown,
  pathApi: PathApi = path,
): PathValidation {
  if (typeof value === "string" && (value.endsWith("/") || value.endsWith("\\"))) {
    return { ok: false, warning: `Install manifest omp configPath must identify index.ts, not a directory: ${value}` }
  }
  const validated = validateAbsoluteManifestPath(value, "Install manifest omp configPath", pathApi)
  if (!validated.ok) return validated
  const extensionDir = pathApi.dirname(validated.value)
  const extensionsDir = pathApi.dirname(extensionDir)
  if (
    pathApi.basename(validated.value) !== "index.ts"
    || pathApi.basename(extensionDir) !== "memory-lane"
    || pathApi.basename(extensionsDir) !== "extensions"
  ) {
    return { ok: false, warning: `Refusing to manage an unexpected OMP extension path: ${validated.value}` }
  }
  return validated
}

export function validateManifestOmpConfigPaths(
  manifest: InstallManifest,
  pathApi: PathApi = path,
): string[] {
  const configPaths: string[] = []
  for (const entry of manifest.integrations) {
    if (integrationHarness(entry) !== "omp") continue
    const config = validateOmpExtensionConfigPath(entry.configPath, pathApi)
    if (!config.ok) throw new Error(config.warning)
    configPaths.push(config.value)
  }
  return configPaths
}

export function ompDiagnosticTarget(
  result: InstallManifestReadResult,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  homeDir: string,
): { path: string | null; warnings: string[] } {
  const defaultPath = path.join(
    resolveOmpAgentDir(env, homeDir),
    "extensions",
    "memory-lane",
    "index.ts",
  )
  if (result.status !== "valid") {
    return { path: defaultPath, warnings: [...result.warnings] }
  }

  const ompEntries = result.manifest.integrations.filter((entry) => integrationHarness(entry) === "omp")
  if (ompEntries.length === 0) return { path: defaultPath, warnings: [...result.warnings] }
  const validated = integrationConfigPath(ompEntries[0])
  if (!validated.ok) {
    return { path: null, warnings: [...result.warnings, validated.warning] }
  }
  const warnings = [...result.warnings]
  if (ompEntries.length > 1) warnings.push("Install manifest contains duplicate OMP integrations; doctor inspected the first recorded path.")
  return { path: validated.value, warnings }
}

export function mergeManifestIntegrations(
  previous: InstallManifestEntry[],
  replacements: InstallManifestEntry[],
): InstallManifestEntry[] {
  const replacementByHarness = new Map<string, InstallManifestEntry>()
  for (const entry of replacements) {
    const harness = integrationHarness(entry)
    if (harness) replacementByHarness.set(harness, entry)
  }

  const merged: InstallManifestEntry[] = []
  const emitted = new Set<string>()
  for (const entry of previous) {
    const harness = integrationHarness(entry)
    if (!harness || !replacementByHarness.has(harness)) {
      merged.push(entry)
      continue
    }
    if (!emitted.has(harness)) {
      merged.push(replacementByHarness.get(harness)!)
      emitted.add(harness)
    }
  }
  for (const entry of replacements) {
    const harness = integrationHarness(entry)
    if (!harness || emitted.has(harness)) continue
    merged.push(entry)
    emitted.add(harness)
  }
  return merged
}
