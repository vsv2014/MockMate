// Rough $/1M-token pricing for a quick session cost estimate (input, output). Approximate
// on purpose — it's a "burn so far" gauge, not a billing system.
const PRICING = [
  [/gpt-5\.6-sol/i, 5, 30], [/gpt-5\.6-terra/i, 2.5, 15], [/gpt-5\.6-luna/i, 1, 6],
  [/claude-fable-5|fable/i, 10, 50], [/claude-opus-5|opus/i, 5, 25],
  [/claude-sonnet-5/i, 3, 15], [/claude-haiku-4-5|haiku/i, 1, 5],
  [/gpt-4o-mini/i, 0.15, 0.6], [/gpt-4o|gpt-4\.1/i, 2.5, 10],
  [/sonnet/i, 3, 15],
  [/gemini/i, 0.075, 0.3], [/llama|groq/i, 0.1, 0.1],
]
export function estimateCost(model = '', input = 0, output = 0) {
  const row = PRICING.find(([re]) => re.test(model)) || [null, 1, 3]
  return (input / 1e6) * row[1] + (output / 1e6) * row[2]
}
