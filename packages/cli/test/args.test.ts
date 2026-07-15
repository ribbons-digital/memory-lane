import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { flag, hasFlag, positionals } from "../src/args.ts"

describe("positionals", () => {
  it("boolean flags never consume the following positional (issue #135)", () => {
    // The original bug: `save --json remember to use pnpm` swallowed "remember".
    assert.deepEqual(
      positionals(["--json", "remember", "to", "use", "pnpm"]),
      ["remember", "to", "use", "pnpm"],
    )

    const words = ["remember", "to", "use", "pnpm"]
    for (const name of ["--all", "--yes", "--dry-run", "--force", "--stdin"]) {
      const cases = [
        { placement: "before", argv: [name, ...words] },
        { placement: "between", argv: [words[0], name, ...words.slice(1)] },
        { placement: "after", argv: [...words, name] },
      ]
      for (const { placement, argv } of cases) {
        assert.deepEqual(positionals(argv), words, `${name} ${placement} positionals`)
      }
    }
  })

  it("value flags consume exactly one following token", () => {
    const cases = [
      { name: "value flag with value before positional", argv: ["--scope", "project", "text"], expected: ["text"] },
      { name: "hyphenated value flag with value", argv: ["--stale-after-days", "30", "text"], expected: ["text"] },
      { name: "recall top-k value stays out of the query", argv: ["recall", "pnpm", "--top-k", "6", "--json"], expected: ["recall", "pnpm"] },
      { name: "value flag at end of argv", argv: ["text", "--scope"], expected: ["text"] },
      { name: "value flag followed by another flag", argv: ["--scope", "--json", "text"], expected: ["text"] },
      { name: "empty-string value is consumed, not left as a positional", argv: ["--scope", "", "text"], expected: ["text"] },
    ]
    for (const { name, argv, expected } of cases) {
      assert.deepEqual(positionals(argv), expected, name)
    }
  })

  it("preserves positional order when boolean and value flags are interleaved", () => {
    assert.deepEqual(
      positionals(["save", "--scope", "project", "remember", "--json", "to", "--status", "approved", "use", "--yes", "pnpm"]),
      ["save", "remember", "to", "use", "pnpm"],
    )
  })

  it("treats prototype-key flags as boolean, keeping the next token positional", () => {
    // Object.hasOwn keeps inherited keys like "constructor" out of VALUE_FLAGS.
    assert.deepEqual(positionals(["--constructor", "x"]), ["x"])
    assert.deepEqual(positionals(["--toString", "x"]), ["x"])
  })

  it("returns empty for empty argv", () => {
    assert.deepEqual(positionals([]), [])
  })
})

describe("flag", () => {
  it("returns the following token for a registered value flag", () => {
    assert.equal(flag(["save", "--scope", "project", "text"], "scope"), "project")
  })

  it("returns the sentinel \"true\" when the value is missing", () => {
    assert.equal(flag(["text", "--scope"], "scope"), "true")
  })

  it("returns the sentinel \"true\" when the next token is another flag", () => {
    assert.equal(flag(["--scope", "--json", "text"], "scope"), "true")
  })

  it("returns an empty string value instead of the sentinel", () => {
    assert.equal(flag(["--scope", "", "text"], "scope"), "")
  })

  it("returns undefined when the flag is absent", () => {
    assert.equal(flag(["save", "text"], "scope"), undefined)
  })

  it("throws for a name not registered in VALUE_FLAGS", () => {
    assert.throws(
      () => flag(["--json", "text"], "json"),
      /Internal error: --json is not registered in VALUE_FLAGS/,
    )
  })

  it("throws for prototype keys instead of resolving them through the prototype chain", () => {
    // Without Object.hasOwn, {}["constructor"] is truthy and "constructor"
    // would silently pass the registry check.
    assert.throws(
      () => flag(["--constructor", "x"], "constructor"),
      /Internal error: --constructor is not registered in VALUE_FLAGS/,
    )
  })
})

describe("hasFlag", () => {
  it("reports presence by exact token match only", () => {
    assert.equal(hasFlag(["save", "--json", "text"], "json"), true)
    assert.equal(hasFlag(["save", "text"], "json"), false)
    assert.equal(hasFlag(["save", "--jsonx", "text"], "json"), false)
  })
})
