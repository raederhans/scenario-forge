import {
  collectSampleExportRecommendationIssues,
  normalizeSampleExportRecommendation,
} from "./sample_export_recommendation.js";

export {
  getSampleProjectIdFromUrl,
  SAMPLE_PROJECT_QUERY_PARAM,
  LEGACY_SAMPLE_PROJECT_QUERY_PARAM,
} from "./sample_project_url.js";
export const SAMPLE_PROJECT_MANIFEST_URL = "../assets/sample-runs.json";
export const SAMPLE_PROJECT_ASSET_BASE_URL = "../assets/sample-projects/";
export const LANDING_SAMPLE_PROJECT_PREFIX = "./assets/sample-projects/";

const SAMPLE_PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAMPLE_PROJECT_FILE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.project\.json$/;

export class SampleProjectLoadError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "SampleProjectLoadError";
    this.code = String(code || "sample-project-error");
    this.toastTitle = String(options.toastTitle || "Sample unavailable");
    this.toastTone = String(options.toastTone || "warning");
    this.userMessage = String(options.userMessage || message || "Sample project could not be opened.");
  }
}

function createSampleProjectError(code, message, options = {}) {
  return new SampleProjectLoadError(code, message, options);
}

function normalizeSampleProjectId(sampleId) {
  return String(sampleId || "").trim().toLowerCase();
}

function assertSampleProjectId(sampleId) {
  const normalizedId = normalizeSampleProjectId(sampleId);
  if (!normalizedId || !SAMPLE_PROJECT_ID_PATTERN.test(normalizedId)) {
    throw createSampleProjectError(
      "invalid-sample-id",
      "Sample project id is not valid.",
      { userMessage: "This sample link is not valid." },
    );
  }
  return normalizedId;
}

function normalizeRecipeSteps(recipe) {
  return (Array.isArray(recipe) ? recipe : [])
    .map((step) => String(step || "").trim())
    .filter(Boolean);
}

function normalizeStringSet(values) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
}

function assertFetch(fetchImpl) {
  if (typeof fetchImpl !== "function") {
    throw createSampleProjectError(
      "fetch-unavailable",
      "Fetch is not available for sample project loading.",
      { userMessage: "Sample projects cannot be opened in this browser session." },
    );
  }
  return fetchImpl;
}

async function fetchJsonResource(url, { fetchImpl }) {
  const response = await assertFetch(fetchImpl)(url);
  if (!response?.ok) {
    throw createSampleProjectError(
      "manifest-fetch-failed",
      `Unable to fetch sample manifest: ${url}`,
      { userMessage: "The sample project list could not be loaded." },
    );
  }
  return response.json();
}

async function fetchTextResource(url, { fetchImpl }) {
  const response = await assertFetch(fetchImpl)(url);
  if (!response?.ok) {
    throw createSampleProjectError(
      "project-fetch-failed",
      `Unable to fetch sample project: ${url}`,
      { userMessage: "The selected sample project could not be loaded." },
    );
  }
  return response.text();
}

export function resolveSampleProjectFileName(projectUrl) {
  const normalizedUrl = String(projectUrl || "").trim();
  if (!normalizedUrl.startsWith(LANDING_SAMPLE_PROJECT_PREFIX)) {
    throw createSampleProjectError(
      "unsafe-project-url",
      "Sample project URL must point at the checked-in public sample directory.",
      { userMessage: "This sample link points outside the public sample project list." },
    );
  }
  const fileName = normalizedUrl.slice(LANDING_SAMPLE_PROJECT_PREFIX.length);
  if (!SAMPLE_PROJECT_FILE_PATTERN.test(fileName)) {
    throw createSampleProjectError(
      "unsafe-project-file",
      "Sample project file name is not safe.",
      { userMessage: "This sample project file is not available." },
    );
  }
  return fileName;
}

function createSampleProjectManifestContext(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw createSampleProjectError(
      "invalid-manifest",
      "Sample manifest is not valid.",
      { userMessage: "The sample project list is not valid." },
    );
  }
  return {
    publicScenarioIds: normalizeStringSet(manifest.public_scenario_ids),
    excludedScenarioIds: normalizeStringSet(manifest.developer_preview_exclusions),
    manifestVersion: Number(manifest.version || 0) || 0,
    sampleProjects: Array.isArray(manifest.sample_projects) ? manifest.sample_projects : [],
  };
}

