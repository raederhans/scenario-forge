// Project file manager (Phase 13)
import { normalizeTextureStyleConfig } from "./state.js";
import { t } from "../ui/i18n.js";
import { showToast } from "../ui/toast.js";
import { migrateImportedProjectData } from "./sovereignty_manager.js";
import { clearDirty } from "./dirty_state.js";

class FileManager {
  static exportProject(appState) {
    if (!appState) return;
    const payload = {
      schemaVersion: 7,
      countryBaseColors: appState.sovereignBaseColors || appState.countryBaseColors || {},
      featureOverrides: appState.visualOverrides || appState.featureOverrides || {},
      sovereignBaseColors: appState.sovereignBaseColors || appState.countryBaseColors || {},
      visualOverrides: appState.visualOverrides || appState.featureOverrides || {},
      sovereigntyByFeatureId: appState.sovereigntyByFeatureId || {},
      paintMode: appState.paintMode || "visual",
      activeSovereignCode: appState.activeSovereignCode || "",
      dynamicBordersDirty: !!appState.dynamicBordersDirty,
      dynamicBordersDirtyReason: appState.dynamicBordersDirtyReason || "",
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
        texture: normalizeTextureStyleConfig(appState.styleConfig?.texture),
      },
      scenario: appState.activeScenarioId
        ? {
          id: appState.activeScenarioId,
          version: appState.activeScenarioManifest?.version || 1,
          baselineHash: appState.scenarioBaselineHash || "",
          viewMode: String(appState.scenarioViewMode || "ownership"),
        }
        : null,
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
    showToast(t("Project file downloaded.", "ui"), {
      title: t("Project saved", "ui"),
      tone: "success",
    });
    clearDirty("project-export");
  }

  static importProject(file, callback) {
    if (!file) return;
    const reader = new FileReader();

    reader.onload = async () => {
      try {
        const text = typeof reader.result === "string" ? reader.result : "";
        let data = JSON.parse(text);
        if (!data || typeof data !== "object") {
          throw new Error("Invalid project file");
        }
        data = migrateImportedProjectData(data);

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
        if (!data.visualOverrides || typeof data.visualOverrides !== "object") {
          data.visualOverrides = data.featureOverrides;
        }
        if (!data.sovereignBaseColors || typeof data.sovereignBaseColors !== "object") {
          data.sovereignBaseColors = data.countryBaseColors;
        }
        if (!data.sovereigntyByFeatureId || typeof data.sovereigntyByFeatureId !== "object") {
          data.sovereigntyByFeatureId = {};
        }
        data.dynamicBordersDirty = !!data.dynamicBordersDirty;
        data.dynamicBordersDirtyReason = String(data.dynamicBordersDirtyReason || "");
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
        data.styleConfig.texture = normalizeTextureStyleConfig(data.styleConfig.texture);
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
        if (!data.scenario || typeof data.scenario !== "object") {
          data.scenario = null;
        } else {
          data.scenario = {
            id: String(data.scenario.id || "").trim(),
            version: Number(data.scenario.version || 1) || 1,
            baselineHash: String(data.scenario.baselineHash || "").trim(),
            viewMode: String(data.scenario.viewMode || "ownership").trim().toLowerCase() === "frontline"
              ? "frontline"
              : "ownership",
          };
          if (!data.scenario.id) {
            data.scenario = null;
          }
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
          await callback(data);
        }
        clearDirty("project-import");
        showToast(t("Project file loaded successfully.", "ui"), {
          title: t("Project imported", "ui"),
          tone: "success",
        });
      } catch (error) {
        console.error("Failed to import project:", error);
        const tone = String(error?.toastTone || "error");
        const title = String(error?.toastTitle || t("Import failed", "ui"));
        const message = String(
          error?.userMessage || t("Invalid project file. Please select a valid map_project.json.", "ui")
        );
        showToast(message, {
          title,
          tone,
          duration: 4200,
        });
      }
    };

    reader.onerror = () => {
      console.error("Failed to read project file:", reader.error);
      showToast(t("Unable to read the selected file.", "ui"), {
        title: t("Import failed", "ui"),
        tone: "error",
        duration: 4200,
      });
    };

    reader.readAsText(file);
  }
}

export { FileManager };
