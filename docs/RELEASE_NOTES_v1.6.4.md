# MockMate v1.6.4 Release Notes

**Release Date:** 2026-10-13  
**Type:** Unsigned Personal Preview  
**Platform:** Windows x64 NSIS installer only

## Summary

v1.6.4 adds OpenRouter provider support, establishes a modern UI foundation with Tailwind CSS and shadcn/ui, and delivers multiple desktop stability fixes.

## New Features

### OpenRouter Provider Support
- Full integration for OpenRouter as a supported AI provider
- Connect with a single OpenRouter API key
- Access any model available through the OpenRouter platform
- Seamless model selection, usage tracking, and provider testing
- OpenRouter appears in the provider dropdown alongside existing options

### Modern UI Foundation
- **Tailwind CSS integrated:** Utility-first CSS framework for consistent styling
- **shadcn/ui components added:** Button, Card, Input, Badge, Separator
- **Design tokens centralized:** Brand colors, spacing, and typography defined in `@theme`
- **Maintainable design system:** Global utility classes for panels, typography, and layout

### Settings Improvements
- Constrained Settings screen to max-width 1000px for better readability
- Fixed save button visibility and positioning
- Cleaner layout on large displays

### Linear Ready Room Workflow
- Converted pre-flight checks from two-column grid to single-column linear layout
- Session summary card now appears at the top
- Progress indicator shows readiness status for all four checks
- Action button at the bottom for clear call-to-action
- More focused, step-by-step setup experience

### Deepgram UI Enhancements
- **Eye toggle:** Show/hide API key in Settings for better security
- **Test button:** Verify Deepgram configuration without leaving settings
- Immediate feedback on Deepgram connectivity

## Bug Fixes

### Answer Budget Corrections
- Fixed thinking token budget application per model
- Implemented proper floor values for thinking budgets
- Improved empty-output detection and error surfacing
- Diagnostic logging enhanced for troubleshooting

### Desktop Stability
- **Black overlay fix:** Unrecognized views now show informative fallback panel instead of black window
- **Collapsed pill fix:** Body background made transparent when pill is collapsed, eliminating black rectangle artifact
- Improved error handling and user feedback

## Technical Changes

- Tailwind CSS v4 installed and configured
- shadcn/ui component library integrated
- Design tokens moved to CSS `@theme` for global access
- Ready Room component refactored to use utility classes
- Settings component constrained with max-width wrapper

## Known Issues

- This is an unsigned build - Windows SmartScreen will show a warning
- No auto-update feed - manual download required for updates
- macOS/Linux builds not included in this release
- Latest signed stable installer remains v1.5.3

## Installation

1. Download the Windows x64 installer from the releases page
2. Run the installer (expect SmartScreen warning for unsigned builds)
3. Launch MockMate and configure your API keys in Settings

## Verification

- [ ] OpenRouter provider appears in Settings
- [ ] Deepgram test button works
- [ ] Settings screen constrained width
- [ ] Ready Room shows linear layout
- [ ] No black overlay on navigation errors
- [ ] Collapsed pill has transparent background

## Previous Releases

- v1.6.3: Complete Live answers, Claude 5.5, early answer start
- v1.6.2: Unsigned personal preview with model routing fixes
- v1.6.1: Unsigned delivery correction with separate app identity

## Resources

- [Full Changelog](../CHANGELOG.md)
- [Release Process](RELEASE.md)
- [Release Checklist](RELEASE_CHECKLIST.md)
- [Signing Setup](../SIGNING.md)

---

**Note:** This is an unsigned personal preview build. It is not code-signed and has no auto-update feed. For production use, wait for a signed stable release.