function resolveSampleProjectEntry(entry, {
  manifestVersion = 0,
  publicScenarioIds,
  excludedScenarioIds,
  projectBaseUrl = SAMPLE_PROJECT_ASSET_BASE_URL,
} = {}) {
  const id = assertSampleProjectId(entry?.id);
  const scenarioId = String(entry?.scenario_id || "").trim();
  if (!scenarioId) {
    throw createSampleProjectError(
      "private-sample-scenario",
      "Sample project scenario is not public: (empty)",
      { userMessage: "This sample project is not available in the public demo." },
    );
  }

  const fileName = resolveSampleProjectFileName(entry?.project_url);
  const isDeveloperPreview = excludedScenarioIds?.has(scenarioId) || false;
  const isPublicScenario = publicScenarioIds?.has(scenarioId) || false;
  const isPublic = isPublicScenario && !isDeveloperPreview;
  const recommendationIssues = collectSampleExportRecommendationIssues(entry?.recommended_export);
  if (!isPublic && !isDeveloperPreview) {
    throw createSampleProjectError(
      "private-sample-scenario",
      `Sample project scenario is not public: ${scenarioId}`,
      { userMessage: "This sample project is not available in the public demo." },
    );
  }
  if (isPublic && recommendationIssues.length) {
    throw createSampleProjectError(
      "invalid-sample-recommendation",
      `Sample project export recommendation is not valid: ${id}`,
      { userMessage: "The sample project list is not valid." },
    );
  }

  return {
    id,
    title: String(entry?.title || id).trim(),
    scenarioId,
    projectUrl: String(entry?.project_url || "").trim(),
    appProjectUrl: `${projectBaseUrl}${fileName}`,
    fileName,
    manifestVersion,
    recipe: normalizeRecipeSteps(entry?.recipe),
    recommendedExport: recommendationIssues.length
      ? null
      : normalizeSampleExportRecommendation(entry?.recommended_export),
    isDeveloperPreview,
    isPublic,
  };
}

export function resolveSampleProjectFromManifest(
  manifest,
  sampleId,
  { projectBaseUrl = SAMPLE_PROJECT_ASSET_BASE_URL } = {},
) {
  const normalizedId = assertSampleProjectId(sampleId);
  const manifestContext = createSampleProjectManifestContext(manifest);
  const entry = manifestContext.sampleProjects.find((project) => normalizeSampleProjectId(project?.id) === normalizedId);
  if (!entry) {
    throw createSampleProjectError(
      "unknown-sample-id",
      `Unknown sample project id: ${normalizedId}`,
      { userMessage: "This sample project is not in the public sample list." },
    );
  }

  const sampleProject = resolveSampleProjectEntry(entry, { ...manifestContext, projectBaseUrl });
  if (!sampleProject.isPublic) {
    throw createSampleProjectError(
      "private-sample-scenario",
      `Sample project scenario is not public: ${sampleProject.scenarioId}`,
      { userMessage: "This sample project is not available in the public demo." },
    );
  }

  return {
    id: sampleProject.id,
    title: sampleProject.title,
    scenarioId: sampleProject.scenarioId,
    projectUrl: sampleProject.projectUrl,
    appProjectUrl: sampleProject.appProjectUrl,
    fileName: sampleProject.fileName,
    manifestVersion: sampleProject.manifestVersion,
    recipe: sampleProject.recipe,
    recommendedExport: sampleProject.recommendedExport,
  };
}

export function resolvePublicSampleProjectListFromManifest(
  manifest,
  { projectBaseUrl = SAMPLE_PROJECT_ASSET_BASE_URL } = {},
) {
  const manifestContext = createSampleProjectManifestContext(manifest);
  return manifestContext.sampleProjects
    .map((entry) => resolveSampleProjectEntry(entry, { ...manifestContext, projectBaseUrl }))
    .filter((entry) => entry.isPublic)
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      scenarioId: entry.scenarioId,
      projectUrl: entry.projectUrl,
      appProjectUrl: entry.appProjectUrl,
      fileName: entry.fileName,
      manifestVersion: entry.manifestVersion,
      recipe: entry.recipe,
      recommendedExport: entry.recommendedExport,
    }));
}

export async function fetchSampleProjectManifest({
  fetchImpl = globalThis.fetch,
  manifestUrl = SAMPLE_PROJECT_MANIFEST_URL,
} = {}) {
  return fetchJsonResource(manifestUrl, { fetchImpl });
}

export async function loadSampleProjectText(sampleId, {
  fetchImpl = globalThis.fetch,
  manifestUrl = SAMPLE_PROJECT_MANIFEST_URL,
  projectBaseUrl = SAMPLE_PROJECT_ASSET_BASE_URL,
} = {}) {
  const normalizedId = assertSampleProjectId(sampleId);
  const manifest = await fetchSampleProjectManifest({ fetchImpl, manifestUrl });
  const sampleProject = resolveSampleProjectFromManifest(manifest, normalizedId, { projectBaseUrl });
  const text = await fetchTextResource(sampleProject.appProjectUrl, { fetchImpl });
  return {
    sampleProject,
    text,
  };
}

export async function loadPublicSampleProjectList({
  fetchImpl = globalThis.fetch,
  manifestUrl = SAMPLE_PROJECT_MANIFEST_URL,
  projectBaseUrl = SAMPLE_PROJECT_ASSET_BASE_URL,
} = {}) {
  const manifest = await fetchSampleProjectManifest({ fetchImpl, manifestUrl });
  return resolvePublicSampleProjectListFromManifest(manifest, { projectBaseUrl });
}
