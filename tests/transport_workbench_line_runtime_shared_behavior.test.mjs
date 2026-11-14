import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTransportWorkbenchProjectedLines,
  createTransportWorkbenchLinePathD,
  findTransportWorkbenchDatasetNode,
  keepFirstTransportWorkbenchGridBucket,
  measureTransportWorkbenchProjectedLineLength,
} from "../js/ui/transport_workbench/transport_workbench_line_runtime_shared.js";

test("line runtime shared helpers keep path and length output deterministic", () => {
  const geometry = {
    type: "MultiLineString",
    coordinates: [
      [[0, 0], [3, 4]],
      [[10, 10], [13, 14], [13, 18]],
    ],
  };

  assert.equal(createTransportWorkbenchLinePathD(geometry), "M 0 0 L 3 4 M 10 10 L 13 14 L 13 18");
  assert.equal(measureTransportWorkbenchProjectedLineLength(geometry), 14);
  assert.deepEqual(buildTransportWorkbenchProjectedLines(geometry), [
    {
      points: [[0, 0], [3, 4]],
      pathD: "M 0 0 L 3 4",
      length: 5,
      segments: [
        {
          start: [0, 0],
          end: [3, 4],
          startDistance: 0,
          length: 5,
          angle: 53.13010235415598,
        },
      ],
    },
    {
      points: [[10, 10], [13, 14], [13, 18]],
      pathD: "M 10 10 L 13 14 L 13 18",
      length: 9,
      segments: [
        {
          start: [10, 10],
          end: [13, 14],
          startDistance: 0,
          length: 5,
          angle: 53.13010235415598,
        },
        {
          start: [13, 14],
          end: [13, 18],
          startDistance: 5,
          length: 4,
          angle: 90,
        },
      ],
    },
  ]);
});

test("line runtime shared helpers keep single LineString output deterministic", () => {
  const geometry = {
    type: "LineString",
    coordinates: [[1, 2], [4, 6], [4, 9]],
  };

  assert.equal(createTransportWorkbenchLinePathD(geometry), "M 1 2 L 4 6 L 4 9");
  assert.equal(measureTransportWorkbenchProjectedLineLength(geometry), 8);
  assert.deepEqual(buildTransportWorkbenchProjectedLines(geometry), [
    {
      points: [[1, 2], [4, 6], [4, 9]],
      pathD: "M 1 2 L 4 6 L 4 9",
      length: 8,
      segments: [
        {
          start: [1, 2],
          end: [4, 6],
          startDistance: 0,
          length: 5,
          angle: 53.13010235415598,
        },
        {
          start: [4, 6],
          end: [4, 9],
          startDistance: 5,
          length: 3,
          angle: 90,
        },
      ],
    },
  ]);
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

test("dataset helper uses closest and stays inside the preview group boundary", () => {
  class FakeElement {}
  const root = new FakeElement();
  const line = new FakeElement();
  const child = new FakeElement();
  const outside = new FakeElement();
  const doc = { defaultView: { Element: FakeElement } };

  root.ownerDocument = doc;
  line.ownerDocument = doc;
  child.ownerDocument = doc;
  outside.ownerDocument = doc;
  line.dataset = { railLineId: "line-1" };
  outside.dataset = { railLineId: "outside" };
  child.parentElement = line;
  root.contains = (node) => node === line || node === child;
  child.closest = (selector) => selector === "[data-rail-line-id]" ? line : null;
  outside.closest = () => outside;

  assert.equal(findTransportWorkbenchDatasetNode(child, "railLineId", root), line);
  assert.equal(findTransportWorkbenchDatasetNode(outside, "railLineId", root), null);
});
