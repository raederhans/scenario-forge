// Project file manager (Phase 13)

class FileManager {
  static exportProject(appState) {
    if (!appState) return;
    const payload = {
      colors: appState.colors || {},
      specialZones: appState.specialZones || {},
      timestamp: Date.now(),
    };

    const data = JSON.stringify(payload, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "map_project.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  static importProject(file, callback) {
    if (!file) return;
    const reader = new FileReader();

    reader.onload = () => {
      try {
        const text = typeof reader.result === "string" ? reader.result : "";
        const data = JSON.parse(text);
        if (!data || typeof data !== "object" || !data.colors) {
          throw new Error("Invalid project file: missing colors");
        }
        if (typeof callback === "function") {
          callback(data);
        }
      } catch (error) {
        console.error("Failed to import project:", error);
        alert("Invalid project file. Please select a valid map_project.json.");
      }
    };

    reader.onerror = () => {
      console.error("Failed to read project file:", reader.error);
      alert("Unable to read the selected file.");
    };

    reader.readAsText(file);
  }
}

export { FileManager };
