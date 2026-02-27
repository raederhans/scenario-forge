// Project file manager (Phase 13)
import { t } from "../ui/i18n.js";

class FileManager {
  static exportProject(appState) {
    if (!appState) return;
    const payload = {
      schemaVersion: 4,
      countryBaseColors: appState.countryBaseColors || {},
      featureOverrides: appState.featureOverrides || {},
      specialZones: appState.specialZones || {},
      parentBorderEnabledByCountry: appState.parentBorderEnabledByCountry || {},
      manualSpecialZones: appState.manualSpecialZones || { type: "FeatureCollection", features: [] },
      layerVisibility: {
        showUrban: !!appState.showUrban,
        showPhysical: !!appState.showPhysical,
        showRivers: !!appState.showRivers,
        showSpecialZones: !!appState.showSpecialZones,
      },
      styleConfig: {
        parentBorders: appState.styleConfig?.parentBorders || null,
        ocean: appState.styleConfig?.ocean || null,
        urban: appState.styleConfig?.urban || null,
        physical: appState.styleConfig?.physical || null,
        rivers: appState.styleConfig?.rivers || null,
        specialZones: appState.styleConfig?.specialZones || null,
      },
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
        if (!data.parentBorderEnabledByCountry || typeof data.parentBorderEnabledByCountry !== "object") {
          data.parentBorderEnabledByCountry = {};
        }
        if (!data.styleConfig || typeof data.styleConfig !== "object") {
          data.styleConfig = {};
        }
        if (!data.styleConfig.parentBorders || typeof data.styleConfig.parentBorders !== "object") {
          data.styleConfig.parentBorders = null;
        }
        if (!data.styleConfig.ocean || typeof data.styleConfig.ocean !== "object") {
          data.styleConfig.ocean = null;
        }
        if (!data.styleConfig.urban || typeof data.styleConfig.urban !== "object") {
          data.styleConfig.urban = null;
        }
        if (!data.styleConfig.physical || typeof data.styleConfig.physical !== "object") {
          data.styleConfig.physical = null;
        }
        if (!data.styleConfig.rivers || typeof data.styleConfig.rivers !== "object") {
          data.styleConfig.rivers = null;
        }
        if (!data.styleConfig.specialZones || typeof data.styleConfig.specialZones !== "object") {
          data.styleConfig.specialZones = null;
        }
        if (
          !data.manualSpecialZones ||
          typeof data.manualSpecialZones !== "object" ||
          data.manualSpecialZones.type !== "FeatureCollection" ||
          !Array.isArray(data.manualSpecialZones.features)
        ) {
          data.manualSpecialZones = { type: "FeatureCollection", features: [] };
        }
        if (!data.layerVisibility || typeof data.layerVisibility !== "object") {
          data.layerVisibility = {};
        }
        data.layerVisibility.showUrban =
          data.layerVisibility.showUrban === undefined ? true : !!data.layerVisibility.showUrban;
        data.layerVisibility.showPhysical =
          data.layerVisibility.showPhysical === undefined ? true : !!data.layerVisibility.showPhysical;
        data.layerVisibility.showRivers =
          data.layerVisibility.showRivers === undefined ? true : !!data.layerVisibility.showRivers;
        data.layerVisibility.showSpecialZones =
          data.layerVisibility.showSpecialZones === undefined
            ? true
            : !!data.layerVisibility.showSpecialZones;

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
