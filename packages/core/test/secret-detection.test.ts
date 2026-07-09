import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { containsLikelySecret } from "../src/secret-detection.js"

describe("containsLikelySecret", () => {
  it("detects well-known token prefixes", () => {
    assert.equal(containsLikelySecret("OpenAI key is sk-abc123def456ghi789jkl"), true)
    assert.equal(containsLikelySecret("GitHub token ghp_abcdefghijklmnopqrstuvwxyz"), true)
    assert.equal(containsLikelySecret("Slack token xoxb-123456789012345678901234"), true)
  })

  it("detects assignment-style secrets", () => {
    assert.equal(containsLikelySecret("API_KEY=abcd1234"), true)
    assert.equal(containsLikelySecret("password: hunter2"), true)
    assert.equal(containsLikelySecret("auth token is abcdef"), true)
  })

  it("detects private key material", () => {
    assert.equal(containsLikelySecret("-----BEGIN RSA PRIVATE KEY-----"), true)
  })

  it("detects high entropy bearer-style values", () => {
    assert.equal(containsLikelySecret("bearer Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8Ii9Jj0Kk1Ll2"), true)
  })

  it("allows high entropy branch and feature flag tokens without secret context", () => {
    assert.equal(containsLikelySecret("Deploy from branch release/JIRA-2024-blueGreenRollout-phase3"), false)
    assert.equal(containsLikelySecret("feature flag enableBlueGreenRolloutPhase3ForTenant2024"), false)
    assert.equal(containsLikelySecret("Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8Ii9Jj0Kk1Ll2"), false)
  })

  it("allows normal memory text and low-entropy identifiers", () => {
    assert.equal(containsLikelySecret("I prefer pnpm for package installs"), false)
    assert.equal(containsLikelySecret("ticket id is abcabcabcabcabcabcabcabcabcabcabcabc"), false)
  })
})
