export function buildDefaultFileStem({ projectName, projectFileStem, activeScenarioId }, date, suffix = "") {
  const name = [projectName, projectFileStem, activeScenarioId, "map"]
    .map(value => (value || "").replace(/[\\/:*?"<>|]/g, "").trim().replace(/(?:_\d{8}-\d{4})+$/, ""))
    .find(Boolean);
  const pad = value => String(value).padStart(2, "0");
  const timestamp = `${String(date.getFullYear()).padStart(4, "0")}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const prefix = Array.from(name).slice(0, 80 - timestamp.length - 1 - suffix.length).join("");
  return `${prefix}_${timestamp}`;
}
