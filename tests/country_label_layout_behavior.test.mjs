import assert from "node:assert/strict";
import test from "node:test";

import { buildCountryLabelCandidates, filterCountryLabelHoles, fitCountryLabel } from "../js/core/renderer/country_label_layout.js";
import { createCountryLabelLayoutWorkerHandler } from "../js/core/renderer/country_label_layout_worker.js";

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

test("three components retain both gentle arc directions inside the default candidate budget", () => {
  for (const polygons of [
    multiPolygon(rectangle(0, 0, 260, 100), rectangle(300, 0, 220, 90), rectangle(560, 0, 180, 80)),
    multiPolygon([[[0, 0], [240, 0], [260, 100], [20, 100], [0, 0]]],
      [[[300, 0], [500, 0], [520, 90], [320, 90], [300, 0]]],
      [[[560, 0], [720, 0], [740, 80], [580, 80], [560, 0]]]),
  ]) {
    const candidates = buildCountryLabelCandidates(polygons, { allowArcs: true });
    assert.ok(candidates.length <= 16);
    for (let polygonIndex = 0; polygonIndex < 3; polygonIndex += 1) {
      const arcs = candidates.filter((candidate) => candidate.polygonIndex === polygonIndex && candidate.kind === "arc");
      assert.ok(arcs.some((candidate) => candidate.curvature < 0), `component ${polygonIndex} retains its upward arc`);
      assert.ok(arcs.some((candidate) => candidate.curvature > 0), `component ${polygonIndex} retains its downward arc`);
      assert.ok(candidates.some((candidate) => candidate.polygonIndex === polygonIndex && candidate.kind === "horizontal"));
    }
  }
});

test("wide territories can select a readable gentle arc without losing size or boundary containment", () => {
  const polygons = multiPolygon(rectangle(0, 0, 300, 120));
  const candidates = buildCountryLabelCandidates(polygons, { allowArcs: true });
  const options = { polygons, glyphs: glyphs("United States", { advance: 0.7, left: 0.03, right: 0.65, ascent: 0.8, descent: 0.1 }),
    minFontSize: 2, maxFontSize: 20, readableFontSize: 10, maxAlternatives: 3, allowArcs: true,
    maxArcTiltDegrees: 10, maxArcBendDegrees: 14 };
  const flat = fitCountryLabel(candidates, options);
  assert.equal(flat.candidateKind, "horizontal");
  const curved = fitCountryLabel(candidates, { ...options, preferGentleArcs: true, minArcComponentArea: 20000 });
  assert.equal(curved.candidateKind, "arc", "the arc preference changes the chosen fit, not just the available candidates");
  assert.ok(curved.fontSize >= flat.fontSize * 0.94);
  assert.ok(curved.fontSize >= 10);
  const angles = curved.glyphs.filter((glyph) => glyph.text.trim()).map((glyph) => glyph.angle);
  assert.ok(Math.max(...angles) - Math.min(...angles) > 0.02);
  assert.ok(angles.every((angle) => Math.abs(angle) <= 10 * Math.PI / 180 + 1e-8));
  assert.ok(Math.max(...angles) - Math.min(...angles) <= 14 * Math.PI / 180 + 1e-8);
  for (const glyph of curved.glyphs.filter((glyph) => glyph.text.trim())) {
    assert.ok(glyph.box.corners.every(({ x, y }) => x > 0 && x < 300 && y > 0 && y < 120));
  }
  assert.equal(fitCountryLabel(candidates, { ...options, preferGentleArcs: true, minArcComponentArea: 40000 }).candidateKind, "horizontal",
    "territories below the explicit size threshold retain ordinary scoring");
  assert.equal(fitCountryLabel(candidates, { ...options, preferGentleArcs: true,
    glyphs: glyphs("US", { advance: 0.7, left: 0.03, right: 0.65, ascent: 0.8, descent: 0.1 }) }).candidateKind, "horizontal",
    "short text stays flat even on a large territory");
});

test("irregular broad territories reserve their angle budget for a gentle bend", () => {
  const polygons = [[[[0, 0], [280, 90], [270, 210], [-10, 120], [0, 0]]]];
  const candidates = buildCountryLabelCandidates(polygons, { allowArcs: true });
  const arcs = candidates.filter(candidate => candidate.kind === "arc");
  assert.ok(arcs.some(candidate => candidate.curvature < 0));
  assert.ok(arcs.some(candidate => candidate.curvature > 0));
  assert.ok(arcs.every(candidate => Math.abs(candidate.angle) <= 3 * Math.PI / 180 + 1e-8));
  assert.ok(arcs.every(candidate => Math.abs(candidate.curvature) === 0.24));
  const fit = fitCountryLabel(candidates, { polygons,
    glyphs: glyphs("United States", { advance: 0.7, left: 0.03, right: 0.65, ascent: 0.8, descent: 0.1 }),
    minFontSize: 2, maxFontSize: 20, readableFontSize: 10, maxAlternatives: 3,
    allowArcs: true, preferGentleArcs: true, maxArcTiltDegrees: 15, maxArcBendDegrees: 22 });
  assert.equal(fit.candidateKind, "arc");
  assert.equal(fit.fontSize, 20);
  const visible = fit.glyphs.filter(glyph => glyph.text.trim());
  const angles = visible.map(glyph => glyph.angle);
  assert.ok(angles.every(angle => Math.abs(angle) <= 15 * Math.PI / 180 + 1e-8));
  assert.ok(Math.max(...angles) - Math.min(...angles) <= 22 * Math.PI / 180 + 1e-8);
  for (const glyph of visible) for (const { x, y } of glyph.box.corners) {
    assert.ok(y > x * 90 / 280 && y < x * 90 / 280 + 123.2142857143);
    assert.ok(x > -y / 12 && x < 287.5 - y / 12);
  }
});

