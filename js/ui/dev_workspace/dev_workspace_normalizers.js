export function normalizeScenarioTagInput(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function normalizeScenarioNameInput(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function normalizeScenarioColorInput(value) {
  const text = String(value || "").trim().replace(/\s+/g, "").toUpperCase();
  if (!text) return "";
  return text.startsWith("#") ? text : `#${text}`;
}

export function sanitizeScenarioColorList(values = [], limit = 10) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeScenarioColorInput(value))
      .filter((color) => /^#[0-9A-F]{6}$/.test(color))
  )).slice(0, limit);
}
