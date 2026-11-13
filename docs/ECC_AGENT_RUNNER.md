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
agent owns file allocation, conflict resolution, the final diff, and external actions.

## Verify the local runner

From the repository root:

```bash
codex features list | rg multi_agent
```

The active Codex version must report `multi_agent` as enabled. Start a new Codex session
after changing `.codex/config.toml`; use `/agent` in the CLI to inspect or steer roles.

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
