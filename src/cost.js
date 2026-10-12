// Approximate USD / 1M tokens for a session burn gauge (not an invoice).
// Provider tiers, regional processing, cached tokens and promotions vary; pricing
// here is intentionally conservative and MUST NOT be used for billing.
const PRICING = [
  [/gpt-6-astra/i, 10, 50], [/gpt-6(?:\.1)?-sol/i, 2, 10], [/gpt-6-luna/i, 0.1, 0.5],
  [/claude-fable-5|fable/i, 10, 50], [/claude-opus-5|opus/i, 5, 25],
  // Current Claude generation at Anthropic list price (Haiku 5.5: prompts up to 100k tokens).
  [/claude-sonnet-5-5/i, 2, 10], [/claude-haiku-5-5/i, 0.1, 0.5],
  [/claude-sonnet-5/i, 3, 15], [/claude-haiku-4-5|haiku/i, 1, 5],
  [/gemini-3\.8-flash/i, 0.75, 3.75], [/gemini-3\.6-flash/i, 1.5, 7.5],
  [/gemini-3\.5-flash-lite/i, 0.3, 2.5],
  [/gpt-oss-120b/i, 0.15, 0.6],
  [/qwen3\.8|zai-glm|groq|cerebras/i, 1, 3],
]
export function estimateCost(model = '', input = 0, output = 0) {
  const row = PRICING.find(([re]) => re.test(model)) || [null, 1, 3]
  return (input / 1e6) * row[1] + (output / 1e6) * row[2]
}
