import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FileManager } from "../js/core/file_manager.js";
import { loadPublicSampleProjectIntoRuntime } from "../js/core/sample_project_import_workflow.js";
import { resolvePublicSampleProjectListFromManifest } from "../js/core/sample_project_registry.js";

const SAMPLE_RUNS_PATH = "landing/assets/sample-runs.json";

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8"));
}

function resolveLandingUrl(url) {
  assert.match(url, /^\.\//, `sample URL must be relative: ${url}`);
  return `landing/${url.slice(2)}`;
}

function readLandingUrlJson(url) {
  return readJson(resolveLandingUrl(url));
}

test("sample project JSON files match current scenario baselines", () => {
  const manifest = readJson(SAMPLE_RUNS_PATH);

  for (const project of manifest.sample_projects) {
    const payload = readLandingUrlJson(project.project_url);
    const scenarioManifest = readJson(`data/scenarios/${project.scenario_id}/manifest.json`);

    assert.equal(payload.schemaVersion, manifest.project_schema_version, `${project.id} schema version drifted`);
    assert.equal(payload.scenario?.id, project.scenario_id, `${project.id} scenario id drifted`);

    assert.equal(payload.scenario.version, scenarioManifest.version, `${project.id} scenario version drifted`);
    assert.equal(payload.scenario.baselineHash, scenarioManifest.baseline_hash, `${project.id} baseline hash drifted`);
  }
});

test("FileManager imports a checked-in sample project", async () => {
  const manifest = readJson(SAMPLE_RUNS_PATH);
  const project = manifest.sample_projects.find((entry) => entry.id === "tno-1962-atlantropa-briefing");
  const text = JSON.stringify(readLandingUrlJson(project.project_url));

  const callbacks = [];
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: () => null,
  };
  try {
    const importResult = await FileManager.importProjectText(text, async (data) => {
      callbacks.push(data);
    });
    assert.equal(importResult, true);
    assert.equal(callbacks.length, 1);
    assert.equal(callbacks[0].scenario?.id, "tno_1962");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("shared sample import workflow preserves committed sample during failed switch", async () => {
  const manifest = readJson(SAMPLE_RUNS_PATH);
  const publicSampleProjects = resolvePublicSampleProjectListFromManifest(manifest);
  const tnoRecommendation = publicSampleProjects.find(
    (entry) => entry.id === "tno-1962-atlantropa-briefing",
  ).recommendedExport;
  const targetState = {
    sampleProjectDeeplink: {
      status: "success",
      sampleId: "tno-1962-atlantropa-briefing",
      scenarioId: "tno_1962",
      title: "TNO 1962 Atlantropa briefing",
      recommendedExport: tnoRecommendation,
    },
  };

  const result = await loadPublicSampleProjectIntoRuntime("modern-world-japan-corridor", {
    targetState,
    helpers: {
      fetchImpl: async (url) => {
        if (url === "../assets/sample-runs.json") {
          return { ok: true, json: async () => manifest };
        }
        if (url === "../assets/sample-projects/modern-world-japan-corridor.project.json") {
          return { ok: true, text: async () => "{" };
        }
        return { ok: false };
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(targetState.sampleProjectDeeplink.status, "error");
  assert.equal(targetState.sampleProjectDeeplink.sampleId, "modern-world-japan-corridor");
  assert.equal(targetState.sampleProjectDeeplink.previousSampleId, "tno-1962-atlantropa-briefing");
});