test("position scoring selects inset center-near fits over remote equal-size cached candidates", () => {
  const polygons = multiPolygon(rectangle(0, 0, 160, 120));
  const candidates = [20, 60].map((y) => ({ polygonIndex: 0, kind: "horizontal", points: [{ x: 10, y }, { x: 150, y }] }));
  const options = { polygons, glyphs: glyphs("COUNTRY", { advance: 0.7, left: 0, right: 0.65, ascent: 0.8, descent: 0.1 }),
    minFontSize: 1, maxFontSize: 16, preferredCandidateIndex: 0 };
  const single = fitCountryLabel(candidates, options);
  const withAlternatives = fitCountryLabel(candidates, { ...options, maxAlternatives: 3 });
  assert.equal(single.candidateIndex, 1);
  assert.equal(withAlternatives.candidateIndex, 1);
  assert.equal(single.fontSize, 16);
  assert.ok(Math.abs((single.bounds.minY + single.bounds.maxY) / 2 - 60) < 1e-8);
  assert.ok(single.bounds.minY > 45 && single.bounds.maxY < 75, "the chosen ink retains visible inner margins");
});

test("gentle arc preference leaves narrow territories and multiline names naturally flat", () => {
  for (const [text, width, height] of [["COUNTRY", 80, 28], ["United States of America", 65, 65]]) {
    const polygons = multiPolygon(rectangle(0, 0, width, height));
    const fit = fitCountryLabel(buildCountryLabelCandidates(polygons, { allowArcs: true }), { polygons,
      glyphs: glyphs(text, { advance: 0.7, left: 0, right: 0.65, ascent: 0.8, descent: 0.1 }),
      minFontSize: 1, maxFontSize: 18, readableFontSize: 10, maxAlternatives: 3,
      allowArcs: true, preferGentleArcs: true, allowMultiline: true, maxArcTiltDegrees: 10, maxArcBendDegrees: 14 });
    assert.equal(fit.candidateKind, "horizontal");
    if (text.includes(" ")) assert.equal(fit.lineCount, 3);
  }
});

test("larger main territories retain their own readable fits when overseas positions have larger fonts", () => {
  const polygons = multiPolygon(rectangle(220, 0, 160, 80), rectangle(0, 0, 120, 120), rectangle(440, 0, 40, 40));
  const candidates = [16, 32, 48, 64].map((y) => ({ polygonIndex: 0, kind: "horizontal", points: [{ x: 230, y }, { x: 370, y }] }));
  candidates.push(...[40, 70].map((y) => ({ polygonIndex: 1, kind: "horizontal", points: [{ x: 10, y }, { x: 110, y }] })));
  candidates.push({ polygonIndex: 2, kind: "horizontal", points: [{ x: 442, y: 20 }, { x: 478, y: 20 }] });
  const options = { polygons, glyphs: glyphs("COUNTRY", { advance: 1, left: 0, right: 0.9, ascent: 0.7, descent: 0.1 }),
    minFontSize: 1, maxFontSize: 20, readableFontSize: 10, maxAlternatives: 3, preferredCandidateIndex: 0 };
  const fit = fitCountryLabel(candidates, options);
  assert.equal(fit.polygonIndex, 1, "the larger readable mainland wins independently of larger overseas lettering");
  assert.deepEqual(fit.componentFits.map((component) => component.polygonIndex), [1, 0, 2]);
  const overseas = fit.componentFits.find((component) => component.polygonIndex === 0);
  assert.ok(overseas.fontSize > fit.fontSize);
  assert.ok(overseas.alternatives.length >= 1 && overseas.alternatives.length <= 3);
  assert.ok(fit.alternatives.length >= 1 && fit.alternatives.length <= 3, "each component retains its own safe retry budget");
  for (const component of fit.componentFits) {
    assert.equal(component.componentFits, undefined);
    assert.ok(component.alternatives.length <= 3);
    for (const placement of [component, ...component.alternatives]) {
      assert.equal(placement.polygonIndex, component.polygonIndex);
      assert.equal(placement.glyphs.map((glyph) => glyph.text).join(""), "COUNTRY");
    }
  }
  const onlyOverseasReadable = fitCountryLabel(candidates, { ...options, readableFontSize: 20 });
  assert.equal(onlyOverseasReadable.polygonIndex, 0, "a readable component still precedes a larger unreadable component");
  const compact = fitCountryLabel(candidates, { ...options, maxAlternatives: 0 });
  assert.equal(compact.polygonIndex, 1);
  assert.equal(compact.componentFits, undefined);
  const withSmallOverseasHole = multiPolygon([polygons[0][0], rectangle(300, 30, 0.4, 0.4)[0]], polygons[1], polygons[2]);
  const filtered = fitCountryLabel(candidates, { ...options, polygons: withSmallOverseasHole, minHoleArea: 0.25 });
  assert.equal(filtered.minHoleArea, 0, "the mainland's strict fit is not marked as filtered by an overseas hole");
  assert.equal(filtered.componentFits.find((component) => component.polygonIndex === 0).minHoleArea, 0.25);
});

test("an overseas readable line cannot suppress mainland wrapping in either language", () => {
  for (const [text, width, advance] of [["澳大利亚联邦", 42, 1], ["BRITISH RAJ", 60, 0.65]]) {
    const polygons = multiPolygon(rectangle(200, 0, 260, 100), rectangle(0, 0, width, 60));
    const options = { polygons, glyphs: glyphs(text, { advance, left: 0, right: advance * 0.95, ascent: 0.8, descent: 0.1 }),
      minFontSize: 1, maxFontSize: 20, readableFontSize: 10, maxAlternatives: 3, allowMultiline: true };
    const fit = fitCountryLabel(buildCountryLabelCandidates(polygons), options);
    assert.equal(fit.componentFits.find((component) => component.polygonIndex === 0).lineCount, 1);
    const mainland = fit.componentFits.find((component) => component.polygonIndex === 1);
    assert.equal(mainland.lineCount, 2, `${text} wraps within its own mainland component`);
    assert.ok(mainland.fontSize >= 10);
    assert.equal(mainland.glyphs.map((glyph) => glyph.text).join(""), text);
    for (const glyph of mainland.glyphs.filter((glyph) => glyph.text.trim())) {
      assert.ok(glyph.box.corners.every(({ x, y }) => x > 0 && x < width && y > 0 && y < 60));
    }
  }
});

