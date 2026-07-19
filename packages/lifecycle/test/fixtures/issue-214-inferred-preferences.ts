export const issue214RegressionFixtures = [
  {
    name: "discussion prompt with hook specification and destructive examples",
    text: `Please always apply the hook specification below while answering.

Could we discuss whether the lifecycle hook should inspect the complete turn?
See https://example.invalid/sanitized-hook-notes for the background.

Hook specification:
- Inspect each user message.
- Run the validation command before reporting.

\`\`\`sh
rm -rf /tmp/sanitized-example
\`\`\``,
  },
  {
    name: "new-session request followed by unrelated product questions",
    text: `I prefer that you draft the new-session prompt first.

Can Blaze preserve context between sessions?
How does Fable select a model?
Should CodeRabbit review generated files?`,
  },
  {
    name: "preference with an unresolved deictic reference",
    text: "don't use knock-knock for it",
  },
] as const
