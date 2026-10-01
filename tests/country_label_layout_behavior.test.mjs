import assert from "node:assert/strict";
import test from "node:test";

import { buildCountryLabelCandidates, fitCountryLabel } from "../js/core/renderer/country_label_layout.js";

function rectangle(x, y, width, height) {
  return [[
    [x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y],
  ]];
}

function multiPolygon(...polygons) {
  return polygons;
}

function glyphs(text, metric) {
  return Array.from(text, (character) => ({ text: character, ...metric }));
}

test("country label candidates are deterministic and include straight, tilted, and shallow arc paths", () => {
  const geometry = multiPolygon(rectangle(0, 0, 120, 80));
  const first = buildCountryLabelCandidates(geometry);
  const second = buildCountryLabelCandidates(geometry);


  assert.deepEqual(first, second);
  assert.ok(first.some((candidate) => candidate.kind === "horizontal"));
  assert.ok(first.some((candidate) => candidate.kind === "tilted"));
  assert.ok(first.some((candidate) => candidate.kind === "arc"));
  assert.ok(first.every((candidate) => candidate.points.length >= 2 && candidate.length > 0));
});

test("measured English and CJK glyph metrics fit with returned per-glyph envelopes", () => {
  const geometry = multiPolygon(rectangle(-70, -45, 140, 90));
  const candidates = buildCountryLabelCandidates(geometry);
  const english = fitCountryLabel(candidates, {
    polygons: geometry,
    glyphs: glyphs("NORTH", { advance: 0.68, left: 0.04, right: 0.62, ascent: 0.72, descent: 0.03 }),
    minFontSize: 2,
    maxFontSize: 20,
    tracking: 0.04,
    glyphPadding: 0.08,
  });
  const cjk = fitCountryLabel(candidates, {
    polygons: geometry,
    glyphs: glyphs("中国", { advance: 1, left: 0.04, right: 0.92, ascent: 0.9, descent: 0.08 }),
    minFontSize: 2,
    maxFontSize: 20,
    tracking: 0.04,
    glyphPadding: 0.08,
  });

  assert.ok(english && english.fontSize > 2);
  assert.ok(cjk && cjk.fontSize > 2);
  for (const layout of [english, cjk]) {
    assert.equal(layout.glyphs.length > 0, true);
    for (const placed of layout.glyphs) {
      assert.deepEqual(Object.keys(placed.box).includes("x"), true);
      assert.deepEqual(Object.keys(placed.box).includes("y"), true);
      assert.ok(placed.box.w > 0 && placed.box.h > 0);
      assert.equal(placed.box.corners.length, 4);
      for (const point of placed.box.corners) {
        assert.ok(point[0] === undefined || Number.isFinite(point.x));
        assert.ok(point.x > -70 && point.x < 70);
        assert.ok(point.y > -45 && point.y < 45);
      }
    }
  }
});

test("exact ring-crossing checks reject glyph boxes over holes and concave notches", () => {
  const centerline = [{ polygonIndex: 0, kind: "horizontal", points: [{ x: 0, y: 20 }, { x: 100, y: 20 }], length: 100 }];
  const glyph = [{ text: "M", advance: 90, left: 0, right: 90, ascent: 5, descent: 5 }];
  const holeGeometry = multiPolygon([rectangle(0, 0, 100, 40)[0], rectangle(45, 16, 10, 8)[0]]);
  const concaveRing = [[0, 0], [100, 0], [100, 40], [80, 40], [80, 10], [20, 10], [20, 40], [0, 40], [0, 0]];
  const concaveGeometry = multiPolygon([concaveRing]);

  assert.equal(fitCountryLabel(centerline, { polygons: holeGeometry, glyphs: glyph, minFontSize: 1, maxFontSize: 1 }), null);
  assert.equal(fitCountryLabel(centerline, { polygons: concaveGeometry, glyphs: glyph, minFontSize: 1, maxFontSize: 1 }), null);
});

test("descending fit search finds a larger valid size when minimum glyphs land in a narrow hole", () => {
  const candidate = [{ polygonIndex: 0, kind: "horizontal", points: [{ x: 0, y: 20 }, { x: 100, y: 20 }], length: 100 }];
  const geometry = multiPolygon([rectangle(0, 0, 100, 40)[0], rectangle(49.2, 19, 0.3, 2)[0]]);
  const metrics = [
    { text: "a", advance: 1, left: 0, right: 0.2, ascent: 0.8, descent: 0.1 },
    { text: "b", advance: 1, left: 0, right: 0.2, ascent: 0.8, descent: 0.1 },
    { text: "c", advance: 1, left: 0, right: 0.2, ascent: 0.8, descent: 0.1 },
  ];

  assert.equal(fitCountryLabel(candidate, { polygons: geometry, glyphs: metrics, minFontSize: 2, maxFontSize: 2 }), null);
  const fitted = fitCountryLabel(candidate, { polygons: geometry, glyphs: metrics, minFontSize: 2, maxFontSize: 8 });
  assert.ok(fitted);
  assert.equal(fitted.fontSize, 8);
});

