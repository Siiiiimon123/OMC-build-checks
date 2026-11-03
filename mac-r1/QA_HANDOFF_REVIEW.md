# Adversarial review: Mac QA handoff

Frozen review baseline: `245565e12321a87782ece85d9b9c59e9c09bc678`, user constraints requiring only `qa-r1/<nonce>/` and the specified private staging root. Reviewer did not author the candidate, but inherited task context; this was not an isolated blind review.

## Confirmed blocker: target isolation

- Affected: `mac-r1/final/controlled-route.cjs:10`, `mac-r1/final/controlled-upgrade-17-to-18.mjs:3`, and the existing `metadata-stage/stage.cjs:15,19` and `metadata-stage/remote.py:43,48,65`.
- Trigger: the current stage publishes the descriptor and package in shared `/updates/targets/`; the candidate routes only metadata to QA, so placing those targets exclusively under the nonce causes requests to miss them.
- Consequence: either the scope restriction is breached or the upgrade cannot fetch its signed targets; this blocks the one authorized run. Confidence: high. A stub-fetch check showed metadata remapped while target requests remained on `/updates/targets/`; code confirms the stage paths.
- Closure requires an authorized compatible candidate and isolated stage, tests for path and redirect rejection and intact signed/hash verification, real HTTP and end-to-end rehearsal, then a new baseline review. Installed released17 behavior still needs native evidence.

## Remaining runtime risk: available window

- `mac-r1/final/run.py:165` limits waiting to `min(await start + 900 seconds, total deadline - 600 seconds)`; late early-publication can leave less than 900 seconds. High confidence in code; real timings are not established.
- Even a rehearsal below 900 seconds alone does not guarantee sufficient runtime. The executor must start promptly, measure available budget and fail closed; retain the remaining timing risk.
