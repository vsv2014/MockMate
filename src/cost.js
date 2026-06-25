// Rough $/1M-token pricing for a quick session cost estimate (input, output). Approximate
// on purpose — it's a "burn so far" gauge, not a billing system.
const PRICING = [
  [/gpt-4o-mini/i, 0.15, 0.6], [/gpt-4o|gpt-4\.1/i, 2.5, 10],
  [/opus/i, 5, 25], [/sonnet/i, 3, 15], [/haiku/i, 1, 5],
  [/gemini/i, 0.075, 0.3], [/llama|groq/i, 0.1, 0.1],
]
export function estimateCost(model = '', input = 0, output = 0) {
  const row = PRICING.find(([re]) => re.test(model)) || [null, 1, 3]
  return (input / 1e6) * row[1] + (output / 1e6) * row[2]
}
