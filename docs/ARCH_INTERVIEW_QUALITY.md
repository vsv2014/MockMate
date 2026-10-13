# ARCH interview quality: implemented scope

ARCH is a partial runtime policy layer, not an autonomous repair agent. Deepgram receives audio; the capture/classification/generation loop decides what to answer; ARCH supplies routing policy. This change adds an ABL-configured answer-completeness policy to both streaming and JSON hints. It does not implement a Professional State Graph or prove model accuracy.

## Established code causes addressed

- Concise strong hints were capped at 1,800 tokens while the DSA playbook required clarification, brute force, optimal explanation, full code, dry-run and edge cases before completion. Implementation requests now receive 3,600/4,800/6,000 token ceilings for concise/balanced/detailed; concise shortens explanation, not required code. Ordinary short technical answers keep their existing limits. Higher ceilings are not measured bills or availability guarantees.
- DSA playbooks no longer force clarification questions when requirements are already adequate. Complete code comes early; narrow probes and explicit no-code/pseudocode requests remain scoped.
- The JSON parser unwrapped inner code fences even inside valid JSON strings, causing valid coding responses to fail parsing. It now parses the envelope first and repairs trailing commas only outside quoted strings.
- Provider finish_reason=length was treated as success. Both stream and JSON paths now report output_truncated. Visible partial output stays visible; no silent provider switch or duplicate paid generation follows.
- Streamed code was hidden by glance rendering until completion. Code now renders as it arrives.
- Screenshot follow-up seed/context clipped code at 900 characters (and seed history at 1,400). Complete code is preserved when it fits the bounded context; oversized code is explicitly omitted instead of presented as a complete fragment. Vision/language/harness output ceilings also increase to allow full implementations.
- Streaming fallback selection was recorded only in diagnostics. A backup-provider badge now makes a fallback visible with actual provider/model in its tooltip.

## Scenario coverage and limits

| Scenario | Behavior / evidence |
|---|---|
| Fresh DSA implementation | ARCH code budget + complete-code-first contract; tested through both hint transports |
| Short coding follow-up / console call | Requires implementation with parent context; policy tests |
| Complexity/why follow-up | Narrow explanation; no mandatory code; policy tests |
| Explicit no-code / pseudocode-only | Scope preserved; no complete-code validator requirement |
| Coach mode | Guide mode remains intentional; not automatically converted into Answer mode |
| Simple technical, behavioral, design | Existing playbooks/grounding retained; coding ceilings do not apply unless implementation explicitly requested |
| JSON fallback with fenced implementation | Envelope parse regression test; full code survives normalization |
| Output cap reached | Explicit incomplete error; no success, no same-cap repair/retry or provider cooling for output-limit alone |
| Missing/unclosed code fence | Explicit code_missing/code_unfinished; retry offered, not silently labelled complete |
| Screenshot coding + follow-up | Larger output room; full selected code retained or explicit budget omission |
| Provider 400/429/timeout before output | Existing provider retry/fallback policy; a policy cannot fix invalid keys/account limits |
| Failure after output starts | Partial text retained; no automatic replacement/splicing |
| Microphone speaker uncertainty | Existing speaker-lock/manual-trigger safeguards; not bypassed by ARCH |
| System audio | Existing interviewer-source path; does not capture candidate speech automatically |
| Missing embedding key | Existing lexical retrieval fallback; this change does not enable semantic embeddings |
| Missing résumé evidence | Existing no-fabrication rules; no fabricated work history repair |

Structural checks establish presence of a nonempty closed code block, not valid syntax, algorithm correctness, test success, requested-language correctness or complete requirements coverage. No untrusted code is executed. Wrong but well-fenced code can pass this check. No competitor model/provider is assumed. No raw answers/prompts are added to diagnostics. Real provider and packaged Windows interview playback remain required to assess actual quality/latency; unit tests are not an interview benchmark.
