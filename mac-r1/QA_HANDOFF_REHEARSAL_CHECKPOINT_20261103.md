# Mac QA handoff rehearsal: checkpoint, 2026-11-03

This is an interim record, not a passing rehearsal, permission to push, or Mac acceptance. Candidate `verify-mac-r1-18` remains local at `245565e12321a87782ece85d9b9c59e9c09bc678`; this work must not push it, dispatch a workflow, merge, or change main. The one authorized Mac run remains bounded to 3600 seconds with no automatic rerun.

## Scope correction and setup

The previous shared-target isolation HOLD in `QA_HANDOFF_REVIEW.md` is **superseded as an authorization objection** by the user's 2026-11-03 20:10 Asia/Shanghai approval and explicit follow-up scope. The candidate routes metadata to the QA nonce while targets remain on the shared target path. The approved rehearsal may create new hash-prefixed descriptor and package targets, or verify existing identical content; different content must not be overwritten. This authorization does not permit promoting or overwriting formal `public/metadata/`; `feedsModified` and `formalUrlServingTested` refer to the formal feed and must remain false.

`SSH_SETUP.json` in the local prep directory records a successful SSH setup check: the actual private staging directory is `/srv/omc-updates/staging/r1-release-artifacts` (mode 0700), and the QA root and fixed candidate nonce directory are mode 0755. It records the formal metadata hashes at setup. This is setup evidence, not a later before/after comparison or a rehearsal success.

The historical run `41274803807` may be used only with explicit rehearsal labeling and authenticated transport; it is not the next run's package. A real handoff must instead bind the new run's early output and package SHA through authenticated relay, signing, stage and `QA_READY`.

## Gates still open at this checkpoint

- Complete and time a real full relay/sign/stage/HTTPS readback, compare formal metadata against the recorded baseline, and retain a result with the actual package SHA and under-900-second margin.
- Preserve the rehearsal nonce evidence and restore an empty fixed candidate nonce before a real handoff; immutable role files and `QA_READY` cannot simply be overwritten. Verify the transition and absence of stale readiness.
- Complete and review the real run-specific executor and rerun static/controller/preflight gates. Until evidence closes every applicable gate, `PUSH_READY.readyToPush` stays false.

The controller's wait is bounded by the earlier of 900 seconds after it starts waiting and its deadline minus 600 seconds. A rehearsal under 900 seconds alone cannot establish a full 900-second window for every live run. Native Mac install, GUI, and controlled upgrade remain unverified on the Windows preparation host.

## Rehearsal result

The real ancestry-package relay, signing, QA staging and HTTPS readiness readback completed, but **the rehearsal failed the timing gate**: the recorded end-to-end wall-clock duration was 1027.812 seconds, with a margin of −127.812 seconds against 900 seconds. Relay alone was reported at 987.532 seconds. The timer did not capture a monotonic start, and a clock adjustment was not independently ruled out; this is a limitation of the timing evidence. The authenticated rehearsal PKG SHA-256 is `c2c7c2eb0a4f647f41c4f066a0b362e564911a1f556b1d7b99288d57f9555dde`; it is not the new Mac-run package.

The formal metadata regular-file hashes compared equal before and after the rehearsal. The rehearsal nonce was archived with matching file hashes; the fixed candidate nonce was recreated empty and its READY URL returned 404. Evidence is in local prep `REHEARSAL_RESULT.json`, `REHEARSAL_RELAY_PROOF.json`, `REHEARSAL_STAGE_RECEIPT.json`, `NONCE_TRANSITION.json` and `codex-qa-rehearsal-r2.stderr.txt`. The preflight must be rerun against the completed evidence and must remain blocked by the failed timing gate. No candidate push, dispatch, merge or Mac cloud run occurred.
