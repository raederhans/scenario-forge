import { chromium } from "playwright";

// A real Worker/Canvas oracle, separate from the application's timed journeys.
const args = process.argv.slice(2), index = args.indexOf("--base-url");
const base = new URL(index < 0 ? "http://127.0.0.1:8008/app/" : args[index + 1]);
if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) || !["http:", "https:"].includes(base.protocol)) throw new Error("Localhost only.");
if (!base.pathname.endsWith("/")) base.pathname += "/";
const errors = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
let result;
try {
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(String(error)));
  page.on("requestfailed", request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  const fixture = new URL("__water_pixel_oracle__.html", base).href;
  await page.route(fixture, route => route.fulfill({ contentType: "text/html", body: '<!doctype html><link rel="icon" href="data:,"><title>Water pixel oracle</title>' }));
  await page.goto(fixture);
  await page.addScriptTag({ url: new URL("vendor/d3.v7.min.js", base).href });
  result = await page.evaluate(async baseUrl => {
    const { createWaterRasterWorkerClient } = await import(new URL("js/core/water_raster_worker_client.js", baseUrl));
    const { createOceanSurfacePattern } = await import(new URL("js/core/renderer/ocean_surface_pattern.js", baseUrl));
    const client = createWaterRasterWorkerClient();
    const width = 480, height = 360;
    const makeCanvas = () => { const c = document.createElement("canvas"); c.width = width; c.height = height; return c; };
    const projectionOptions = { factory: "geoEqualEarth", scale: 95, translate: [100, 70], precision: 0.1 };
    const projection = d3.geoEqualEarth().scale(95).translate([100, 70]).precision(0.1);
    const path = d3.geoPath(projection);
    const rect = (l, b, r, t) => [[l, b], [l, t], [r, t], [r, b], [l, b]];
    const polygon = (outer, holes = []) => ({ type: "Polygon", coordinates: [outer, ...holes] });
    const solid = polygon(rect(-45, -35, 45, 35));
    const hole = polygon(rect(-45, -35, 45, 35), [rect(-15, -12, 15, 12).reverse()]);
    const background = makeCanvas(), bg = background.getContext("2d");
    for (let y = 0; y < height; y += 12) for (let x = 0; x < width; x += 12) {
      bg.fillStyle = (x / 12 + y / 12) % 2 ? "#1952a2" : "#69b4c8"; bg.fillRect(x, y, 12, 12);
    }
    const checks = [];
    try {
      for (const [i, test] of [
        { name: "hole", parts: [hole], opacity: 1 },
        { name: "overlap-single-opacity", parts: [solid, polygon(rect(-25, -20, 60, 40))], opacity: 0.46 },
        { name: "lake-outline-alpha", parts: [hole], opacity: 0.65, lake: true },
        { name: "ocean-pattern-transform", parts: [solid], opacity: 0.76, pattern: true },
        { name: "scratch-reuse-distinct-features", parts: [solid], opacity: 0.46,
          extraParts: [[polygon(rect(30, 10, 70, 45))], [hole]] },
      ].entries()) {
        const layout = { pixelWidth: width, pixelHeight: height, dpr: 2, offsetX: 13, offsetY: 9 };
        const transform = { x: -7, y: 4, k: 1.14 };
        const lake = test.lake ? { outlineEnabled: true, outlineWidth: 3, outlineOpacity: 0.4, outlineColor: "#c25630",
          featureIdentity: { id: "lake_baikal", properties: { water_type: "lake" } } } : null;
        const patternSource = test.pattern ? { canvas: background, revision: "pattern-1", layout,
          referenceTransform: { x: -3, y: 6, k: 0.91 } } : null;
        const feature = { id: `fixture-${i}`, geometryVersion: 1, parts: test.parts, opacity: test.opacity,
          fillColor: "#3287bd", useOceanPattern: !!test.pattern, lake };
        const features = [feature, ...(test.extraParts || []).map((parts, index) => ({ ...feature,
          id: `fixture-${i}-extra-${index}`, parts, fillColor: ["#e83d10", "#42e957"][index] }))];
        const actual = await client.request({ identity: test.name, revision: i, sceneKey: "pixel-oracle", projectionOptions,
          layout, transform, features, patternSource });
        const expected = makeCanvas(), ec = expected.getContext("2d"), scratch = makeCanvas(), sc = scratch.getContext("2d");
        const edgeMask = makeCanvas(), mc = edgeMask.getContext("2d");
        for (const entry of features) {
        sc.setTransform(1, 0, 0, 1, 0, 0); sc.clearRect(0, 0, width, height);
        ec.setTransform(1, 0, 0, 1, 0, 0);
        sc.setTransform(2 * transform.k, 0, 0, 2 * transform.k, 2 * (layout.offsetX + transform.x), 2 * (layout.offsetY + transform.y));
        mc.setTransform(sc.getTransform()); mc.lineWidth = 1 / transform.k;
        sc.fillStyle = patternSource ? createOceanSurfacePattern(sc, background, layout, patternSource.referenceTransform) : entry.fillColor;
        const combined = new Path2D();
        for (const part of entry.parts) {
          const p = test.extraParts ? new Path2D() : new Path2D(path(part));
          // Overlapping translucent feature edges amplify SVG's three-decimal
          // serialization error; use the existing native Canvas stream oracle.
          if (test.extraParts) d3.geoPath(projection).context(p)(part);
          combined.addPath(p);
          mc.stroke(p);
          if (!lake) sc.fill(p);
        }
        if (lake) sc.fill(combined);
        ec.globalAlpha = entry.opacity; ec.drawImage(scratch, 0, 0);
        if (lake) {
          ec.setTransform(2 * transform.k, 0, 0, 2 * transform.k, 2 * (layout.offsetX + transform.x), 2 * (layout.offsetY + transform.y));
          ec.globalAlpha = entry.opacity * lake.outlineOpacity; ec.strokeStyle = lake.outlineColor;
          ec.lineWidth = lake.outlineWidth / transform.k; ec.lineJoin = "round"; ec.stroke(combined);
        }
        }
        const got = makeCanvas(), gc = got.getContext("2d"); gc.drawImage(actual.bitmap, 0, 0); actual.bitmap.close();
        const a = gc.getImageData(0, 0, width, height).data, e = ec.getImageData(0, 0, width, height).data;
        const mask = mc.getImageData(0, 0, width, height).data;
        let mismatchedInterior = 0, edgePixels = 0, maxEdgePremultipliedError = 0, paintedPixels = 0;
        const interiorDifferences = [];
        // Native SVG paths round to 3 decimals; direct paths retain doubles.
        // Compare premultiplied channels, permitting small coverage error only
        // within one pixel of the oracle's edge (including pattern boundaries).
        for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
          const offset = (y * width + x) * 4;
          if (e[offset + 3]) paintedPixels++;
          // Include internal part boundaries: opaque overlap can hide them in
          // the final oracle, but both native fills still rasterize those edges.
          const edge = mask[offset + 3] > 0 || [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1].some(delta =>
            [0, 1, 2, 3].some(c => e[offset + c] !== e[offset + delta * 4 + c]));
          let difference = Math.abs(a[offset + 3] - e[offset + 3]);
          for (let c = 0; c < 3; c++) difference = Math.max(difference, Math.abs(a[offset + c] * a[offset + 3] / 255 - e[offset + c] * e[offset + 3] / 255));
          if (edge) { edgePixels++; maxEdgePremultipliedError = Math.max(maxEdgePremultipliedError, difference); }
          else if (difference > 1) { mismatchedInterior++; if (interiorDifferences.length < 8) interiorDifferences.push({ x, y, actual: [...a.slice(offset, offset + 4)], expected: [...e.slice(offset, offset + 4)] }); }
        }
        checks.push({ name: test.name, pass: paintedPixels > 500 && mismatchedInterior === 0 && maxEdgePremultipliedError <= 4,
          paintedPixels, mismatchedInterior, interiorDifferences, edgePixels, maxEdgePremultipliedError, patternBytes: actual.stats.patternBytes });
      }
    } finally { client.dispose(); }
    return { pass: checks.every(check => check.pass), dpr: 2, checks };
  }, base.href);
} finally { await browser.close(); }
console.log(JSON.stringify({ ...result, errors, pass: result?.pass && !errors.length }, null, 2));
if (!result?.pass || errors.length) process.exitCode = 1;
