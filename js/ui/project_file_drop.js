import { fileLooksLikeProjectZip } from "../core/project_package_io.js";
import { callRuntimeHook } from "../core/state/index.js";

function isProjectFile(file) {
  return fileLooksLikeProjectZip(file) || (file.name
    ? file.name.toLowerCase().endsWith(".json")
    : file.type === "application/json");
}

export function bindProjectFileDrop(container, state, t) {
  if (!container || container.dataset.projectDropBound) return;
  container.dataset.projectDropBound = "true";

  function onDrag(event) {
    const transfer = event.dataTransfer;
    const file = transfer.files[0];
    const item = Array.from(transfer.items).find(entry => entry.kind === "file");
    if (!file && !item && !Array.from(transfer.types).includes("Files")) return;
    event.preventDefault();
    if ((file || item) && isProjectFile(file || item)) {
      container.dataset.projectDropLabel = t("Drop to open project", "ui");
    } else {
      delete container.dataset.projectDropLabel;
    }
  }

  container.addEventListener("dragenter", onDrag);
  container.addEventListener("dragover", onDrag);
  container.addEventListener("dragleave", event => {
    if (!container.contains(event.relatedTarget)) delete container.dataset.projectDropLabel;
  });
  container.addEventListener("drop", event => {
    delete container.dataset.projectDropLabel;
    const file = event.dataTransfer.files[0];
    if (!file) return;
    event.preventDefault();
    if (isProjectFile(file)) callRuntimeHook(state, "runProjectImportFileFn", file);
  });
}
