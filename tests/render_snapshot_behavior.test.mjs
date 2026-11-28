import assert from "node:assert/strict";
import test from "node:test";
import {
  RENDER_SNAPSHOT_ERROR,
  RENDER_SNAPSHOT_KIND,
  RENDER_SNAPSHOT_SCHEMA_VERSION,
  createRenderSnapshot,
  getRenderSnapshotIdentity,
  parseRenderSnapshot,
} from "../js/core/renderer/render_snapshot.js";

function createSnapshot(overrides = {}) {
  return createRenderSnapshot({
    palette: {
      sovereignBaseColors: { ZED: "#ffffff", AAA: "#000000" },
    },
    ownership: {
      sovereigntyByFeatureId: { feature_z: "ZED", feature_a: "AAA" },
    },
    viewport: {
      transform: { x: 12, y: -4, k: 1.5 },
      renderSignature: "800|600|2",
      projectionSignature: "100|400|300",
      geoBounds: [-20, -10, 30, 40],
    },
    ...overrides,
  });
}

test("render snapshot v1 normalizes sorted maps and deeply freezes declared render inputs", () => {
  const snapshot = createSnapshot();

  assert.equal(snapshot.schemaVersion, RENDER_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(snapshot.kind, RENDER_SNAPSHOT_KIND);
  assert.deepEqual(Object.keys(snapshot.palette.sovereignBaseColors), ["AAA", "ZED"]);
  assert.deepEqual(Object.keys(snapshot.ownership.sovereigntyByFeatureId), ["feature_a", "feature_z"]);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.palette.sovereignBaseColors), true);
  assert.equal(Object.isFrozen(snapshot.viewport.transform), true);
  assert.equal(Object.isFrozen(snapshot.viewport.geoBounds), true);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), {
    schemaVersion: 1,
    kind: "render-snapshot",
    palette: { sovereignBaseColors: { AAA: "#000000", ZED: "#ffffff" } },
    ownership: { sovereigntyByFeatureId: { feature_a: "AAA", feature_z: "ZED" } },
    viewport: {
      transform: { x: 12, y: -4, k: 1.5 },
      renderSignature: "800|600|2",
      projectionSignature: "100|400|300",
      geoBounds: [-20, -10, 30, 40],
    },
  });
});

test("strict parsing rejects future versions and non-finite transforms", () => {
  const snapshot = createSnapshot();

  assert.throws(
    () => parseRenderSnapshot({ ...snapshot, schemaVersion: 2 }),
    (error) => error.code === RENDER_SNAPSHOT_ERROR.VERSION_UNSUPPORTED,
  );
  assert.throws(
    () => createRenderSnapshot({ ...snapshot, viewport: { ...snapshot.viewport, transform: { x: Infinity, y: 0, k: 1 } } }),
    (error) => error.code === RENDER_SNAPSHOT_ERROR.INVALID,
  );
});

test("canonical render snapshot identity is stable across source record insertion order", () => {
  const left = createSnapshot();
  const right = createRenderSnapshot({
    palette: { sovereignBaseColors: { AAA: "#000000", ZED: "#ffffff" } },
    ownership: { sovereigntyByFeatureId: { feature_a: "AAA", feature_z: "ZED" } },
    viewport: left.viewport,
  });

  assert.equal(getRenderSnapshotIdentity(left), getRenderSnapshotIdentity(right));
});
