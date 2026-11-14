# ECC-style Codex agent runner

MockMate includes project-local Codex orchestration in `.codex/config.toml`. It does
not require a global ECC copy to expose the repository roles, although the native ECC
plugin adds its broader skill catalog and reviewed hooks when the active Codex home is
writable.

## Roles

| Role | Access | Responsibility |
| --- | --- | --- |
| `explorer` | read-only | Trace execution paths and establish evidence. |
| `qa` | workspace write | Add a failing regression in an existing harness. |
| `implementer` | workspace write | Make the smallest scoped production fix. |
| `reviewer` | read-only | Review correctness, coupling, and test quality. |
| `security` | read-only | Review auth, secrets, quotas, uploads, IPC, and updates. |
| `release_guard` | read-only | Audit candidate evidence and physical release gates. |

Codex limits the team to six concurrent threads and one delegation level. The parent
agent owns file allocation, conflict resolution, and the final diff. It may perform an
external action only when the user has explicitly authorized that action or workflow,
as required by `AGENTS.md`.

## Verify the local runner

Feature availability alone does not prove that this repository's configuration loaded.
From the repository root, first confirm the installed Codex supports multi-agent mode:

```bash
codex features list | rg multi_agent
```

The active Codex version must report the `multi_agent` line with a final value of `true`.
Then start a fresh session whose trusted project root is this repository. Use `/agent` to
confirm that all six project roles are present: `explorer`, `qa`, `implementer`,
`reviewer`, `security`, and `release_guard`. Invoke each role with a harmless inspection
task and confirm its configured access before treating the runner as activated. A passing
feature-list command, TOML parsing, or role-file existence check is only static evidence;
it is not end-to-end activation proof. Higher-level host policy may still override the
project configuration.

If the active Codex home is read-only, native ECC marketplace installation, hook trust,
and persistent plugin state cannot be activated there. The project-local roles can still
be used from a fresh trusted session, but record them as unverified until the invocation
check above succeeds.

## Defect workflow

1. Ask `explorer` to reproduce and trace the defect.
2. Give `qa` the nearest existing test file and require red evidence.
3. Give `implementer` a non-overlapping file set.
4. Run `reviewer`; add `security` or `release_guard` for affected surfaces.
5. Run focused tests, then the checks required by `AGENTS.md`.
6. Keep release claims and gates unverified until real provider, hosted, or packaged
   evidence exists for the exact candidate.

## Native ECC plugin

When the active Codex home is writable, follow ECC's pinned native marketplace procedure
and review its hook definitions before trusting them. Plugin registration and hook trust
are separate. This repository deliberately keeps its local roles useful when native plugin
installation is unavailable; it does not copy ECC's global config or credentials.
