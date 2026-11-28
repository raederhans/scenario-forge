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

test("long names can wrap into two complete horizontal lines without splitting English words", () => {
  for (const [text, width, advance] of [["澳大利亚联邦", 42, 1], ["Northern Republic", 85, 0.6]]) {
    const polygons = multiPolygon(rectangle(0, 0, width, 60));
    const options = { polygons, glyphs: glyphs(text, { advance, left: 0, right: advance, ascent: 0.8, descent: 0.1 }),
      minFontSize: 1, maxFontSize: 12, glyphPadding: 0.04, allowMultiline: true };
    const fit = fitCountryLabel(buildCountryLabelCandidates(polygons), options);
    assert.equal(fit.lineCount, 2);
    assert.equal(fit.glyphs.map(g => g.text).join(""), text);
    assert.ok(fit.glyphs.every(g => g.angle === 0));
    if (text.includes(" ")) {
      const lines = new Map();
      for (const g of fit.glyphs) lines.set(g.y, (lines.get(g.y) || "") + g.text);
      assert.deepEqual([...lines.values()].map(s => s.trim()), ["Northern", "Republic"]);
    }
    const single = fitCountryLabel(buildCountryLabelCandidates(polygons), { ...options, allowMultiline: false });
    assert.ok(fit.fontSize > single.fontSize);
  }
  const polygons = multiPolygon(rectangle(0, 0, 40, 60));
  const fit = fitCountryLabel(buildCountryLabelCandidates(polygons), { polygons,
    glyphs: glyphs("Unbroken", { advance: 1, left: 0, right: 1, ascent: 0.8, descent: 0.1 }),
    minFontSize: 1, maxFontSize: 12, allowMultiline: true });
  assert.equal(fit.lineCount, 1);
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