test("long English names use three word-preserving lines only after single and double lines miss readability", () => {
  const text = "United States of America";
  const polygons = multiPolygon(rectangle(0, 0, 80, 65));
  const candidates = [{ polygonIndex: 0, kind: "horizontal", points: [{ x: 5, y: 32.5 }, { x: 75, y: 32.5 }] }];
  const options = { polygons, glyphs: glyphs(text, { advance: 0.7, left: 0, right: 0.65, ascent: 0.8, descent: 0.1 }),
    minFontSize: 1, maxFontSize: 18, readableFontSize: 10, maxAlternatives: 3, allowMultiline: true };
  const fit = fitCountryLabel(candidates, options);
  assert.equal(fit.lineCount, 3);
  assert.ok(fit.fontSize >= 10);
  assert.equal(fit.glyphs.map((glyph) => glyph.text).join(""), text);
  const lines = new Map();
  for (const glyph of fit.glyphs) lines.set(glyph.y, (lines.get(glyph.y) || "") + glyph.text);
  assert.deepEqual([...lines.values()].map((line) => line.trim()), ["United", "States of", "America"]);
  for (const glyph of fit.glyphs.filter((glyph) => glyph.text.trim())) {
    assert.ok(glyph.box.corners.every(({ x, y }) => x > 0 && x < 80 && y > 0 && y < 65));
  }
  const twoLinesReadable = fitCountryLabel(candidates, { ...options, readableFontSize: 6 });
  assert.equal(twoLinesReadable.lineCount, 2, "a readable double line does not upgrade to three lines");
  const unbroken = "Supercalifragilisticexpialidocious";
  assert.equal(fitCountryLabel(candidates, { ...options,
    glyphs: glyphs(unbroken, { advance: 0.7, left: 0, right: 0.65, ascent: 0.8, descent: 0.1 }) }).lineCount, 1,
    "an unbroken word cannot be split or abbreviated");
  const withHole = multiPolygon([polygons[0][0], rectangle(1, 29, 78, 7)[0]]);
  assert.equal(fitCountryLabel(candidates, { ...options, polygons: withHole, minFontSize: 10, maxFontSize: 10 }), null,
    "three-line fallback cannot cross a significant hole through the middle line");
});

test("worker structured clones retain bounded flat component groups and multiline text across cached fits", () => {
  const handle = createCountryLabelLayoutWorkerHandler();
  const text = "United States of America";
  const polygons = multiPolygon(rectangle(0, 0, 65, 65), rectangle(200, 0, 260, 80), rectangle(500, 0, 60, 60));
  const options = { glyphs: glyphs(text, { advance: 0.7, left: 0, right: 0.65, ascent: 0.8, descent: 0.1 }),
    minFontSize: 1, maxFontSize: 18, readableFontSize: 10, maxAlternatives: 3, allowMultiline: true };
  const first = structuredClone(handle({ requestId: 1, generation: 1, countryCode: "US", polygons, options }));
  const next = structuredClone(handle({ requestId: 2, generation: 1, countryCode: "US", options }));
  assert.equal(first.candidateBuilt, true);
  assert.equal(next.candidateBuilt, false);
  assert.ok(next.candidateCount <= 16);
  assert.ok(next.fit.componentFits.length <= 3);
  assert.equal(next.fit.componentFits.length, 3);
  assert.equal(next.fit.componentFits.find((fit) => fit.polygonIndex === 0).lineCount, 3);
  for (const component of next.fit.componentFits) {
    assert.equal(component.componentFits, undefined);
    for (const placement of [component, ...component.alternatives]) {
      assert.equal(placement.componentFits, undefined);
      assert.equal(placement.glyphs.map((glyph) => glyph.text).join(""), text);
      assert.equal(placement.polygonIndex, component.polygonIndex);
    }
  }
});

test("only explicitly subpixel holes are ignored for labels and stricter zoom restores them", () => {
  const candidate = [{ polygonIndex: 0, kind: "horizontal", points: [{ x: 0, y: 20 }, { x: 100, y: 20 }] }];
  const polygons = multiPolygon([rectangle(0, 0, 100, 40)[0], rectangle(48, 19, 0.4, 0.4)[0]]);
  const original = JSON.stringify(polygons);
  const options = { polygons, glyphs: glyphs("ABC", { advance: 1, left: 0, right: 1, ascent: 0.8, descent: 0.1 }),
    minFontSize: 10, maxFontSize: 10 };
  assert.equal(fitCountryLabel(candidate, options), null, "default containment includes every hole");
  assert.equal(fitCountryLabel(candidate, { ...options, minHoleArea: 0.25 }).minHoleArea, 0.25);
  assert.equal(fitCountryLabel(candidate, { ...options, minHoleArea: 0.25 / 4 ** 2 }), null,
    "the same hole is significant after magnification");
  const largeHole = multiPolygon([polygons[0][0], rectangle(45, 16, 10, 8)[0]]);
  assert.equal(fitCountryLabel(candidate, { ...options, polygons: largeHole, minHoleArea: 0.25 }), null);
  assert.equal(JSON.stringify(polygons), original, "label filtering never rewrites the map rings");
  assert.equal(filterCountryLabelHoles(polygons, 0.25)[0][0], polygons[0][0], "the exterior is retained verbatim");
  assert.equal(fitCountryLabel(candidate, { ...options, polygons: multiPolygon([polygons[0][0]]), minHoleArea: 0.25 }).minHoleArea, 0,
    "hole-free fits retain strict metadata so safe zoom fallbacks remain available");
});

