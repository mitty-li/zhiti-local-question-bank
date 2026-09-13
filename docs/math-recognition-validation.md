# Math contract and recognition pipeline validation

Branch: `fix/math-contract-recognition-20260913`. No merge into `main` or production deployment is performed by this change.

## Local checkout

Preserve any uncommitted work before switching branches. Use a current Node.js 22 release.

```sh
git fetch origin
git switch --track origin/fix/math-contract-recognition-20260913
npm ci
npm run test:studio
npm run benchmark:studio
npm run dev
```

If the branch already exists locally, switch to it and use `git pull --ff-only` instead of creating it again. The existing development command uses Unix environment-variable syntax. On Windows, run its components separately:

```sh
node scripts/prepare-homework-assets.mjs
node scripts/sync-local-env.mjs
npx vinext dev --port 3001
```

Open the local `/answer-studio` page. Keep the existing model endpoint, model, reasoning configuration, source files and concurrency unchanged for an A/B comparison.

**Data safety:** initial validation should use a new browser profile. The draft database upgrades to IndexedDB version 2, storing original page images separately from checkpoints. Existing version-1 drafts migrate on their first successful write, but older application versions that explicitly open database version 1 cannot open an upgraded database. Preserve original source files and a browser-profile backup; do not clear storage to work around an error. Close old Studio tabs when prompted before upgrading.

## What changed

- One shared math capability registry drives the symbol map, escape repair, prompt capabilities and parser. Inline and display math use a 22-half-point (11-point) base size. Native Word script scaling is retained; no depth-based enlargement is applied.
- Balanced grid parsing handles nested matrices/cases/aligned environments, escaped separators, and array column alignment. The parser and successful compilation cache have bounded depth, size and memory.
- Horizontal rules in a standalone array use native editable Word tables with OMML cells and real borders, not screenshots, phantom placeholders or simulated underlining. A separator paragraph prevents adjacent arrays from being merged by Word-compatible importers.
- Formal exports fail with question/field/location information instead of silently replacing unsupported formulas. An explicitly marked review copy remains available under the collapsed troubleshooting section.
- Text recognition now has rolling concurrency with ordered commits and bounded lookahead. A completed fast request releases a slot without waiting for the entire previous batch. Fresh-context cross-page review, role ordering, retry backoff, concurrency reduction on throttling and successful out-of-order checkpoints remain in place.
- Immutable source images are written once per page identity/hash. Snapshots avoid cloning page and diagram image strings; request-image preparation is cached per run with memory/entry limits and failed-entry eviction. Canvas encoding uses asynchronous blobs without reducing the existing image resolution or quality.
- Auto protocol negotiation is cached only after a successful, specifically justified fallback. Authentication, throttling, server failures and malformed successful responses no longer trigger speculative second-protocol requests. Timeouts and cancellation are propagated; Responses text blocks are joined rather than truncated at the first block. `RECOGNITION_TIMEOUT_MS` defaults to 180000.

## Automated and rendered checks

`npm run test:studio` executes the real parser/exporter/scheduler/transport modules and existing Studio regressions. At the implementation checkpoint, **140 tests passed, 0 failed**. The test runner expands file names itself and does not depend on shell wildcard behavior.

The real `buildStudioWord` exporter produced the DOCX from `tests/fixtures/math-contract.mjs`. Its two pages were rendered and inspected for sizes, arrows, five matrix families, nested grids, actual horizontal rules and left/center/right alignment. The renderer used installed substitute fonts for unavailable Word fonts; no font files are distributed. XML checks confirm editable math/table structures, consistent base sizes and non-mutation of the draft.

The full unmodified-project CI baseline had 219/227 passing tests. Several relevant stale fixtures and escape-repair defects were fixed in this branch. The complete `npm test` suite remains enabled in CI; consult that run rather than treating a focused-suite pass as a complete-project pass.

**Not verified here:** live model recognition, the user's actual handwriting/PDFs, browser interaction/IndexedDB execution, or Microsoft Word/WPS rendering. This environment's browser navigation was blocked by administrative policy. The optional browser harness below is supplied for local execution, not reported as passed.

## Reproducible performance measurement

```sh
npm run benchmark:studio
```

One measured run, with identical synthetic request latencies, 24 pages, 24 requests and a peak concurrency of 4:

| Scheduler | Elapsed |
| --- | ---: |
| Fixed batch barrier | 905 ms |
| Rolling ordered scheduler | 462 ms |

This is a **49% reduction in a simulated mixed-latency scheduling workload, not a 49% live-OCR claim**. Real gains depend on provider latency/limits and the proportion of pages needing fresh-context review. Model, reasoning settings and image fidelity have not been lowered. Repeated runs may differ because of host scheduling.

For a real comparison, use the same 10-20 pages and concurrency for both versions, repeat each at least three times, and record total wall time, first-page completion, request count, failures/retries, cross-page reviews, and recognition mistakes. The recognition route includes `Server-Timing` model/normalization durations. Test cold runs separately from resumptions; a cached/resumed run is not comparable with a full new import.

## Local acceptance checklist

1. Upload representative question-only, answer-only and paired material; include a page-spanning answer. Check ownership, order and completeness, not only speed.
2. Interrupt a run after several pages, reload and continue. Confirm saved successes are not re-recognized and source images remain available. Test a controlled endpoint failure without deleting the browser draft.
3. Export normal inline/display fractions, all arrow families, matrices, nested grids and a standalone ruled array. Open the result in Word/WPS and edit a formula/cell. Verify no rasterized math, merged adjacent tables or missing horizontal rules.
4. Insert an unsupported formula such as `\unknown{x}`. Formal export must refuse with a location. Only the separately labelled review copy may contain a visible correction placeholder.
5. Compare latency and request counts with the same model and concurrency. Raising concurrency above provider capacity is not an optimization and may increase 429 responses.

## Intentional math boundaries

Standalone ruled arrays are supported in the stem and analysis. **Ruled arrays inside inline prose, another equation/grid, a short-answer placement, a diagram caption or a table cell are rejected**, not silently flattened. Column types are `l/c/r` with supported whitespace material such as `@{\quad}`; arbitrary inter-column content, vertical rules, `p{...}`, custom row spacing, excess depth/rows/columns, and arrays wider than the page are rejected. These are explicit capability limits, not claims of complete LaTeX support.

## Optional real-browser harness

Uses the real React page, canvas, IndexedDB and browser DOCX download; only authentication/model HTTP responses are mocked. Requires Python Playwright and an installed Chromium executable. The harness contains synthetic data only.

```sh
node scripts/build-studio-browser.mjs .studio-browser-test
python -m pip install playwright
python -m playwright install chromium
python scripts/verify-studio-browser.py .studio-browser-test --out studio-browser-results
```

It exercises upload, checkpoint/reload, strict vs review export, desktop/mobile overflow, owner-isolated image storage and failed-transaction rollback. Browser results must be checked locally; this script has not passed in the restricted implementation environment.
