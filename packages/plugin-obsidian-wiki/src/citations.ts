export function cite(notePath: string, heading?: string): string {
  return heading ? `${notePath}#${heading}` : notePath
}

export function formatAnswerWithCitations(answer: string, citations: string[]): string {
  if (!citations.length) return answer
  return [answer, "", "Sources:", ...citations.map((c) => `- ${c}`)].join("\n")
}
