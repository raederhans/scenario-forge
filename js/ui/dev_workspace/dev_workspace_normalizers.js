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

