# Vitest 5 migration gate

Stack position: React 19 PR #56 -> Vitest 5.

## Target
- Vitest 5.0.3 stable
- Node 24.21.0
- Vite 8.3.2

## Baseline
- 67 test files
- 482 tests

## Compatibility notes
- MockMate does not configure `isolate: false`; keep the default isolation model.
- Desktop tests continue to exclude `mobile/**`; the mobile workspace keeps its own verification command.
- Repository scan found no `vi.doMock` / `importOriginal()` usages on the pre-migration default branch, but the full suite remains authoritative.

## Merge gate
- `verify:vitest5` passes before dependency install on Ubuntu and Windows.
- `npm ci` resolves without peer errors.
- Test ledger remains exactly 67/482.
- API smoke passes.
- Vite 8 output verification passes.
- Linux package/ASAR verification passes.
- Windows NSIS build + packaged `MockMate.exe` runtime smoke pass.
- Any changed test discovery count blocks merge until explained and recorded.