test("worker candidates reuse identical retained holes, keep raw geometry and bound threshold variants", () => {
  const handle = createCountryLabelLayoutWorkerHandler();
  const holes = [0.04, 0.09, 0.16, 0.25, 0.36].map((area, index) => rectangle(25 + index * 10, 25, Math.sqrt(area), Math.sqrt(area))[0]);
  const polygons = multiPolygon([rectangle(0, 0, 100, 50)[0], ...holes]);
  const snapshot = JSON.stringify(polygons);
  const options = { glyphs: glyphs("TEST", { advance: 1, left: 0, right: 1, ascent: 0.8, descent: 0.1 }),
    minFontSize: 1, maxFontSize: 10, maxAlternatives: 3, allowArcs: true };
  let requestId = 0;
  const request = (minHoleArea, includeGeometry = false) => handle({ requestId: ++requestId, generation: 1, countryCode: "A",
    polygons: includeGeometry ? polygons : undefined, options: { ...options, minHoleArea } });
  assert.equal(request(0.1, true).candidateBuilt, true);
  assert.equal(request(0.11).candidateBuilt, false, "adjacent bands with identical holes share candidates");
  assert.equal(request(0).candidateBuilt, true, "stricter fits still have the retained raw holes");
  assert.equal(request(0.1).candidateBuilt, false);
  for (const threshold of [0.01, 0.06, 0.2, 0.3, 0.4, 0]) {
    assert.ok(request(threshold).cachedCandidateSets <= 4);
  }
  assert.equal(request(0.1).candidateBuilt, true, "an evicted old ring set is rebuilt rather than retained indefinitely");
  assert.equal(JSON.stringify(polygons), snapshot);
});

test("bounded adaptive tracking returns matching glyph positions and collision envelopes", () => {
  const polygons = multiPolygon(rectangle(0, 0, 100, 50));
  const candidate = [{ polygonIndex: 0, kind: "horizontal", points: [{ x: 0, y: 25 }, { x: 100, y: 25 }] }];
  const options = { polygons, glyphs: glyphs("ABC", { advance: 1, left: 0, right: 1, ascent: 0.8, descent: 0.1 }),
    minFontSize: 10, maxFontSize: 10, tracking: 0.02, maxTracking: 0.2 };
  const expanded = fitCountryLabel(candidate, options);
  assert.equal(expanded.tracking, 0.2);
  assert.ok(Math.abs(expanded.glyphs[1].x - expanded.glyphs[0].x - 12) < 1e-8);
  for (const glyph of expanded.glyphs) {
    assert.equal(glyph.box.x, glyph.x);
    assert.ok(Math.abs(glyph.box.w - 10) < 1e-8);
  }
  const hole = multiPolygon([polygons[0][0], rectangle(33.5, 23, 0.2, 1)[0]]);
  const compact = fitCountryLabel(candidate, { ...options, polygons: hole });
  assert.ok(compact, "compact tracking can remain valid when expanded spacing crosses a hole");
  assert.equal(compact.tracking, 0.02);
  assert.ok(fitCountryLabel(candidate, { ...options, maxTracking: 99 }).tracking <= 0.24);
});

test("readable long Chinese names prefer a single line over a larger two-line block", () => {
  const polygons = multiPolygon(rectangle(0, 0, 110, 60));
  const options = { polygons, glyphs: glyphs("澳大利亚联邦", { advance: 1, left: 0, right: 1, ascent: 0.8, descent: 0.1 }),
    minFontSize: 1, maxFontSize: 24, allowMultiline: true, readableFontSize: 10 };
  const fit = fitCountryLabel(buildCountryLabelCandidates(polygons), options);
  assert.ok(fit.fontSize >= 10);
  assert.equal(fit.lineCount, 1);
  assert.ok(fitCountryLabel(buildCountryLabelCandidates(polygons), { ...options, readableFontSize: 25 }).lineCount === 2,
    "two-line fallback remains available when the single line misses the requested readability");
});

test("readable English names prefer a single line and retain word wrapping as an unreadable fallback", () => {
  const polygons = multiPolygon(rectangle(0, 0, 110, 60));
  const candidates = buildCountryLabelCandidates(polygons);
  const options = { polygons, glyphs: glyphs("BRITISH RAJ", { advance: 0.65, left: 0, right: 0.6, ascent: 0.8, descent: 0.1 }),
    minFontSize: 1, maxFontSize: 24, allowMultiline: true, readableFontSize: 10 };
  const single = fitCountryLabel(candidates, options);
  assert.ok(single.fontSize >= 10);
  assert.equal(single.lineCount, 1, "a larger stacked block cannot displace a readable full English name");
  const wrapped = fitCountryLabel(candidates, { ...options, readableFontSize: 25 });
  assert.equal(wrapped.lineCount, 2);
  assert.ok(wrapped.fontSize > single.fontSize);
  const lines = new Map();
  for (const glyph of wrapped.glyphs) lines.set(glyph.y, (lines.get(glyph.y) || "") + glyph.text);
  assert.deepEqual([...lines.values()].map((line) => line.trim()), ["BRITISH", "RAJ"], "fallback only splits at the word boundary");
});

test("readable fits exclude smaller score winners and cached preferences from selection and alternatives", () => {
  const polygons = multiPolygon(rectangle(0, 0, 120, 80));
  const metrics = glyphs("AB", { advance: 1, left: 0, right: 0.8, ascent: 0.7, descent: 0.1 });
  for (const [kind, angle] of [["horizontal", 0], ["tilted", Math.PI / 12]]) {
    const candidates = [
      { polygonIndex: 0, kind: "horizontal", points: [{ x: 50.1, y: 25 }, { x: 69.9, y: 25 }] },
      { polygonIndex: 0, kind, points: [
        { x: 60 - 10.1 * Math.cos(angle), y: 50 - 10.1 * Math.sin(angle) },
        { x: 60 + 10.1 * Math.cos(angle), y: 50 + 10.1 * Math.sin(angle) },
      ] },
    ];
    const options = { polygons, glyphs: metrics, minFontSize: 1, maxFontSize: 20,
      readableFontSize: 10, preferredCandidateIndex: 0, maxAlternatives: 3 };
    const fit = fitCountryLabel(candidates, options);
    assert.equal(fit.candidateIndex, 1, "only a readable fit can win even when score or cached preference favors the smaller line");
    assert.ok(fit.fontSize >= 10);
    assert.ok(fit.alternatives.every(alternative => alternative.fontSize >= 10 && alternative.candidateIndex === 1),
      "only readable placements, including validated translations, can reappear as collision alternatives");
    const gradual = fitCountryLabel(candidates, { ...options, readableFontSize: 12 });
    assert.ok(gradual.fontSize < 12, "when no fit meets the requested readability, gradual reveal remains available");
  }
});

