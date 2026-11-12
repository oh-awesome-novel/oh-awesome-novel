/** Models often wrap a JSON-only answer in a Markdown code fence; the payload is still the JSON inside. */
export function parseModelJson(text: string): unknown {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, ''));
}
