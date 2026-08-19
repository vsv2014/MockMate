# MockMate v1.4.10

Windows hotfix for the packaged JavaScript coding runner.

## Fixed

- **Run JS** no longer fails with a Content Security Policy `unsafe-eval` error.
- Evaluation permission is restricted to the disposable code-runner Worker; the main MockMate window keeps its strict policy.
- Runner code remains isolated from network, DOM, storage, and long-running execution.
- Function-only snippets now explain why they produce no visible output.

## Clarified

- JavaScript is the only locally executable answer language in this release.
- Python, Java, C++, TypeScript, Go, C#, and Ruby answers remain selectable, syntax-highlighted, and copyable.

## Validation

- Unit suite, API smoke suite, production build, server syntax, worker-specific CSP response, and unchanged renderer CSP verified locally.
- The Windows installer and updater files must still pass the GitHub Actions Windows build before release approval.