test("arc-only readability limits retain straight tilt and bound English and Chinese curvature", () => {
  const polygons = multiPolygon(rectangle(0, 0, 120, 70));
  const arcs = buildCountryLabelCandidates(polygons, { allowArcs: true }).filter((candidate) => candidate.kind === "arc");
  for (const [text, maxArcTiltDegrees, maxArcBendDegrees] of [["中国联邦", 10, 14], ["COUNTRY", 15, 22]]) {
    const fit = fitCountryLabel(arcs, { polygons, glyphs: glyphs(text, { advance: 0.9, left: 0, right: 0.85, ascent: 0.8, descent: 0.1 }),
      minFontSize: 1, maxFontSize: 12, allowArcs: true, maxArcTiltDegrees, maxArcBendDegrees });
    assert.ok(fit);
    const angles = fit.glyphs.map((glyph) => glyph.angle);
    assert.ok(angles.every((angle) => Math.abs(angle) <= maxArcTiltDegrees * Math.PI / 180 + 1e-8));
    assert.ok(Math.max(...angles) - Math.min(...angles) <= maxArcBendDegrees * Math.PI / 180 + 1e-8);
  }
  const tilted = buildCountryLabelCandidates(polygons).filter((candidate) => candidate.kind === "tilted");
  const fit = fitCountryLabel(tilted, { polygons, glyphs: glyphs("TEST", { advance: 1, left: 0, right: 1, ascent: 0.8, descent: 0.1 }),
    minFontSize: 10, maxFontSize: 10, maxArcTiltDegrees: 1, maxArcBendDegrees: 1 });
  assert.ok(fit, "arc restrictions do not discard the existing 15-degree straight candidates");
});

test("optical centering retains a valid baseline placement near a territory edge", () => {
  const polygons = multiPolygon(rectangle(0, 0, 100, 40));
  const candidates = [{ polygonIndex: 0, kind: "horizontal", points: [{ x: 0, y: 37 }, { x: 100, y: 37 }] }];
  const fit = fitCountryLabel(candidates, { polygons,
    glyphs: glyphs("AB", { advance: 1, left: 0, right: 1, ascent: 0.8, descent: 0.1 }),
    minFontSize: 10, maxFontSize: 10,
  });
  assert.ok(fit, "an optical shift across the boundary must not discard the existing valid position");
  assert.equal(fit.fontSize, 10);
  assert.equal(fit.bounds.minY, 29);
  assert.equal(fit.bounds.maxY, 38);
});

test("a single line uses symmetric vertical space and centers visible ink rather than its baseline", () => {
  const polygons = multiPolygon(rectangle(0, 0, 100, 20));
  const candidate = [{ polygonIndex: 0, kind: "horizontal", points: [{ x: 0, y: 10 }, { x: 100, y: 10 }] }];
  const fitted = fitCountryLabel(candidate, { polygons,
    glyphs: [
      { text: "A", advance: 1, left: 0, right: 1, ascent: 0.9, descent: 0.1 },
      { text: " ", advance: 0.4, left: 0, right: 0, ascent: 99, descent: 99 },
    ], minFontSize: 16, maxFontSize: 16 });
  assert.ok(fitted, "16px ink fits the full centered 20px height although an uncorrected baseline would cross the top");
  assert.equal(fitted.glyphs[0].y, 16.4);
  assert.ok(Math.abs((fitted.bounds.minY + fitted.bounds.maxY) / 2 - 10) < 1e-8);
  assert.ok(Math.abs(fitted.bounds.minY - 2) < 1e-8);
  assert.ok(Math.abs(fitted.bounds.maxY - 18) < 1e-8);
});

test("tilted single-line ink centers along the path normal", () => {
  const polygons = multiPolygon(rectangle(0, 0, 120, 100));
  const angle = Math.PI / 12;
  const candidate = [{ polygonIndex: 0, kind: "tilted", points: [
    { x: 60 - 40 * Math.cos(angle), y: 50 - 40 * Math.sin(angle) },
    { x: 60 + 40 * Math.cos(angle), y: 50 + 40 * Math.sin(angle) },
  ] }];
  const fitted = fitCountryLabel(candidate, { polygons,
    glyphs: glyphs("TEST", { advance: 1, left: 0, right: 1, ascent: 0.9, descent: 0.1 }),
    minFontSize: 10, maxFontSize: 10 });
  assert.ok(fitted);
  for (const glyph of fitted.glyphs) {
    const center = glyph.box.corners.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
    assert.ok(Math.abs(-(center.x - 60) * Math.sin(angle) + (center.y - 50) * Math.cos(angle)) < 1e-8,
      "each glyph's ink center lies on the original candidate axis");
  }
});

