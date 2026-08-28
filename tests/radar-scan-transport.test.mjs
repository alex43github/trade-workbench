import assert from "node:assert/strict";
import test from "node:test";

import { isTransientScanTransportFailure } from "../lib/radar/scan-transport.ts";

test("classifies only transport-level failures as recoverable", () => {
  assert.equal(isTransientScanTransportFailure(null), true);
  assert.equal(isTransientScanTransportFailure(503), true);
  assert.equal(isTransientScanTransportFailure(401), false);
  assert.equal(isTransientScanTransportFailure(429), false);
});
