import assert from "node:assert/strict";
import test from "node:test";

import { KlineWebSocketFeed } from "../services/structure-radar/websocket-feed.ts";
import { feedHealthStatus } from "../services/structure-radar/runtime.ts";

function fakeClock() {
  let now = 0;
  let nextHandle = 1;
  const timers = new Map();
  return {
    now: () => now,
    schedule(callback, milliseconds) {
      const handle = nextHandle++;
      timers.set(handle, { callback, at: now + milliseconds });
      return handle;
    },
    cancel(handle) { timers.delete(handle); },
    advance(milliseconds) {
      now += milliseconds;
      while (true) {
        const ready = [...timers.entries()].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!ready) break;
        timers.delete(ready[0]);
        ready[1].callback();
      }
    },
    pending: () => timers.size,
  };
}

function fakeSocketFactory(sockets) {
  return () => {
    const listeners = {};
    const socket = {
      addEventListener(type, callback) { listeners[type] = callback; },
      close() { listeners.close?.({ code: 1000 }); },
      emit(type, event = {}) { listeners[type]?.(event); },
    };
    sockets.push(socket);
    return socket;
  };
}

function createFeed(clock, sockets, statuses = []) {
  return new KlineWebSocketFeed({
    batches: [["btcusdt@kline_1h"]],
    now: clock.now,
    staleAfterMs: 10,
    socketFactory: fakeSocketFactory(sockets),
    schedule: clock.schedule,
    cancelSchedule: clock.cancel,
    onEvent() {},
    onStatus(status) { statuses.push(status); },
  });
}

test("error without close schedules exactly one bounded reconnect", () => {
  const clock = fakeClock();
  const sockets = [];
  const feed = createFeed(clock, sockets);
  feed.start();
  sockets[0].emit("open");
  sockets[0].emit("error");
  sockets[0].emit("error");
  assert.equal(clock.pending(), 1);
  clock.advance(500);
  assert.equal(sockets.length, 2);
  feed.stop();
});

test("silent open batch is recycled, while message activity resets its watchdog", () => {
  const clock = fakeClock();
  const sockets = [];
  const feed = createFeed(clock, sockets);
  feed.start();
  sockets[0].emit("open");
  clock.advance(9);
  sockets[0].emit("message", { data: JSON.stringify({ sequence: 1 }) });
  clock.advance(9);
  assert.equal(sockets.length, 1);
  clock.advance(1);
  assert.equal(clock.pending(), 1);
  clock.advance(500);
  assert.equal(sockets.length, 2);
  feed.stop();
});

test("duplicate recovery signals and stop do not leave recovery behind", () => {
  const clock = fakeClock();
  const sockets = [];
  const feed = createFeed(clock, sockets);
  feed.start();
  sockets[0].emit("open");
  sockets[0].emit("error");
  sockets[0].emit("close");
  clock.advance(10);
  assert.equal(clock.pending(), 1);
  feed.stop();
  assert.equal(clock.pending(), 0);
  clock.advance(5_000);
  assert.equal(sockets.length, 1);
});

test("feed health fails closed for stale aggregate or one stale batch while another stays active", () => {
  const now = 1_000;
  const healthy = { startedAt: new Date(now - 100).toISOString(), lastActivityAt: new Date(now - 1).toISOString(), batches: [{ batch: 0, state: "open", updatedAt: new Date(now - 1).toISOString(), lastActivityAt: new Date(now - 1).toISOString() }], now, staleAfterMs: 10, graceMs: 20 };
  assert.equal(feedHealthStatus(healthy), "ok");
  assert.equal(feedHealthStatus({ ...healthy, lastActivityAt: new Date(now - 11).toISOString() }), "degraded");
  assert.equal(feedHealthStatus({ ...healthy, batches: [
    { batch: 0, state: "open", updatedAt: new Date(now - 1).toISOString(), lastActivityAt: new Date(now - 11).toISOString() },
    { batch: 1, state: "open", updatedAt: new Date(now - 1).toISOString(), lastActivityAt: new Date(now - 1).toISOString() },
  ] }), "degraded");
  assert.equal(feedHealthStatus({ ...healthy, batches: [{ batch: 0, state: "error", updatedAt: new Date(now - 21).toISOString(), lastActivityAt: new Date(now - 1).toISOString() }] }), "degraded");
  assert.equal(feedHealthStatus({ ...healthy, startedAt: new Date(now - 1).toISOString(), batches: [{ batch: 0, state: "connecting", updatedAt: new Date(now - 21).toISOString(), lastActivityAt: null }] }), "ok");
  assert.equal(feedHealthStatus({ ...healthy, startedAt: new Date(now - 21).toISOString(), batches: [{ batch: 0, state: "connecting", updatedAt: new Date(now - 21).toISOString(), lastActivityAt: null }] }), "degraded");
});