test("two lines with different ink heights center the complete block and preserve a safe gap", () => {
  const polygons = multiPolygon(rectangle(0, 0, 50, 60));
  const candidate = [{ polygonIndex: 0, kind: "horizontal", points: [{ x: 5, y: 30 }, { x: 45, y: 30 }] }];
  const metrics = [...glyphs("中国人民", { advance: 1, left: 0, right: 1, ascent: 0.9, descent: 0.1 }),
    ...glyphs("联邦", { advance: 1, left: 0, right: 1, ascent: 0.35, descent: 0.05 })];
  const fitted = fitCountryLabel(candidate, { polygons, glyphs: metrics,
    minFontSize: 10, maxFontSize: 10, allowMultiline: true });
  assert.ok(fitted);
  assert.equal(fitted.lineCount, 2);
  assert.ok(Math.abs((fitted.bounds.minY + fitted.bounds.maxY) / 2 - 30) < 1e-8);
  const firstBottom = Math.max(...fitted.glyphs.slice(0, 4).map((glyph) => glyph.box.y + glyph.box.h));
  const secondTop = Math.min(...fitted.glyphs.slice(4).map((glyph) => glyph.box.y));
  assert.ok(secondTop - firstBottom >= 1.5, "unequal ascent/descent still leaves a visible line gap");
});

test("multiline spacing ignores invisible whitespace metrics", () => {
  const polygons = multiPolygon(rectangle(0, 0, 50, 40));
  const candidate = [{ polygonIndex: 0, kind: "horizontal", points: [{ x: 5, y: 20 }, { x: 45, y: 20 }] }];
  const metrics = glyphs("ABC DEF", { advance: 1, left: 0, right: 1, ascent: 0.8, descent: 0.1 });
  metrics[3] = { ...metrics[3], advance: 0.4, ascent: 99, descent: 99 };
  const fitted = fitCountryLabel(candidate, { polygons, glyphs: metrics,
    minFontSize: 10, maxFontSize: 10, allowMultiline: true });
  assert.ok(fitted);
  assert.equal(fitted.lineCount, 2);
  assert.ok(Math.abs((fitted.bounds.minY + fitted.bounds.maxY) / 2 - 20) < 1e-8);
});

test("four- and five-character Chinese names remain on one line", () => {
  const polygons = multiPolygon(rectangle(0, 0, 50, 60));
  for (const text of ["意属埃及", "中华共和国"]) {
    const fitted = fitCountryLabel(buildCountryLabelCandidates(polygons), { polygons,
      glyphs: glyphs(text, { advance: 1, left: 0, right: 1, ascent: 0.8, descent: 0.1 }),
      minFontSize: 1, maxFontSize: 20, allowMultiline: true });
    assert.ok(fitted);
    assert.equal(fitted.lineCount, 1, `${text} cannot become an oversized stacked block`);
    assert.equal(fitted.glyphs.map((glyph) => glyph.text).join(""), text);
  }
});

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

test("Chinese two-line names preserve political suffixes and colonial place names", () => {
  const polygons = multiPolygon(rectangle(0, 0, 65, 60));
  for (const parts of [["非洲", "无政府地区"], ["意属", "阿尔及利亚"]]) {
    const fit = fitCountryLabel(buildCountryLabelCandidates(polygons), { polygons,
      glyphs: glyphs(parts.join(""), { advance: 1, left: 0, right: 1, ascent: 0.8, descent: 0.1 }),
      minFontSize: 1, maxFontSize: 12, allowMultiline: true });
    const lines = new Map();
    for (const g of fit.glyphs) lines.set(g.y, (lines.get(g.y) || "") + g.text);
    assert.deepEqual([...lines.values()], parts);
  }
});

test("wrapped glyphs still reject holes and horizontal shifts can find a legal position", () => {
  const candidate = [{ polygonIndex: 0, kind: "horizontal", points: [{ x: 0, y: 22 }, { x: 40, y: 22 }] }];
  const hole = multiPolygon([rectangle(0, 0, 40, 44)[0], rectangle(1, 18, 38, 4)[0]]);
  assert.equal(fitCountryLabel(candidate, { polygons: hole,
    glyphs: glyphs("澳大利亚联邦", { advance: 1, left: 0, right: 1, ascent: 0.8, descent: 0.1 }),
    minFontSize: 12, maxFontSize: 12, allowMultiline: true }), null);
  const path = [{ polygonIndex: 0, kind: "horizontal", points: [{ x: 0, y: 25 }, { x: 100, y: 25 }] }];
  const polygons = multiPolygon([rectangle(0, 0, 100, 50)[0], rectangle(45, 16, 10, 12)[0]]);
  const options = { polygons, glyphs: glyphs("AB", { advance: 1, left: 0, right: 1, ascent: 0.8, descent: 0.1 }),
    minFontSize: 10, maxFontSize: 10 };
  assert.equal(fitCountryLabel(path, options), null);
  const shifted = fitCountryLabel(path, { ...options, allowPositionShift: true });
  assert.ok(shifted);
  assert.ok(shifted.bounds.maxX < 45 || shifted.bounds.minX > 55);
});

test("default candidates favor several horizontal positions and shallow tilt without arcs", () => {
  const geometry = multiPolygon(rectangle(0, 0, 120, 80));
  const first = buildCountryLabelCandidates(geometry);
  const second = buildCountryLabelCandidates(geometry);


  assert.deepEqual(first, second);
  assert.ok(first.some((candidate) => candidate.kind === "horizontal"));
  assert.ok(first.some((candidate) => candidate.kind === "tilted"));
  assert.ok(first.every((candidate) => candidate.kind !== "arc"));
  assert.ok(first.every((candidate) => Math.abs(candidate.angle) <= Math.PI / 12));
  assert.equal(first.slice(0, 5).filter((candidate) => candidate.kind === "horizontal").length, 5);
  assert.equal(new Set(first.slice(0, 5).map((candidate) => candidate.points[0].y)).size, 5);
  assert.ok(first.every((candidate) => candidate.points.length >= 2 && candidate.length > 0));
});

