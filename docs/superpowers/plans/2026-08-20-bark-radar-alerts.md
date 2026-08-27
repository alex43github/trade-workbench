# Bark and Radar Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add safe, deduplicated Bark notifications for paper/observed position events and newly discovered radar candidates, and add a manual trigger for the 4H/daily breakdown-reversal scan.

**Architecture:** Reuse the existing D1-backed `sendBarkOnce` delivery store. Trade routes emit exact paper events; the trade terminal emits read-only account transition events. Radar scan routes compare the newly built candidate set with the previous snapshot before sending one notification per new candidate. The reversal page triggers both intervals through the existing low-concurrency scan route.

**Tech Stack:** TypeScript, Next.js/Vinext route handlers, Cloudflare D1-compatible SQL, React, Node test runner.

**Global Constraints:** Bark is notification-only. No order endpoint is called by alert code. Existing low-concurrency public data fetchers and authorization checks remain unchanged. Secrets never appear in response bodies or UI.

## Task 1: Define notification behavior with failing tests

**Files:** Create `tests/bark-alerts.test.mjs`; modify only if needed after the first failing run.

1. Add tests for Bark endpoint resolution from `BARK_BASE_URL` and the existing `BARK_API_KEY`/server fallback without exposing the key in the notification payload.
2. Add tests for trade event title/body mapping and stable dedupe keys for BUY, SELL, TAKE_PROFIT, and STOP_LOSS.
3. Add tests that calculate new MA30/OI and reversal candidates by comparing current and previous candidate keys.
4. Run `node --test tests/bark-alerts.test.mjs`; confirm it fails because the new helpers do not exist yet.

## Task 2: Add shared Bark event and candidate notification helpers

**Files:** Create `lib/notifications/bark.ts`, `lib/radar/alert-diff.ts`; reuse `lib/advisory/notifications.ts`.

1. Implement a single Bark base URL resolver supporting the existing full `BARK_BASE_URL` and the configured API-key fallback.
2. Implement trade event formatting and a D1-backed `notifyTradeEvent` wrapper around `sendBarkOnce`.
3. Implement deterministic candidate-key and set-diff helpers for MA30/OI and reversal results.
4. Keep missing Bark configuration as a recorded/skipped delivery, never as a thrown scan or order error.
5. Run the focused tests and confirm they pass.

## Task 3: Notify on paper events and observed account transitions

**Files:** Modify `app/api/paper/order/route.ts`, `app/api/paper/close/route.ts`, `app/trade/TradingTerminal.tsx`; create `app/api/trade/notifications/route.ts` if needed.

1. After a successful paper open, send a BUY notification; after a successful manual close, map the close reason to SELL, TAKE_PROFIT, or STOP_LOSS and send the corresponding notification.
2. Add a small authenticated-by-same-origin event route for the read-only terminal to report position appearance/disappearance transitions, with stable event IDs and no order side effects.
3. In the terminal polling effect, compare the previous account position map with the current map and report new positions and closed positions once per transition. Closed read-only positions are labeled for manual confirmation when the exchange does not expose the exact fill reason in the current payload.
4. Make notification failures non-blocking and preserve the existing trading UI behavior.
5. Add/extend route and terminal tests for event mapping and deduplication.

## Task 4: Notify on newly discovered radar candidates

**Files:** Modify `app/api/radar/ma30-oi/route.ts`, `app/api/radar/reversal/route.ts`; reuse `lib/radar/ma30-oi-snapshot.ts`, `lib/radar/reversal-snapshot.ts`.

1. Load the previous ready snapshot/dashboard before each scan.
2. After a successful scan and persistence, diff current candidates against the previous candidate keys.
3. Send one Bark notification per newly appearing MA30/OI symbol and per newly appearing reversal signal (`symbol + interval + direction + signalTime`).
4. Return non-secret notification counts/status in scan responses so the UI and diagnostics can show whether alerts were sent, skipped, or failed.
5. Preserve existing job/manual authorization, global running guards, archive writes, and low-frequency fetch pacing.
6. Add tests covering first scan, repeat scan, and a new signal for an existing symbol.

## Task 5: Add manual reversal scanning to the radar UI

**Files:** Modify `app/radar/page.tsx`, `app/globals.css`.

1. Add a `reversalScanning` state and a local manual POST action that requests both 4H and 1D scans.
2. Add a clearly visible button beside the reversal status; disable it while running and show a low-frequency/waiting status.
3. Refresh both directional lists and archive counts from the response; show the Bark reminder mode without displaying credentials.
4. Keep the existing scheduled maintenance path unchanged.

## Task 6: Verify the integrated feature

**Files:** No new files.

1. Run `node --test tests/bark-alerts.test.mjs`.
2. Run `npm test`.
3. Run `npm run lint` and `npm run build` if the test script does not already complete the build cleanly.
4. Inspect the final diff and report any environment-only limitation separately from code failures.
