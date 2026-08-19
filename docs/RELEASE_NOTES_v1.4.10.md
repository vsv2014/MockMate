# MockMate v1.4.10

## Runtime and answer intelligence

- Desktop runtime upgraded to Electron 43 and electron-builder 26. Release CI now initializes Electron's lazy runtime before packaging.
- Live setup offers **Fast**, **Balanced**, and **Maximum quality** answer intelligence. Maximum quality uses the strongest model the configured key actually exposes; it does not assume that entering a provider key grants every model.
- The model picker recognizes current GPT-5.6 and Claude 5 families, including Claude Fable 5, while explicit model selection remains authoritative.

## Managed AI and release security

- Public installers no longer contain `.env` or provider/Deepgram credentials.
- Release CI fails unless the `MOCKMATE_API_BASE` repository variable is a non-loopback HTTPS URL.
- Managed model strategy is enforced by the backend according to account plan; modified clients cannot select an unauthorized premium provider/model.
- Monthly LLM usage is reserved atomically before generation and released after failed, cancelled or skipped work.
- Desktop and hosted requests share privacy-safe request IDs; hosted provider-attempt logs contain metadata only.
- Embeddings fail over from OpenAI to Gemini rather than disabling résumé/JD retrieval after the first provider error.

Windows hotfix for the packaged JavaScript coding runner.

## Fixed

- **Run JS** no longer fails with a Content Security Policy `unsafe-eval` error.
- Evaluation permission is restricted to the disposable code-runner Worker; the main MockMate window keeps its strict policy.
- Runner code remains isolated from network, DOM, storage, and long-running execution.
- Function-only snippets now explain why they produce no visible output.
- Coding answers now keep the clean interview-platform solution separate from an expandable standalone version containing an entry point, executable sample invocation/input, printed output, and labeled tests for external online compilers.
- **Copy Solution** copies only the requested function/class. **Copy Runnable** copies the standalone Programiz-style version. JavaScript **Run JS** executes the runnable version.
- Gemini résumé/JD/document retrieval uses the supported `gemini-embedding-001` model; the retired `text-embedding-004` model is no longer called.
- Automatic routing no longer cycles through every hard-coded model alias belonging to one API key. It tries one candidate per provider family, temporarily benches a family after hard/quota failures, and starts Gemini automatic sessions with the model proven available in v1.4.9 QA.
- Live streams have an 11-second end-to-end deadline and emit matched attempt IDs with explicit success, failure, timeout, or cancellation outcomes.
- Exported session metrics include provider-level fallbacks, failures, timeouts, cancellations, and recovered errors.
- The supported runtime baseline is Node.js 24 LTS; release builds no longer run on EOL Node.js 20.
- Solo/Duo microphone transcription now uses Deepgram Nova-3 and falls back to Nova-2 only when Nova-3 cannot establish a session, matching Live system-audio behavior.
- Live model discovery ranks newer stable Gemini 3.x models exposed by the configured key while retaining the last proven compatible model when newer models are unavailable.
- Privacy-safe diagnostics now include model-selection reason, model-discovery counts, embedding dimensions, RAG document/chunk/hit metrics, similarity-score ranges, microphone confidence, and buffered/dropped audio byte counts without recording content.

## Clarified

- JavaScript is the only locally executable answer language in this release.
- Python, Java, C++, TypeScript, Go, C#, and Ruby answers remain selectable, syntax-highlighted, copyable, and online-compiler-ready; only their in-overlay execution is unavailable.
- Visible interviewer examples are labeled separately from illustrative sanity tests generated when no example was provided.

## Validation

- 760 unit/integration tests, 9 API smoke tests, dependency doctor, production build, server syntax, worker-specific CSP response, and unchanged renderer CSP verified locally.
- The Windows installer and updater files must still pass the GitHub Actions Windows build before release approval.