test("wide irregular countries retain different horizontal positions in the bounded budget", () => {
  const geometry = multiPolygon([[[0, 0], [140, 0], [160, 120], [20, 120], [0, 0]]]);
  const candidates = buildCountryLabelCandidates(geometry);
  assert.ok(candidates.length <= 16);
  const firstPositions = candidates.slice(0, 3);
  assert.ok(firstPositions.every((candidate) => candidate.kind === "horizontal"));
  const centers = firstPositions.map((candidate) => candidate.points[Math.floor(candidate.points.length / 2)]);
  assert.ok(centers.every((point, index) => centers.slice(index + 1).every((other) => Math.hypot(point.x - other.x, point.y - other.y) >= 12)));
  const fitted = fitCountryLabel(candidates, { polygons: geometry,
    glyphs: glyphs("LONG COUNTRY NAME", { advance: 0.65, left: 0.02, right: 0.6, ascent: 0.72, descent: 0.08 }),
    minFontSize: 2, maxFontSize: 16, maxAlternatives: 3,
  });
  assert.equal(fitted.candidateKind, "horizontal");
  assert.equal(fitted.glyphs.map((glyph) => glyph.text).join(""), "LONG COUNTRY NAME");
  assert.ok(fitted.alternatives.filter((fit) => fit.candidateKind === "horizontal").length >= 2);
});

