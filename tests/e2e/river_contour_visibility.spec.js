const { test, expect } = require('@playwright/test');

// Native Canvas readback on a same-origin, test-owned page. There is no app
// startup, world data, temporary fixture or mocked Canvas implementation here.
for (const dpr of [1, 2]) {
  test(`ordered river seam masking preserves holes and export layers at DPR ${dpr}`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, deviceScaleFactor: dpr, viewport: { width: 400, height: 300 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.route('**/__river_canvas_harness__.html', route => route.fulfill({
        contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><title>River contour pixels</title></head><body></body></html>',
      }));
      await page.goto('/__river_canvas_harness__.html');
      const result = await page.evaluate(async ({ dpr }) => {
        await import('/vendor/d3.v7.min.js');
        const { createRiverContourRenderOwner } = await import('/js/core/river_paint/contour_render_owner.js');
        const projection = d3.geoIdentity().translate([16, 16]);
        const path = d3.geoPath(projection);
        const rectangle = (x0, y0, x1, y1) => [[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]];
        const parent = { type: 'Feature', id: 'partitioned', properties: { id: 'partitioned' },
          geometry: { type: 'Polygon', coordinates: [rectangle(10, 10, 110, 110)] } };
        const coverGeometry = { type: 'Polygon', coordinates: [rectangle(40, 40, 90, 90), rectangle(55, 60, 75, 75).reverse()] };
        // The intentionally overlong seam proves parent clipping as well as
        // visibility. D3 geoIdentity projects to exact logical pixel positions.
        const seam = { type: 'MultiLineString', coordinates: [[[64, 0], [64, 128]]] };
        const points = { visible: [64, 25], hidden: [64, 48], hole: [64, 67],
          hiddenAfterHole: [64, 85], outsideParent: [64, 5], outsideParentEnd: [64, 120],
          outsideStroke: [67, 25] };
        const newCanvas = name => {
          const canvas = document.createElement('canvas'); canvas.dataset.layer = name;
          canvas.width = canvas.height = 160 * dpr;
          canvas.style.width = canvas.style.height = '160px'; document.body.append(canvas);
          canvas.getContext('2d', { willReadFrequently: true }).setTransform(dpr, 0, 0, dpr, 0, 0);
          return canvas;
        };
        const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        const pixel = (canvas, point) => {
          const [x, y] = projection(point);
          return [...canvas.getContext('2d').getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data];
        };
        const samples = canvas => Object.fromEntries(Object.entries(points).map(([name, point]) => [name, pixel(canvas, point)]));
        const paint = (canvas, feature, color) => {
          const ctx = canvas.getContext('2d'); path.context(ctx); ctx.beginPath(); path(feature);
          ctx.fillStyle = color; ctx.fill(); path.context(null);
        };
        const compose = (name, layers) => {
          const canvas = newCanvas(name), ctx = canvas.getContext('2d');
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          layers.forEach(layer => ctx.drawImage(layer, 0, 0));
          return canvas;
        };
        const cases = [];
        for (const noninteractive of [false, true]) {
          const cover = { type: 'Feature', id: 'cover', properties: { id: 'cover',
            ...(noninteractive ? { __scenarioHelper: true, interactive: false } : {}) }, geometry: coverGeometry };
          for (const reversed of [false, true]) {
            const entries = reversed ? [cover, parent] : [parent, cover];
            const political = newCanvas('political'), border = newCanvas('borders');
            entries.forEach(feature => paint(political, feature, feature === parent ? '#2468ac' : '#e08030'));
            const politicalBefore = pixels(political);
            // An unrelated border already on the target must survive masking.
            const borderContext = border.getContext('2d');
            borderContext.fillStyle = '#00ff00'; borderContext.fillRect(140, 20, 8, 8);
            // Target alpha must not be multiplied into the scratch alpha again.
            borderContext.globalAlpha = 0.25;
            const originalTransform = [...['a', 'b', 'c', 'd', 'e', 'f'].map(key => borderContext.getTransform()[key])];
            const owner = createRiverContourRenderOwner({ getContext: () => borderContext, getPath: () => path,
              getProjectionKey: () => `fixed-${dpr}`, getOrderedEntries: () => entries,
              getParentMeshes: id => id === 'partitioned' ? [seam] : [] });
            const rendered = owner.draw({ k: 1, color: '#000000', alpha: 0.5, width: 4, lineCap: 'butt' });
            const politicalAfter = pixels(political);
            const rowY = Math.floor(projection(points.visible)[1] * dpr);
            const row = borderContext.getImageData(74 * dpr, rowY, 12 * dpr, 1).data;
            const strokePixels = [...row].filter((alpha, index) => index % 4 === 3 && alpha > 0).length;
            const exports = {
              political: samples(compose('export-political', [political])),
              borders: samples(compose('export-borders', [border])),
              combined: samples(compose('export-combined', [political, border])),
            };
            cases.push({ noninteractive, reversed, rendered, border: samples(border), exports, strokePixels,
              politicalUnchanged: politicalBefore.every((value, index) => value === politicalAfter[index]),
              existingBorder: [...borderContext.getImageData(143 * dpr, 23 * dpr, 1, 1).data],
              alphaRestored: borderContext.globalAlpha,
              transformRestored: originalTransform.every((value, index) => value === borderContext.getTransform()[['a', 'b', 'c', 'd', 'e', 'f'][index]]),
              pathContextRestored: path.context() === null, diagnostics: owner.diagnostics() });
            owner.dispose();
          }
        }
        return { actualDpr: devicePixelRatio, cases };
      }, { dpr });
      await testInfo.attach(`river-contour-native-pixels-dpr-${dpr}.json`, {
        body: JSON.stringify(result, null, 2), contentType: 'application/json',
      });
      expect(result.actualDpr).toBe(dpr);
      expect(result.cases).toHaveLength(4);
      for (const row of result.cases) {
        const label = `DPR ${dpr}, helper ${row.noninteractive}, reversed ${row.reversed}`;
        expect(row.rendered, label).toBe(1);
        expect(row.politicalUnchanged, label).toBe(true);
        expect(row.existingBorder, label).toEqual([0, 255, 0, 255]);
        expect(row.alphaRestored, label).toBe(0.25);
        expect(row.transformRestored, label).toBe(true);
        expect(row.pathContextRestored, label).toBe(true);
        // A second half-alpha stroke would give ~192, not ~128. Exact native
        // stroke width also guards drawing or scaling the same seam twice.
        for (const name of ['visible', 'hole', ...(row.reversed ? ['hidden', 'hiddenAfterHole'] : [])]) {
          expect(row.border[name][3], `${label}: ${name}`).toBeGreaterThanOrEqual(127);
          expect(row.border[name][3], `${label}: ${name}`).toBeLessThanOrEqual(129);
        }
        if (!row.reversed) for (const name of ['hidden', 'hiddenAfterHole']) expect(row.border[name][3], `${label}: ${name}`).toBe(0);
        for (const name of ['outsideParent', 'outsideParentEnd', 'outsideStroke']) expect(row.border[name][3], `${label}: ${name}`).toBe(0);
        expect(row.strokePixels, label).toBe(4 * dpr);
        expect(row.diagnostics.scratchWidth, label).toBe(160 * dpr);
        expect(row.diagnostics.scratchHeight, label).toBe(160 * dpr);
        expect(row.exports.borders, label).toEqual(row.border);
        expect(row.exports.political.visible, label).toEqual([36, 104, 172, 255]);
        expect(row.exports.political.hole, label).toEqual([36, 104, 172, 255]);
        expect(row.exports.political.hidden, label).toEqual(row.reversed ? [36, 104, 172, 255] : [224, 128, 48, 255]);
        if (!row.reversed) expect(row.exports.combined.hidden, label).toEqual([224, 128, 48, 255]);
        for (const name of ['visible', 'hole']) {
          expect(row.exports.combined[name][3], `${label}: export ${name}`).toBe(255);
          for (let channel = 0; channel < 3; channel++) expect(row.exports.combined[name][channel], `${label}: export ${name} channel ${channel}`)
            .toBeLessThan(row.exports.political[name][channel]);
        }
      }
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
