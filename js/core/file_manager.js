// Project file manager (Phase 13)
import { t } from "../ui/i18n.js";

class FileManager {
  static exportProject(appState) {
    if (!appState) return;
    const payload = {
      schemaVersion: 2,
      countryBaseColors: appState.countryBaseColors || {},
      featureOverrides: appState.featureOverrides || {},
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
        if (!data || typeof data !== "object") {
          throw new Error("Invalid project file");
        }

        // Backward compatibility: v1 only had `colors`.
        if (data.colors && !data.featureOverrides && !data.countryBaseColors) {
          data.featureOverrides = data.colors;
          data.countryBaseColors = {};
        }

        if (!data.featureOverrides || typeof data.featureOverrides !== "object") {
          data.featureOverrides = {};
        }
        if (!data.countryBaseColors || typeof data.countryBaseColors !== "object") {
          data.countryBaseColors = {};
        }

        if (typeof callback === "function") {
          callback(data);
        }
      } catch (error) {
        console.error("Failed to import project:", error);
        alert(t("Invalid project file. Please select a valid map_project.json.", "ui"));
      }
    };

    reader.onerror = () => {
      console.error("Failed to read project file:", reader.error);
      alert(t("Unable to read the selected file.", "ui"));
    };

    reader.readAsText(file);
  }
}

export { FileManager };