test("minor font-size gains cannot displace a readable horizontal fit", () => {
  const geometry = multiPolygon(rectangle(0, 0, 140, 90));
  const angle = Math.PI / 12;
  const candidates = [
    { polygonIndex: 0, kind: "horizontal", points: [{ x: 50, y: 50 }, { x: 90, y: 50 }] },
    { polygonIndex: 0, kind: "tilted", angle, points: [{ x: 70 - 21 * Math.cos(angle), y: 50 - 21 * Math.sin(angle) }, { x: 70 + 21 * Math.cos(angle), y: 50 + 21 * Math.sin(angle) }] },
  ];
  const options = { polygons: geometry, glyphs: glyphs("AB", { advance: 1, left: 0, right: 0.8, ascent: 0.7, descent: 0.1 }),
    minFontSize: 2, maxFontSize: 30,
  };
  const tilted = fitCountryLabel(candidates.slice(1), options);
  const fitted = fitCountryLabel(candidates, options);
  assert.ok(tilted.fontSize > fitted.fontSize);
  assert.equal(fitted.candidateKind, "horizontal");
  assert.equal(fitted.fontSize, 20);
  assert.equal(fitCountryLabel(candidates, { ...options, preferredCandidateIndex: 1 }).candidateKind, "horizontal",
    "a cached preference cannot override the readability penalty after a language change");
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

test("prepared alternatives retain bounded distinct valid positions without shrinking the primary", () => {
  const geometry = multiPolygon(rectangle(0, 0, 160, 120));
  const candidates = [30, 30, 50, 70, 90, 110].map((y) => ({
    polygonIndex: 0, kind: "horizontal", points: [{ x: 10, y }, { x: 150, y }], length: 140,
  }));
  candidates.push({ polygonIndex: 0, kind: "horizontal", points: [{ x: 115, y: 110 }, { x: 155, y: 110 }] });
  const options = { polygons: geometry, glyphs: glyphs("TEST", {
    advance: 0.7, left: 0, right: 0.6, ascent: 0.7, descent: 0.1,
  }), minFontSize: 4, maxFontSize: 16 };
  const primary = fitCountryLabel(candidates, options);
  const prepared = fitCountryLabel(candidates, { ...options, maxAlternatives: 99 });
  assert.equal(prepared.fontSize, primary.fontSize);
  assert.equal(prepared.candidateIndex, primary.candidateIndex);
  assert.equal(prepared.alternatives.length, 3);
  assert.equal(prepared.candidateIndex, 2, "the center-near position wins instead of the first remote position");
  assert.ok(prepared.alternatives.some(fit => fit.candidateIndex !== prepared.candidateIndex),
    "independent candidate placements remain available alongside safe translations");
  const centers = [prepared, ...prepared.alternatives].map(fit => ({
    x: (fit.bounds.minX + fit.bounds.maxX) / 2, y: (fit.bounds.minY + fit.bounds.maxY) / 2,
  }));
  assert.ok(centers.every((p, index) => centers.slice(index + 1).every(q => Math.hypot(p.x - q.x, p.y - q.y) >= 16 - 1e-8)));
  for (const fit of prepared.alternatives) {
    assert.equal(fit.glyphs.length, 4);
    assert.ok(fit.glyphs.every((glyph) => glyph.box.corners.every(({ x, y }) => x > 0 && x < 160 && y > 0 && y < 120)));
    assert.equal(fit.alternatives, undefined, "alternatives are flat rather than recursive");
  }
});

test("prepared translations clear a blocked center and preserve glyph size, bend and opposing directions", () => {
  const polygons = multiPolygon(rectangle(0, 0, 200, 100));
  for (const useArc of [false, true]) {
    const candidates = useArc ? buildCountryLabelCandidates(polygons, { allowArcs: true }).filter(c => c.kind === "arc").slice(0, 1)
      : [{ polygonIndex: 0, kind: "horizontal", points: [{ x: 0, y: 50 }, { x: 200, y: 50 }] }];
    const fit = fitCountryLabel(candidates, { polygons,
      glyphs: glyphs("COUNTRY", { advance: 0.6, left: 0, right: 0.55, ascent: 0.7, descent: 0.1 }),
      minFontSize: 12, maxFontSize: 12, readableFontSize: 10, maxAlternatives: 3, allowArcs: useArc });
    assert.equal(fit.alternatives.length, 3);
    const y = (fit.bounds.minY + fit.bounds.maxY) / 2;
    assert.ok(fit.alternatives.some(a => a.bounds.maxY < y));
    assert.ok(fit.alternatives.some(a => a.bounds.minY > y));
    const last = fit.alternatives[2];
    assert.ok(Math.abs(last.glyphs[0].x - fit.glyphs[0].x) >= 2.5 * fit.fontSize - 1e-8,
      "the final retry reserves a separated diagonal position rather than another nearby slot");
    assert.ok(Math.abs(last.glyphs[0].y - fit.glyphs[0].y) >= 2.5 * fit.fontSize - 1e-8);
    for (const alternative of fit.alternatives) {
      assert.equal(alternative.fontSize, fit.fontSize);
      assert.equal(alternative.lineCount, fit.lineCount);
      const dx = alternative.glyphs[0].x - fit.glyphs[0].x, dy = alternative.glyphs[0].y - fit.glyphs[0].y;
      alternative.glyphs.forEach((glyph, index) => {
        assert.equal(glyph.angle, fit.glyphs[index].angle);
        assert.ok(Math.abs(glyph.x - fit.glyphs[index].x - dx) < 1e-8);
        assert.ok(Math.abs(glyph.y - fit.glyphs[index].y - dy) < 1e-8);
        assert.ok(glyph.box.corners.every(p => p.x > 0 && p.x < 200 && p.y > 0 && p.y < 100));
      });
    }
  }
});

test("translated alternatives reject holes within envelopes and shifts across the coast", () => {
  const metrics = glyphs("AB", { advance: 1, left: 0, right: 0.9, ascent: 0.7, descent: 0.1 });
  const hole = multiPolygon([rectangle(0, 0, 160, 100)[0], rectangle(10, 22, 140, 6)[0]]);
  const path = [{ polygonIndex: 0, kind: "horizontal", points: [{ x: 0, y: 40 }, { x: 160, y: 40 }] }];
  const blocked = fitCountryLabel(path, { polygons: hole, glyphs: metrics, minFontSize: 10, maxFontSize: 10, maxAlternatives: 3 });
  assert.ok(blocked);
  assert.ok(blocked.alternatives.length > 0);
  assert.ok(blocked.alternatives.every(fit => fit.bounds.maxY < 22 || fit.bounds.minY > 28),
    "rectangles intersecting the hole cannot be cached, while a farther translation may clear it");
  const narrow = multiPolygon(rectangle(0, 0, 33, 100));
  const coastal = fitCountryLabel([{ polygonIndex: 0, kind: "horizontal", points: [{ x: 0, y: 50 }, { x: 33, y: 50 }] }],
    { polygons: narrow, glyphs: metrics, minFontSize: 10, maxFontSize: 10, maxAlternatives: 3 });
  assert.equal(coastal.alternatives.length, 2);
  assert.ok(coastal.alternatives.every(fit => Math.abs(fit.bounds.minX - coastal.bounds.minX) < 1e-8));
});

test("worker-prepared translated placements remain usable from cache without the source geometry", () => {
  const polygons = multiPolygon(rectangle(0, 0, 200, 100));
  const reply = createCountryLabelLayoutWorkerHandler()({ requestId: 1, generation: 1, countryCode: "AAA", polygons,
    options: { glyphs: glyphs("COUNTRY", { advance: 0.6, left: 0, right: 0.55, ascent: 0.7, descent: 0.1 }),
      minFontSize: 12, maxFontSize: 12, readableFontSize: 10, maxAlternatives: 3 } });
  const fit = structuredClone(reply.fit), original = JSON.stringify(fit);
  polygons.length = 0;
  const centerY = (fit.bounds.minY + fit.bounds.maxY) / 2;
  for (let frame = 0; frame < 3; frame++) {
    const chosen = [fit, ...fit.alternatives].find(placement => placement.bounds.maxY < centerY || placement.bounds.minY > centerY);
    assert.ok(chosen, "cached full envelopes provide a position clearing the center");
    assert.equal(chosen.fontSize, fit.fontSize);
    assert.equal(chosen.polygonIndex, fit.polygonIndex);
  }
  assert.equal(JSON.stringify(fit), original);
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

test("a steep narrow country stays readable without near-vertical names", () => {
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
  const candidates = buildCountryLabelCandidates(geometry);
  const fitted = fitCountryLabel(candidates, {
    polygons: geometry,
    glyphs: glyphs("COUNTRY", { advance: 0.72, left: 0.03, right: 0.66, ascent: 0.68, descent: 0.08 }),
    minFontSize: 1,
    maxFontSize: 10,
    tracking: 0.03,
    maxTiltDegrees: 75,
    maxAlternatives: 3,
  });

  assert.ok(fitted, "a horizontal or moderate tilt should fit the narrow region");
  assert.ok(candidates.some((candidate) => Math.abs(candidate.angle) > Math.PI / 12), "elongated land permits moderate tilt");
  assert.ok(candidates.every((candidate) => Math.abs(candidate.angle) <= Math.PI / 6));
  assert.ok([fitted, ...fitted.alternatives].every((fit) => fit.glyphs.every((placed) => Math.abs(placed.angle) <= Math.PI / 6 + 1e-8)));
});

test("arc layouts produce changing glyph angles while respecting adjacent and total bend limits", () => {
  const geometry = multiPolygon(rectangle(0, 0, 100, 60));
  const arcs = buildCountryLabelCandidates(geometry, { allowArcs: true }).filter((candidate) => candidate.kind === "arc");
  const options = { polygons: geometry, glyphs: glyphs("CURVE", { advance: 0.62, left: 0.03, right: 0.58, ascent: 0.68, descent: 0.08 }), minFontSize: 2, maxFontSize: 12 };
  assert.equal(fitCountryLabel(arcs, options), null, "ordinary and Chinese names do not use arcs by default");
  const fitted = fitCountryLabel(arcs, {
    polygons: geometry,
    glyphs: glyphs("CURVE", { advance: 0.62, left: 0.03, right: 0.58, ascent: 0.68, descent: 0.08 }),
    minFontSize: 2,
    maxFontSize: 12,
    maxBendDegrees: 60,
    maxAdjacentAngleDegrees: 12,
    allowArcs: true,
  });

  assert.ok(fitted);
  assert.equal(fitted.candidateKind, "arc");
  const angles = fitted.glyphs.map((placed) => placed.angle);
  assert.ok(Math.max(...angles) - Math.min(...angles) > 0.005);
  assert.ok(Math.max(...angles) - Math.min(...angles) <= Math.PI / 3 + 1e-8);
  assert.ok(angles.slice(1).every((angle, index) => Math.abs(angle - angles[index]) <= 12 * Math.PI / 180 + 1e-8));
});
