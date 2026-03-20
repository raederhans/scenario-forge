const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

function resolveBaseUrl() {
  if (process.env.MAPCREATOR_BASE_URL) {
    return process.env.MAPCREATOR_BASE_URL;
  }
  const metadataPath = path.join(process.cwd(), ".runtime", "dev", "active_server.json");
  if (fs.existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      if (metadata && typeof metadata.url === "string" && metadata.url.trim()) {
        return metadata.url.trim();
      }
    } catch (error) {
      console.warn("[physical-layer-regression] Unable to parse active_server.json:", error);
    }
  }
  return "http://127.0.0.1:18080";
}

async function waitForMapReady(page) {
  await page.waitForFunction(() => {
    const select = document.querySelector("#scenarioSelect");
    const canvas = Array.from(document.querySelectorAll("canvas"))
      .find((entry) => entry.width >= 200 && entry.height >= 120 && getComputedStyle(entry).display !== "none");
    return !!select && select.querySelectorAll("option").length > 0 && !!canvas;
  });
  await page.waitForTimeout(1500);
}

async function installCanvasProbe(page) {
  await page.evaluate(() => {
    if (window.__physicalProbeInstalled) {
      window.__resetPhysicalProbe?.();
      return;
    }

    const proto = CanvasRenderingContext2D.prototype;
    const originalFill = proto.fill;
    const originalStroke = proto.stroke;

    proto.fill = function fill(...args) {
      window.__physicalProbeEvents.push({
        kind: "fill",
        blendMode: String(this.globalCompositeOperation || ""),
        alpha: Number(this.globalAlpha || 0),
        fillStyle: String(this.fillStyle || "").toLowerCase(),
      });
      return originalFill.apply(this, args);
    };

    proto.stroke = function stroke(...args) {
      window.__physicalProbeEvents.push({
        kind: "stroke",
        blendMode: String(this.globalCompositeOperation || ""),
        alpha: Number(this.globalAlpha || 0),
        strokeStyle: String(this.strokeStyle || "").toLowerCase(),
      });
      return originalStroke.apply(this, args);
    };

    window.__resetPhysicalProbe = () => {
      window.__physicalProbeEvents = [];
    };
    window.__resetPhysicalProbe();
    window.__physicalProbeInstalled = true;
  });
}

test("physical layer defaults and atlas rendering regression", async ({ page }) => {
  test.setTimeout(60000);
  const baseUrl = resolveBaseUrl();
  const consoleErrors = [];
  const networkFailures = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("response", (response) => {
    if (response.status() >= 400) {
      networkFailures.push({ url: response.url(), status: response.status() });
    }
  });

  page.on("requestfailed", (request) => {
    networkFailures.push({
      url: request.url(),
      status: "failed",
      errorText: request.failure() ? request.failure().errorText : "requestfailed",
    });
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await waitForMapReady(page);
  await installCanvasProbe(page);

  const defaults = await page.evaluate(async () => {
    const { normalizePhysicalStyleConfig } = await import("/js/core/state.js");
    return {
      normalizedDefault: normalizePhysicalStyleConfig(null),
      normalizedExplicit: normalizePhysicalStyleConfig({
        blendMode: "overlay",
        atlasOpacity: 0.27,
      }),
    };
  });

  expect(defaults.normalizedDefault.blendMode).toBe("soft-light");
  expect(defaults.normalizedDefault.atlasOpacity).toBeCloseTo(0.52, 5);
  expect(defaults.normalizedExplicit.blendMode).toBe("overlay");
  expect(defaults.normalizedExplicit.atlasOpacity).toBeCloseTo(0.27, 5);

  const renderResult = await page.evaluate(async () => {
    const { normalizePhysicalStyleConfig, state } = await import("/js/core/state.js");
    window.__resetPhysicalProbe?.();

    state.showPhysical = true;
    state.styleConfig.physical = normalizePhysicalStyleConfig({
      ...state.styleConfig.physical,
      mode: "atlas_and_contours",
      opacity: 0.5,
      atlasOpacity: 0.52,
      atlasIntensity: 0.9,
      blendMode: "soft-light",
      contourOpacity: 0.28,
      contourMinorVisible: false,
    });
    state.physicalSemanticsData = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            atlas_class: "mountain_high_relief",
            atlas_layer: "relief_base",
          },
          geometry: {
            type: "Polygon",
            coordinates: [[[7, 44], [15, 44], [15, 48], [7, 48], [7, 44]]],
          },
        },
        {
          type: "Feature",
          properties: {
            atlas_class: "plains_lowlands",
            atlas_layer: "relief_base",
          },
          geometry: {
            type: "Polygon",
            coordinates: [[[-5, 48], [15, 48], [15, 56], [-5, 56], [-5, 48]]],
          },
        },
      ],
    };
    state.physicalContourMajorData = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { elevation_m: 500 },
          geometry: {
            type: "LineString",
            coordinates: [[6, 46], [16, 46]],
          },
        },
      ],
    };
    state.physicalContourMinorData = {
      type: "FeatureCollection",
      features: [],
    };

    state.updateToolbarInputsFn?.();
    state.renderNowFn?.();

    const atlasSoftLightFills = window.__physicalProbeEvents.filter((event) => (
      event.kind === "fill" && event.blendMode === "soft-light"
    ));
    const sourceOverStrokes = window.__physicalProbeEvents.filter((event) => (
      event.kind === "stroke" && event.blendMode === "source-over"
    ));

    return {
      physical: {
        opacity: state.styleConfig.physical.opacity,
        atlasOpacity: state.styleConfig.physical.atlasOpacity,
        atlasIntensity: state.styleConfig.physical.atlasIntensity,
        blendMode: state.styleConfig.physical.blendMode,
      },
      atlasSoftLightFills,
      sourceOverStrokes,
    };
  });

  const mountainFill = renderResult.atlasSoftLightFills.find((event) => (
    Math.abs(event.alpha - 0.234) < 0.003
  ));
  const plainsFill = renderResult.atlasSoftLightFills.find((event) => (
    Math.abs(event.alpha - 0.15912) < 0.003
  ));
  const contourStroke = renderResult.sourceOverStrokes.find((event) => (
    Math.abs(event.alpha - 0.14) < 0.003
  ));

  expect(renderResult.physical.blendMode).toBe("soft-light");
  expect(renderResult.physical.atlasOpacity).toBeCloseTo(0.52, 5);
  expect(mountainFill).toBeTruthy();
  expect(plainsFill).toBeTruthy();
  expect(contourStroke).toBeTruthy();

  expect(mountainFill.blendMode).toBe("soft-light");
  expect(plainsFill.blendMode).toBe("soft-light");
  expect(contourStroke.blendMode).toBe("source-over");
  expect(mountainFill.alpha).toBeCloseTo(0.234, 3);
  expect(plainsFill.alpha).toBeCloseTo(0.15912, 3);
  expect(mountainFill.alpha).toBeGreaterThan(plainsFill.alpha);

  expect(consoleErrors, `Console errors: ${JSON.stringify(consoleErrors, null, 2)}`).toEqual([]);
  expect(networkFailures, `Network failures: ${JSON.stringify(networkFailures, null, 2)}`).toEqual([]);
});
