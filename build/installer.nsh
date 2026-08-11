; Custom NSIS hooks for MockMate (electron-builder include).
; Goal: honest ARP entries + a usable uninstall path even when Smart App Control
; is picky about unsigned publishers. Signing (WIN_CSC_*) is still required to
; fully clear SAC / SmartScreen — this only hardens installer metadata.

!macro customHeader
  ; Prefer per-user installs (matches electron-builder default for non-admin).
!macroend

!macro customInstall
  ; electron-builder sets NoModify/NoRepair = 1 (NSIS has no MSI-style Modify UI).
  ; Keep that honest: do NOT clear NoModify — "Modify" staying greyed is expected.
  ; Ensure publisher + display metadata are present for Settings → Installed apps.
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "Publisher" "MockMate"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "URLInfoAbout" "https://github.com/vsv2014/MockMate"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "HelpLink" "https://github.com/vsv2014/MockMate/issues"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "${VERSION}"
!macroend

!macro customUnInstall
  ; Best-effort cleanup of updater cache left beside the app.
  RMDir /r "$LOCALAPPDATA\mockmate-updater"
!macroend
