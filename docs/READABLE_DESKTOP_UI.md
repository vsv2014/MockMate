# Readable desktop UI and window access

Stacked on the diagram/language corrections. This is not a released installer.

## Type contract

`src/lib/typography.js` is the shared sizing policy for desktop React screens. Old 12px body text becomes 24px, 14px becomes 28px, supporting text is at least 20px, and headings are at least 32px. Existing large Live answer/question sizes are preserved. CodeBlock defaults to 24px code. Embedded CSS, Journey font shorthands, the standalone setup HTML and native DUO hint HTML are included.

Controls gain a font-dependent minimum height, password/key inputs reserve room for the enlarged reveal button, Settings gains width and wrapping action rows, and its save button grows with the label rather than clipping it at a fixed height.

## Scroll and resize findings

- AuthGate positional CSS identified an overflow-y div as the content owner. It actually matched the sidebar; at compact widths it assigned content padding to the icon rail. Explicit `mm-shell-sidebar` and `mm-shell-content` classes replace those selectors.
- Dashboard already owned scrolling via a viewport-height flex shell and min-height:0 main. That is preserved, with visible 12px scrollbars and keyboard focus. Larger fonts alone would not have solved layout ownership.
- Auto-height connection/fallback overlays could extend below the native window. Electron panels now fill the viewport and auto-height content scrolls within it. Recovered notes are viewport bounded and scrollable.
- Auth and recovered-notes screens receive WindowResizeHandles. Dashboard and other overlay screens already had handles. Edge zones grow to 10px; corners to 18px; handles stay above modals.
- The standalone Electron setup window was explicitly non-resizable. It now permits native resizing with 320x240 minimum bounds.
- App-mode transitions force mouse input on and reject stale region forwarding via clickThroughForcedOff. Repeated app-mode transitions reassert expanded resize constraints while keeping the user's existing window size.

These are specific fixes, not a claim that every platform's native geometry is now validated.

## Evidence

948 tests pass across 117 files, including the actual main-process mode handler under a simulated window, shared typography mapping, and render contracts for Settings/Auth/Shell. Production build and main-process syntax check pass.

A headless Chromium check opened the actual Vite app with mocked API responses and a simulated Electron bridge. Settings at 1200x760 had 4115px scroll height / 697px viewport and reached scrollTop 3418. At 640x480 it had 5362px / 363px and reached scrollTop 4999. Both had 24px key inputs, 48px input height and eight resize handles. A southeast drag emitted width612/height452. Home, Interview Kits, Ready Room, Solo Practice, Duo, Jobs, Resume Studio and Sessions opened without page errors. Screenshots were inspected; the initial narrow sidebar/action layout and clipped save label were corrected before final validation.

The browser bridge does not apply native window changes. Packaged Windows resizing, display scaling, collapse/restore and scroll-wheel operation remain device-validation gates. No release or tag was created by this change.
