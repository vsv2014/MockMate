# MockMate Audit Status — 2026-10-03

Reconciled against current `main` after PR #36 and the CI workflow-noise fixes.

## Counts

- **Baseline:** 198 findings
- **FIXED + verified:** 98
- **OPEN:** 67
- **DEFERRED:** 33
- **Desktop/core active scope:** 165 (= 198 - 33 deferred)
- **Desktop/core fixed:** 98
- **Desktop/core still open:** 67

`FIXED` means the remediation is present on `main` and is supported by code inspection plus the green desktop verification gate (unit tests, API smoke, production build) where applicable. `OPEN` is intentionally conservative: an item remains open if the original condition still exists or the merged code does not prove it is fully resolved. `DEFERRED` reflects the current product scope: mobile, billing/plan work, and the two static/BYOK key-security findings explicitly deprioritized for the current single-user desktop test phase.

## FIXED + verified (98)

AUD-002, AUD-005, AUD-006, AUD-008, AUD-009, AUD-010, AUD-011, AUD-012, AUD-013, AUD-020, AUD-021, AUD-022, AUD-023, AUD-024, AUD-025, AUD-026, AUD-028, AUD-029, AUD-034, AUD-035, AUD-036, AUD-037, AUD-038, AUD-039, AUD-040, AUD-041, AUD-042, AUD-044, AUD-048, AUD-060, AUD-061, AUD-062, AUD-065, AUD-072, AUD-073, AUD-079, AUD-080, AUD-081, AUD-083, AUD-086, AUD-087, AUD-088, AUD-089, AUD-092, AUD-094, AUD-095, AUD-099, AUD-100, AUD-101, AUD-102, AUD-103, AUD-104, AUD-105, AUD-111, AUD-112, AUD-114, AUD-115, AUD-117, AUD-118, AUD-119, AUD-127, AUD-128, AUD-130, AUD-131, AUD-132, AUD-134, AUD-136, AUD-137, AUD-140, AUD-141, AUD-145, AUD-146, AUD-147, AUD-148, AUD-149, AUD-151, AUD-152, AUD-153, AUD-154, AUD-158, AUD-163, AUD-164, AUD-174, AUD-175, AUD-176, AUD-177, AUD-178, AUD-180, AUD-186, AUD-188, AUD-189, AUD-190, AUD-191, AUD-192, AUD-194, AUD-196, AUD-197, AUD-198.

## OPEN (67)

AUD-001, AUD-003, AUD-004, AUD-007, AUD-014, AUD-015, AUD-016, AUD-017, AUD-018, AUD-027, AUD-030, AUD-031, AUD-032, AUD-033, AUD-043, AUD-045, AUD-046, AUD-047, AUD-049, AUD-054, AUD-055, AUD-056, AUD-057, AUD-058, AUD-059, AUD-063, AUD-064, AUD-075, AUD-076, AUD-078, AUD-082, AUD-091, AUD-093, AUD-113, AUD-120, AUD-121, AUD-122, AUD-123, AUD-124, AUD-125, AUD-126, AUD-129, AUD-133, AUD-135, AUD-138, AUD-142, AUD-143, AUD-144, AUD-150, AUD-155, AUD-156, AUD-157, AUD-159, AUD-160, AUD-161, AUD-162, AUD-165, AUD-166, AUD-179, AUD-181, AUD-182, AUD-183, AUD-184, AUD-185, AUD-187, AUD-193, AUD-195.

## DEFERRED (33)

### Mobile (22)
AUD-019, AUD-050, AUD-051, AUD-052, AUD-053, AUD-077, AUD-084, AUD-085, AUD-106, AUD-107, AUD-108, AUD-109, AUD-110, AUD-116, AUD-139, AUD-167, AUD-168, AUD-169, AUD-170, AUD-171, AUD-172, AUD-173.

### Billing / plan lifecycle (9)
AUD-066, AUD-067, AUD-068, AUD-069, AUD-070, AUD-071, AUD-096, AUD-097, AUD-098.

### Static/BYOK key security deferred for current local testing (2)
AUD-074, AUD-090.

## Verification evidence used

- PR #36 merged desktop/core stabilization into `main`.
- Desktop CI on the merged remediation head passed unit tests, API smoke, and production Vite build.
- ARCH now compiles ABL runtime policy, distinguishes client-only capabilities, supports abortable bounded STT retry/circuit behavior, and no longer exposes process-global performance data through the public capability endpoint.
- Desktop RAG now has full-content cache signatures, in-flight indexing deduplication, abort propagation, vector-dimension recovery, bounded document/PDF handling, and safer profile/document synchronization.
- Electron lifecycle fixes include retained tray ownership, explicit child readiness, bounded renderer retry behavior, truthful updater IPC, async/rotated session metrics, and improved STT device recovery.
- Auth/backend fixes include live store readiness, graceful hosted drain, safer OAuth/reset handling, password bounds, store write failure propagation, and serverless public-proxy guards.

## Rule going forward

Do not reduce the OPEN count merely because code was touched. Move an ID from OPEN to FIXED only when its original failure condition is removed and the relevant verification passes. Deferred items do not block the current desktop release, but remain part of the 198-item master audit.
