# MockMate v1.6.6 Release Notes

Status: release candidate. No tag or installer has been published.

This candidate addresses Live usability problems reported in v1.6.5.

- Live answer typography doubles: main answer 27px, full answer 26px, code 24px; question and control text also doubles.
- Default overlay is 600×720, clamped to the current display. Expanded Windows windows are resizable; the collapsed badge stays fixed at 72×72. Opening geometry is applied with the mode transition, and resize gestures start from native dimensions.
- Microphone auto-answering resumes after the existing speaker heuristic locks and audio is not degraded. Candidate/unknown speakers remain gated; speaker ID 0 is treated as valid.
- Manual answers and retries disable automatic skipping. Skipped responses now show a failure and retry action.
- Session notes retain Back/minimize/close/resize controls. Report generation can be left, abandoned requests are aborted, and evaluation times out after 30 seconds.

## Validation and limitations

Production build passes and all 845 tests pass. Packaged Windows first-open resize, collapse/drag transparency, display scaling and live microphone behavior require device validation before release. The speaker lock is heuristic, not verified identity. Separate Claude 400 failures and overall answer quality are not resolved by this candidate.

Desktop package and lock files are versioned 1.6.6. Backend and mobile manifests retain their independently versioned releases. Signing/publication status will be established by the selected release workflow and its artifact checks.

[Changelog](../CHANGELOG.md) · [Release process](RELEASE.md) · [Acceptance checklist](RELEASE_CHECKLIST.md)
