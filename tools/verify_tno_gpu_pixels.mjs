import { chromium } from "playwright";

// Usage: node tools/verify_tno_gpu_pixels.mjs --base-url http://127.0.0.1:8000/
// The caller owns the static server. This runner never loads the application.
const args = process.argv.slice(2);
const baseArgument = args.indexOf("--base-url");
const baseUrl = new URL(baseArgument < 0 ? "http://127.0.0.1:8000/" : args[baseArgument + 1]);
if (!["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname) || !["http:", "https:"].includes(baseUrl.protocol)) {
  throw new Error("GPU pixel validation is restricted to localhost.");
}
if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
baseUrl.search = "";
baseUrl.hash = "";
const errors = [], warnings = [];
let browser;
let result = { pass: false, renderer: null, checks: [] };
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 320, height: 240 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
    if (message.type() === "warning") warnings.push(message.text());
  });
  page.on("requestfailed", request => errors.push(`Request failed: ${request.url()} (${request.failure()?.errorText})`));
  page.on("response", response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
  const fixtureUrl = new URL("__tno_gpu_pixel_validation__.html", baseUrl).href;
  await page.route(fixtureUrl, route => route.fulfill({
    status: 200, contentType: "text/html",
    body: '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>TNO GPU pixel validation</title>',
  }));
  await page.goto(fixtureUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
  result = await page.evaluate(async base => {
    const { createGpuSceneCompositor } = await import(new URL("js/core/renderer/gpu_scene_compositor.js", base));
    const { createPoliticalIdRasterGpu } = await import(new URL("js/core/renderer/political_id_raster_gpu.js", base));
    const output = document.createElement("canvas");
    document.body.append(output);
    let scene, political, framePolitical, preparedPolitical, preparedScene, referenceScene;
    const checks = [], gpuErrors = [];
    let renderer = null, version = null, maxTextureSize = null, failure = null;
    function sourceCanvas(width, height) {
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      return canvas;
    }
    function tile(originX, code, width = 1, height = 1) {
      return { originX, originY: 0, width, height, codes: new Uint32Array(width * height).fill(code),
        edgeIds: new Uint32Array(), edgeWeights: new Float32Array() };
    }
    // Readback is deliberately isolated to this validation oracle. The modules
    // under test never use it for production presentation or interaction.
    function readTopLeft(gl, width, height) {
      const raw = new Uint8Array(width * height * 4), result = new Uint8Array(raw.length);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      for (let y = 0; y < height; y++) result.set(raw.subarray((height - y - 1) * width * 4, (height - y) * width * 4), y * width * 4);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) gpuErrors.push(`WebGL error 0x${error.toString(16)}`);
      return result;
    }
    function checkPixel(name, pixels, index, expected, tolerance = 1) {
      const actual = [...pixels.slice(index * 4, index * 4 + 4)];
      const pass = actual.length === 4 && actual.every((value, channel) => Math.abs(value - expected[channel]) <= tolerance);
      checks.push({ name, pass, actual, expected, tolerance });
    }
    try {
      scene = createGpuSceneCompositor({ canvas: output });
      const gl = scene.gl;
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      renderer = gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
      version = gl.getParameter(gl.VERSION);
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

      const bands = sourceCanvas(2, 2), bandsContext = bands.getContext("2d");
      bandsContext.fillStyle = "#ff0000"; bandsContext.fillRect(0, 0, 2, 1);
      bandsContext.fillStyle = "#00ff00"; bandsContext.fillRect(0, 1, 2, 1);
      scene.render({ width: 2, height: 2, layers: [{ name: "bands", canvas: bands, revision: 1 }] });
      const orientation = readTopLeft(gl, 2, 2);
      checkPixel("canvas-top-is-red", orientation, 0, [255, 0, 0, 255]);
      checkPixel("canvas-bottom-is-green", orientation, 2, [0, 255, 0, 255]);

      political = createPoliticalIdRasterGpu({ gl });
      political.setPalette(Uint8Array.of(0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 255), 1);
      political.setTiles([tile(0, 1, 2, 2)]);
      const translucent = sourceCanvas(2, 2), translucentContext = translucent.getContext("2d");
      translucentContext.fillStyle = "rgba(0, 0, 255, 0.5)";
      translucentContext.fillRect(0, 0, 2, 2);
      scene.render({ width: 2, height: 2, reservedTextureBytes: political.getStats().gpuTextureBytes, layers: [
        { name: "political", draw: frame => political.drawLayer(frame) },
        { name: "translucent", canvas: translucent, revision: 1 },
      ] });
      const blended = readTopLeft(gl, 2, 2);
      checkPixel("half-blue-over-red-premultiplied", blended, 0, [127, 0, 128, 255]);
      checkPixel("half-blue-over-red-bottom-right", blended, 3, [127, 0, 128, 255]);

      // Two adjacent categorical ID texels. Scale both axes by two; translate Y
      // so the output row samples the source row's center, isolating the seam
      // from the intentionally transparent exterior above/below the tiles.
      political.setTiles([tile(0, 1), tile(1, 2)]);
      scene.render({ width: 4, height: 1, reservedTextureBytes: political.getStats().gpuTextureBytes, layers: [
        { name: "political", draw: frame => political.drawLayer({ ...frame, transform: { a: 2, d: 2, f: -0.5 } }) },
      ] });
      const seam = readTopLeft(gl, 4, 1);
      checkPixel("seam-left-resolved-color-75red-25blue", seam, 1, [191, 0, 64, 255]);
      checkPixel("seam-right-resolved-color-25red-75blue", seam, 2, [64, 0, 191, 255]);
      checkPixel("outside-left-transparent-gutter", seam, 0, [191, 0, 0, 191]);
      checkPixel("outside-right-transparent-gutter", seam, 3, [0, 0, 191, 191]);

      // Exercise sparse coverage on the same inter-tile footprint. The right
      // source texel contributes half blue, so the mixed alpha must also vary.
      political.setTiles([tile(0, 1), { ...tile(1, 0x80000000),
        edgeIds: Uint32Array.of(1, 2), edgeWeights: Float32Array.of(0, 0.5) }]);
      scene.render({ width: 4, height: 1, reservedTextureBytes: political.getStats().gpuTextureBytes, layers: [
        { name: "political", draw: frame => political.drawLayer({ ...frame, transform: { a: 2, d: 2, f: -0.5 } }) },
      ] });
      const coverage = readTopLeft(gl, 4, 1);
      checkPixel("seam-sparse-coverage-left", coverage, 1, [191, 0, 32, 223]);
      checkPixel("seam-sparse-coverage-right", coverage, 2, [64, 0, 96, 159]);

      // Keep the legacy setPalette/setTiles checks above. Exercise the atomic
      // frame API independently with a budget that fits both accepted frames
      // but rejects the larger candidate before changing its palette or tiles.
      framePolitical = createPoliticalIdRasterGpu({ gl, maxTextureBytes: 128 });
      function renderFramePixels() {
        scene.render({ width: 2, height: 2,
          reservedTextureBytes: political.getStats().gpuTextureBytes + framePolitical.getStats().gpuTextureBytes,
          layers: [{ name: "political-frame", draw: frame => framePolitical.drawLayer(frame) }],
        });
        return readTopLeft(gl, 2, 2);
      }
      framePolitical.setFrame({ tiles: [tile(0, 1, 2, 2)],
        palette: Uint8Array.of(0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 255), revision: 1 });
      const firstFrame = renderFramePixels();
      checkPixel("setFrame-initial-top-left-red", firstFrame, 0, [255, 0, 0, 255]);
      checkPixel("setFrame-initial-bottom-right-red", firstFrame, 3, [255, 0, 0, 255]);

      framePolitical.setFrame({ tiles: [tile(0, 1, 1, 2), tile(1, 2, 1, 2)],
        palette: Uint8Array.of(0, 0, 0, 0, 0, 255, 0, 255, 255, 255, 0, 255), revision: 2 });
      const updatedFrame = renderFramePixels();
      for (let index = 0; index < 4; index++) {
        checkPixel(`setFrame-new-palette-and-tiles-${index}`, updatedFrame, index,
          index % 2 ? [255, 255, 0, 255] : [0, 255, 0, 255]);
      }
      let budgetRejected = false;
      try {
        framePolitical.setFrame({ tiles: [tile(0, 1, 8, 2)],
          palette: Uint8Array.of(0, 0, 0, 0, 0, 0, 255, 255, 0, 255, 255, 255), revision: 3 });
      } catch (error) {
        if (!(error instanceof RangeError) || !/texture budget exceeded/.test(error.message)) throw error;
        budgetRejected = true;
      }
      if (!budgetRejected) throw new Error("setFrame must reject the over-budget candidate.");
      const retainedFrame = renderFramePixels();
      for (let index = 0; index < 4; index++) {
        checkPixel(`setFrame-budget-rejection-preserves-pixel-${index}`, retainedFrame, index,
          [...updatedFrame.slice(index * 4, index * 4 + 4)], 0);
      }
      // The private upload fixture has its own small finite cap. It must fit
      // the old/new union, not merely the final candidate in isolation.
      preparedPolitical = createPoliticalIdRasterGpu({ gl, maxTextureBytes: 256 });
      const oldPalette = Uint8Array.of(0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 255);
      const newPalette = Uint8Array.of(0, 0, 0, 0, 0, 255, 0, 255, 255, 255, 0, 255);
      function renderPreparedPixels() {
        scene.render({ width: 2, height: 2,
          reservedTextureBytes: political.getStats().gpuTextureBytes + framePolitical.getStats().gpuTextureBytes + preparedPolitical.getStats().gpuTextureBytes,
          layers: [{ name: "private-political-frame", draw: frame => preparedPolitical.drawLayer(frame) }],
        });
        return readTopLeft(gl, 2, 2);
      }
      preparedPolitical.setFrame({ tiles: [tile(0, 1, 2, 2)], palette: oldPalette, revision: 1 });
      const acceptedPrivate = renderPreparedPixels();
      const prepared = await preparedPolitical.prepareFrame({ tiles: [tile(0, 1, 1, 2), tile(1, 2, 1, 2)], palette: newPalette,
        onProgress() {
          if (!preparedPolitical.getStats().pendingTextureBytes) return;
          const duringUpload = renderPreparedPixels();
          if (!duringUpload.every((value, index) => value === acceptedPrivate[index])) throw Error("A private tile upload changed the accepted GPU frame.");
        } });
      if (!prepared || prepared.stats.uploadedTiles !== 2) throw Error("Private frame must actually upload both candidate tiles.");
      const beforeCommit = renderPreparedPixels();
      for (let index = 0; index < 4; index++) checkPixel(`prepareFrame-ready-keeps-old-pixel-${index}`, beforeCommit, index,
        [...acceptedPrivate.slice(index * 4, index * 4 + 4)], 0);
      prepared.commit({ palette: newPalette, revision: 2 });
      const committedPrivate = renderPreparedPixels();
      for (let index = 0; index < 4; index++) checkPixel(`prepareFrame-atomic-equals-setFrame-pixel-${index}`, committedPrivate, index,
        [...updatedFrame.slice(index * 4, index * 4 + 4)], 0);
      const controller = new AbortController();
      const cancelled = await preparedPolitical.prepareFrame({ tiles: [tile(0, 2, 2, 2)], palette: oldPalette, signal: controller.signal });
      if (!cancelled) throw Error("Cancellation fixture must prepare a real candidate.");
      controller.abort();
      let staleRejected = false;
      try { cancelled.commit({ palette: oldPalette, revision: 3 }); }
      catch (error) { if (error.name !== "AbortError") throw error; staleRejected = true; }
      if (!staleRejected || preparedPolitical.getStats().pendingTextureBytes !== 0) throw Error("Cancelled GPU candidate must release and reject publication.");
      const afterCancel = renderPreparedPixels();
      for (let index = 0; index < 4; index++) checkPixel(`prepareFrame-cancel-keeps-pixel-${index}`, afterCancel, index,
        [...committedPrivate.slice(index * 4, index * 4 + 4)], 0);
      const rejectedPrivate = await framePolitical.prepareFrame({ tiles: [tile(0, 1, 8, 2)], palette: oldPalette });
      if (rejectedPrivate !== null) throw Error("Private union admission must reject an oversized candidate.");
      const afterCapacityReject = renderFramePixels();
      for (let index = 0; index < 4; index++) checkPixel(`prepareFrame-capacity-keeps-pixel-${index}`, afterCapacityReject, index,
        [...updatedFrame.slice(index * 4, index * 4 + 4)], 0);

      // Nonpolitical candidates share the old/new texture budget. Real task
      // yields and retained redraws exercise old-frame navigation between
      // uploads; strict readback remains confined to this validation tool.
      const privateOutput = sourceCanvas(2, 2), referenceOutput = sourceCanvas(2, 2);
      preparedScene = createGpuSceneCompositor({ canvas: privateOutput, maxTextureBytes: 64 });
      referenceScene = createGpuSceneCompositor({ canvas: referenceOutput, maxTextureBytes: 64 });
      const solid = color => {
        const canvas = sourceCanvas(2, 2), context = canvas.getContext("2d");
        context.fillStyle = color; context.fillRect(0, 0, 2, 2);
        return canvas;
      };
      const oldLayers = [
        { name: "physicalBase", canvas: solid("#ff0000"), revision: 1 },
        { name: "labels", canvas: solid("rgba(0, 0, 255, 0.5)"), revision: 1 },
      ];
      const newLayers = [
        { name: "physicalBase", canvas: solid("#00ff00"), revision: 2 },
        { name: "labels", canvas: solid("rgba(255, 255, 0, 0.5)"), revision: 2 },
      ];
      const drawLayers = (compositor, layers, reservedTextureBytes = 0) => {
        compositor.render({ width: 2, height: 2, layers, reservedTextureBytes });
        return readTopLeft(compositor.gl, 2, 2);
      };
      const retainedLayers = layers => layers.map(({ name, revision }) => ({ name, revision, retained: true }));
      const compareFour = (name, actual, expected) => {
        for (let index = 0; index < 4; index++) checkPixel(`${name}-${index}`, actual, index,
          [...expected.slice(index * 4, index * 4 + 4)], 0);
      };
      const oldScenePixels = drawLayers(preparedScene, oldLayers);
      const newReferencePixels = drawLayers(referenceScene, newLayers);
      let yields = 0;
      const keepOldScene = async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
        yields++;
        const pixels = drawLayers(preparedScene, retainedLayers(oldLayers));
        if (!pixels.every((value, index) => value === oldScenePixels[index])) throw Error("Canvas preupload changed retained navigation pixels.");
      };
      const preparedLayers = await preparedScene.prepareLayers({ layers: newLayers,
        getReservedTextureBytes: () => 0, isCurrent: () => true, yieldControl: keepOldScene, maxPasses: 3 });
      if (!preparedLayers || yields < 2 || preparedScene.getStats().privateTextureBytes !== 32) {
        throw Error("Both private Canvas candidates must upload with separate host-task yields and retain their budget.");
      }
      compareFour("prepareLayers-ready-keeps-old", drawLayers(preparedScene, retainedLayers(oldLayers)), oldScenePixels);
      const preparedUploadCount = preparedScene.getStats().textureUploads;
      compareFour("prepareLayers-atomic-equals-sync", drawLayers(preparedScene, newLayers), newReferencePixels);
      if (preparedScene.getStats().textureUploads !== preparedUploadCount || preparedScene.getStats().privateTextureBytes !== 0) {
        throw Error("Adopting prepared Canvas textures must not upload them again or retain private bytes.");
      }
      const restoreLayers = oldLayers.map(layer => ({ ...layer, revision: 3 }));
      if (!await preparedScene.prepareLayers({ layers: restoreLayers, getReservedTextureBytes: () => 0, isCurrent: () => true })) {
        throw Error("Cancel fixture must prepare real Canvas candidates.");
      }
      preparedScene.cancelPreparedLayers();
      if (preparedScene.getStats().privateTextureBytes !== 0) throw Error("Canvas cancellation must release private textures.");
      compareFour("prepareLayers-cancel-keeps-old", drawLayers(preparedScene, retainedLayers(newLayers)), newReferencePixels);

      // 32 bytes of old textures plus a 16-byte political reservation leave
      // room for one 16-byte candidate. The other pass must use the same
      // synchronous publication path, with no budget increase or missing layer.
      if (!await preparedScene.prepareLayers({ layers: restoreLayers, getReservedTextureBytes: () => 16, isCurrent: () => true })) {
        throw Error("Partial Canvas admission must complete successfully.");
      }
      if (preparedScene.getStats().privateTextureBytes !== 16) throw Error("Political reservation must limit Canvas admission to one candidate.");
      compareFour("prepareLayers-partial-keeps-old", drawLayers(preparedScene, retainedLayers(newLayers), 16), newReferencePixels);
      const partialUploads = preparedScene.getStats().textureUploads;
      compareFour("prepareLayers-partial-publishes-full-scene", drawLayers(preparedScene, restoreLayers, 16), oldScenePixels);
      if (preparedScene.getStats().textureUploads !== partialUploads + 1 || preparedScene.getStats().privateTextureBytes !== 0) {
        throw Error("Partial preparation must upload only the remaining Canvas and release the candidate.");
      }

      let currentCanvasCandidate = true, cancelledAfterUpload = false;
      const staleResult = await preparedScene.prepareLayers({ layers: newLayers, getReservedTextureBytes: () => 0,
        isCurrent: () => currentCanvasCandidate,
        yieldControl: async () => {
          await new Promise(resolve => setTimeout(resolve, 0));
          if (preparedScene.getStats().privateTextureBytes > 0) {
            currentCanvasCandidate = false; cancelledAfterUpload = true;
          }
        } });
      if (staleResult !== false || !cancelledAfterUpload || preparedScene.getStats().privateTextureBytes !== 0) {
        throw Error("Stale Canvas preparation after a real upload must cancel and release.");
      }
      compareFour("prepareLayers-stale-keeps-old", drawLayers(preparedScene, retainedLayers(restoreLayers)), oldScenePixels);
    } catch (error) {
      failure = String(error.stack || error);
    } finally {
      referenceScene?.dispose();
      preparedScene?.dispose();
      preparedPolitical?.dispose();
      framePolitical?.dispose();
      political?.dispose();
      scene?.dispose();
      output.remove();
    }
    return { pass: !failure && !gpuErrors.length && checks.length === 60 && checks.every(check => check.pass),
      renderer, version, maxTextureSize, checks, gpuErrors, failure };
  }, baseUrl.href);
} catch (error) {
  errors.push(String(error.stack || error));
} finally {
  await browser?.close();
}
result.pass = result.pass && errors.length === 0;
console.log(JSON.stringify({ ...result, baseUrl: baseUrl.href, channel: "chrome", errors, warnings }, null, 2));
if (!result.pass) process.exitCode = 1;
