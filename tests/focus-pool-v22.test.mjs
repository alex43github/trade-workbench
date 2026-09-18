import test from "node:test";
import assert from "node:assert/strict";


function decideWatch({
  sources,
  structureWatch,
}) {
  const sourceDriven =
    sources.includes("C")
    || sources.includes("D");

  return {
    sourceDriven,
    watch15m:
      sourceDriven
        ? true
        : structureWatch,
  };
}


test(
  "C candidate remains monitored even when structure is invalid",
  () => {
    const result =
      decideWatch({
        sources: ["C"],
        structureWatch: false,
      });

    assert.equal(
      result.sourceDriven,
      true,
    );

    assert.equal(
      result.watch15m,
      true,
    );
  },
);

test(
  "D candidate remains monitored even when structure is invalid",
  () => {
    const result =
      decideWatch({
        sources: ["D"],
        structureWatch: false,
      });

    assert.equal(
      result.watch15m,
      true,
    );
  },
);


test(
  "A-only candidate still obeys structure eligibility for now",
  () => {
    const result =
      decideWatch({
        sources: ["A"],
        structureWatch: false,
      });

    assert.equal(
      result.sourceDriven,
      false,
    );

    assert.equal(
      result.watch15m,
      false,
    );
  },
);


test(
  "A+C resonance inherits C source-driven monitoring",
  () => {
    const result =
      decideWatch({
        sources: ["A", "C"],
        structureWatch: false,
      });

    assert.equal(
      result.watch15m,
      true,
    );
  },
);
