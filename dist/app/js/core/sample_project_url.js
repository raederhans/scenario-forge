export const SAMPLE_PROJECT_QUERY_PARAM = "sample";
export const LEGACY_SAMPLE_PROJECT_QUERY_PARAM = "sample_project";

function normalizeSampleProjectId(sampleId) {
  return String(sampleId || "").trim().toLowerCase();
}

export function getSampleProjectIdFromUrl({
  search = globalThis.location?.search || "",
  searchParamsCtor = globalThis.URLSearchParams,
} = {}) {
  if (typeof searchParamsCtor !== "function") return null;
  const params = new searchParamsCtor(search);
  const rawSampleId = params.get(SAMPLE_PROJECT_QUERY_PARAM) || params.get(LEGACY_SAMPLE_PROJECT_QUERY_PARAM);
  const normalizedId = normalizeSampleProjectId(rawSampleId);
  return normalizedId || null;
}