test("thin polygons reject labels whose padded glyph envelope cannot fit", () => {
  const geometry = multiPolygon(rectangle(0, 0, 100, 3));
  const candidates = buildCountryLabelCandidates(geometry);
  const fitted = fitCountryLabel(candidates, {
    polygons: geometry,
    glyphs: [{ text: "I", advance: 1, left: 0.05, right: 0.8, ascent: 0.8, descent: 0.2 }],
    minFontSize: 5,
    maxFontSize: 12,
  });
  assert.equal(fitted, null);
});

test("candidate generation stays on significant land components without bridging islands", () => {
  const geometry = multiPolygon(
    rectangle(0, 0, 100, 100),
    rectangle(200, 0, 30, 30),
    rectangle(990, 0, 2, 2),
  );
  const candidates = buildCountryLabelCandidates(geometry);
  assert.ok(candidates.some((candidate) => candidate.polygonIndex === 0));
  assert.ok(candidates.some((candidate) => candidate.polygonIndex === 1));
  assert.ok(candidates.every((candidate) => candidate.polygonIndex !== 2));

  const acrossOcean = [{ polygonIndex: 0, kind: "horizontal", points: [{ x: 0, y: 5 }, { x: 1000, y: 5 }], length: 1000 }];
  const rejected = fitCountryLabel(acrossOcean, {
    polygons: geometry,
    glyphs: [{ text: "W", advance: 20, left: 0, right: 20, ascent: 4, descent: 1 }],
    minFontSize: 1,
    maxFontSize: 1,
  });
  assert.equal(rejected, null);
});

test("a diagonal narrow country can fit along its principal axis", () => {
  const center = { x: 100, y: 100 };
  const axis = { x: 0.5, y: Math.sqrt(3) / 2 };
  const normal = { x: -axis.y, y: axis.x };
  const corners = [
    [1, 1], [1, -1], [-1, -1], [-1, 1],
  ].map(([along, across]) => [
    center.x + axis.x * along * 50 + normal.x * across * 10,
    center.y + axis.y * along * 50 + normal.y * across * 10,
  ]);
  corners.push(corners[0]);
  const geometry = multiPolygon([corners]);
  const candidates = buildCountryLabelCandidates(geometry, { maxCandidates: 32 });
  const fitted = fitCountryLabel(candidates, {
    polygons: geometry,
    glyphs: glyphs("COUNTRY", { advance: 0.72, left: 0.03, right: 0.66, ascent: 0.68, descent: 0.08 }),
    minFontSize: 1,
    maxFontSize: 10,
    tracking: 0.03,
  });

  assert.ok(fitted, "a principal-axis candidate should fit the narrow region");
  assert.ok(fitted.glyphs.some((placed) => Math.abs(placed.angle) >= Math.PI / 4), `expected a steep label, got ${fitted.glyphs.map((placed) => placed.angle)}`);
  assert.ok(fitted.glyphs.every((placed) => Math.abs(placed.angle) <= 75 * Math.PI / 180));
});

test("arc layouts produce changing glyph angles while respecting adjacent and total bend limits", () => {
  const geometry = multiPolygon(rectangle(0, 0, 100, 60));
  const arcs = buildCountryLabelCandidates(geometry).filter((candidate) => candidate.kind === "arc");
  const fitted = fitCountryLabel(arcs, {
    polygons: geometry,
    glyphs: glyphs("CURVE", { advance: 0.62, left: 0.03, right: 0.58, ascent: 0.68, descent: 0.08 }),
    minFontSize: 2,
    maxFontSize: 12,
    maxBendDegrees: 60,
    maxAdjacentAngleDegrees: 12,
  });

  assert.ok(fitted);
  assert.equal(fitted.candidateKind, "arc");
  const angles = fitted.glyphs.map((placed) => placed.angle);
  assert.ok(Math.max(...angles) - Math.min(...angles) > 0.005);
  assert.ok(Math.max(...angles) - Math.min(...angles) <= Math.PI / 3 + 1e-8);
  assert.ok(angles.slice(1).every((angle, index) => Math.abs(angle - angles[index]) <= 12 * Math.PI / 180 + 1e-8));
});
