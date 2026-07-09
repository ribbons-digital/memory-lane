export type Harness = "claude-code-cli" | "codex-cli" | "claude-desktop" | "codex-desktop" | "pi"

export interface DetectedHarness {
  harness: Harness
  name: string
  detected: boolean
  configPath?: string
  reason?: string
}

export interface InitOptions {
  binaryPath: string
  dataDir: string
  projectMode: boolean
  projectPath?: string
  yes: boolean
  homeDir: string
}

export interface IntegrationResult {
  harness: Harness
  configured: boolean
  configPath?: string
  skipped?: boolean
  message?: string
}

export interface InitResult {
  binaryPath: string
  dataDir: string
  integrations: IntegrationResult[]
  failedIntegrations: IntegrationResult[]
}
