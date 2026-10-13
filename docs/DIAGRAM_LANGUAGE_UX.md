# Diagram, language and readability correction

This change is stacked on the ARCH coding-completeness work, not yet released.

## Findings

The v1.4.8 and current Live markdown renderers both send every fenced block to CodeBlock. Neither rendered architecture diagrams. This is a missing capability, not a proven rendering regression. Current system-design playbooks request spoken prose, not a diagram. ARCH does not autonomously repair this mismatch.

Live section headings remained 11px while answer text had been enlarged to 26–27px. Screenshot code still used the CodeBlock 12px default. The coding-language picker misleadingly described screenshot-only behavior.

## Behavior

ARCH's shared interviewAnswerPolicy adds a Mermaid output contract and a coding-sized budget for explicit draw/diagram/visualize requests in Answer mode. Existing question/history assembly supplies the referent; this change does not invent missing history. Explanation-only, no-diagram and Coach requests are respected.

Live renders closed Mermaid fences as SVG images, lazy-loading Mermaid. SVG never enters the Electron DOM as HTML. Strict security is configured; configuration directives/front matter and click directives are refused. Oversized/invalid diagrams preserve readable source with an explicit failure message. Streaming unfinished fences remain readable source until closed. Diagram correctness is not validated.

Spoken coding questions and coding follow-ups explicitly carry the selected language. An explicit language in the current question takes precedence. C++/C# recognition no longer relies on a word boundary after punctuation. The picker additionally exposes Rust, Kotlin, Swift and C. This is generation support, not a claim that every program is correct or that every language can execute inside the app. JavaScript remains the in-app execution path.

Live headings are 26px and screenshot code is 24px. Other settings/styles are not comprehensively redesigned here.

## Validation limits

Automated contract tests and production build cover wiring. No real-provider answer comparison, Windows native overlay test, or visual diagram playback has been performed. Full ARCH professional-state graph, cross-session memory and autonomous diagnosis are still absent.
