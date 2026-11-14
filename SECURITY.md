# Security policy

## Supported code

Security fixes target the current default branch and the newest supported release.
Older previews and unsigned personal builds may require upgrading before a fix can be
applied. Release notes identify any version-specific mitigation.

## Reporting a vulnerability

Use GitHub's private security advisory flow for this repository. Do not open a public
issue for an unpatched vulnerability and do not include real API keys, access tokens,
interview content, resumes, audio, screenshots, or other personal data in a report.

Include:

- affected version or commit;
- platform and packaging type;
- a minimal reproduction using synthetic data;
- expected and observed behavior;
- impact and any known workaround.

Reports are validated against the current source and applicable packaged build. A source
fix is not considered released until the required packaging, signing, update, smoke, and
rollback evidence is complete.
