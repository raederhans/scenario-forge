import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTransportWorkbenchProjectedLines,
  createTransportWorkbenchLinePathD,
  keepFirstTransportWorkbenchGridBucket,
  measureTransportWorkbenchProjectedLineLength,
} from "../js/ui/transport_workbench/transport_workbench_line_runtime_shared.js";

test("projected length sums the segments of a MultiLineString", () => {
  const geometry = {
    type: "MultiLineString",
    coordinates: [
      [[0, 0], [3, 4]],
      [[10, 10], [13, 14], [13, 18]],
    ],
  };

  assert.equal(measureTransportWorkbenchProjectedLineLength(geometry), 14);
});

test("line runtime shared helpers treat malformed coordinates as empty geometry", () => {
  const malformedLine = { type: "LineString", coordinates: null };
  const malformedMultiLine = { type: "MultiLineString", coordinates: { bad: true } };

  assert.equal(createTransportWorkbenchLinePathD(malformedLine), "");
  assert.equal(createTransportWorkbenchLinePathD(malformedMultiLine), "");
  assert.equal(measureTransportWorkbenchProjectedLineLength(malformedLine), 0);
  assert.deepEqual(buildTransportWorkbenchProjectedLines(malformedMultiLine), []);
});

test("grid helper keeps the first ranked entry per bucket", () => {
  const entries = [
    { id: "a", roadClass: "primary", screenPoint: { x: 10, y: 20 } },
    { id: "b", roadClass: "primary", screenPoint: { x: 12, y: 22 } },
    { id: "c", roadClass: "trunk", screenPoint: { x: 12, y: 22 } },
    { id: "d", roadClass: "primary", screenPoint: { x: 180, y: 20 } },
  ];

  assert.deepEqual(
    keepFirstTransportWorkbenchGridBucket(entries, {
      gridSize: 100,
      getScreenPoint: (entry) => entry.screenPoint,
      getBucketParts: (entry) => [entry.roadClass],
    }).map((entry) => entry.id),
    ["a", "c", "d"],
  );
});
