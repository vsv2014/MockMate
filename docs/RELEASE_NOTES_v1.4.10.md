# MockMate v1.4.10

Windows hotfix for the packaged JavaScript coding runner.

## Fixed

- **Run JS** no longer fails with a Content Security Policy `unsafe-eval` error.
- Evaluation permission is restricted to the disposable code-runner Worker; the main MockMate window keeps its strict policy.
- Runner code remains isolated from network, DOM, storage, and long-running execution.
- Function-only snippets now explain why they produce no visible output.
- Coding answers now keep the clean interview-platform solution separate from an expandable standalone version containing an entry point, executable sample invocation/input, printed output, and labeled tests for external online compilers.
- **Copy Solution** copies only the requested function/class. **Copy Runnable** copies the standalone Programiz-style version. JavaScript **Run JS** executes the runnable version.

## Clarified

- JavaScript is the only locally executable answer language in this release.
- Python, Java, C++, TypeScript, Go, C#, and Ruby answers remain selectable, syntax-highlighted, copyable, and online-compiler-ready; only their in-overlay execution is unavailable.
- Visible interviewer examples are labeled separately from illustrative sanity tests generated when no example was provided.

## Validation

- Unit suite, API smoke suite, production build, server syntax, worker-specific CSP response, and unchanged renderer CSP verified locally.
- The Windows installer and updater files must still pass the GitHub Actions Windows build before release approval.
