import { setScenarioDiagnosticsState } from "../../core/state.js";
import { markDirty } from "../../core/dirty_state.js";
import {
  SPECIAL_ZONE_LAYER_DIAGNOSTIC_CODES,
  createSpecialZonePatternPreviewStyle,
} from "../../core/special_zone_layers.js";
import {
  addCommunityComment,
  createBackendSave,
  downloadCommunitySave,
  listBackendSaves,
  listCommunitySaves,
  loginBackendUser,
  logoutBackendUser,
  publishBackendSave,
  refreshBackendSession,
  registerBackendUser,
  reportCommunitySave,
} from "../../api/backend_client.js";
import { prepareProjectImportFile } from "../../core/project_package_io.js";

function createBackendSessionProbe({
  onProbing = () => {},
  onAuthenticated = () => {},
  onAnonymous = () => {},
  onUnavailable = () => {},
  onSettled = () => {},
} = {}) {
  let probePromise = null;
  return function ensureProbed() {
    if (probePromise) return;
    onProbing();
    probePromise = refreshBackendSession()
      .then(onAuthenticated)
      .catch((error) => {
        if (error?.code === "auth_required" || error?.status === 401) {
          onAnonymous();
          return;
        }
        onUnavailable(error);
      })
      .finally(onSettled);
  };
}

/**
 * Owns the project support and diagnostics panels inside the sidebar:
 * - idempotent panel mounting and element lookup
 * - scenario audit panel rendering and load/hide actions
 * - legend editor rendering
 * - project import/export and debug-mode event binding
 *
 * sidebar.js keeps the higher-level facade:
 * - state callback registration
 * - startup restore and shell orchestration
 * - country/sidebar host layout and shared status flows
 */
export function createProjectSupportDiagnosticsController({
  state,
  hosts = {},
  documentRef = globalThis.document,
  helpers,
}) {
  const document = documentRef;
  const {
    t,
    createEmptyNote,
    resolveAuditNumber,
    incrementSidebarCounter,
    loadScenarioAuditPayload,
    releaseScenarioAuditPayload,
    legendManager,
    mapRenderer,
    fileManager,
    showAppDialog,
    showToast,
    importProjectThroughFunnel,
    invalidateFrontlineOverlayState,
  } = helpers;

  const {
    projectManagementStack,
    legendEditorStack,
    diagnosticStack,
    rightSidebarContent,
  } = hosts;

  let projectSection = documentRef.getElementById("projectManagement");
  if (!projectSection && projectManagementStack) {
    projectSection = documentRef.createElement("div");
    projectSection.id = "projectManagement";
    projectSection.className = "inspector-tool-card project-management-card";

    const actions = documentRef.createElement("div");
    actions.className = "project-management-actions";

    const buildProjectSelect = (id, labelText, options) => {
      const field = documentRef.createElement("label");
      field.className = "project-file-option";
      field.htmlFor = id;
      const label = documentRef.createElement("span");
      label.className = "sidebar-field-label";
      label.setAttribute("data-i18n", labelText);
      label.textContent = t(labelText, "ui");
      const select = documentRef.createElement("select");
      select.id = id;
      select.className = "select-input";
      options.forEach(([value, text]) => {
        const option = documentRef.createElement("option");
        option.value = value;
        option.setAttribute("data-i18n", text);
        option.textContent = t(text, "ui");
        select.appendChild(option);
      });
      field.append(label, select);
      return { field, select };
    };

    const projectDownloadOptions = documentRef.createElement("div");
    projectDownloadOptions.className = "project-file-options";
    const projectDownloadFormat = buildProjectSelect("projectDownloadFormat", "File type", [
      ["json", "Editable project JSON"],
      ["zip", "Project ZIP package"],
    ]);
    const projectDownloadDestination = buildProjectSelect("projectDownloadDestination", "Download to", [
      ["picker", "Save As dialog"],
      ["browser", "Browser download"],
    ]);
    const projectPackageContents = buildProjectSelect("projectPackageContents", "Package contents", [
      ["minimal", "Project only"],
      ["recommended", "Project + metadata"],
      ["diagnostic", "Project + diagnostics"],
    ]);
    const projectLoadSource = buildProjectSelect("projectLoadSource", "Load source", [
      ["local", "Local project file"],
      ["community", "Community save"],
    ]);
    projectDownloadOptions.append(
      projectDownloadFormat.field,
      projectPackageContents.field,
      projectDownloadDestination.field,
      projectLoadSource.field
    );

    const downloadBtn = documentRef.createElement("button");
    downloadBtn.id = "downloadProjectBtn";
    downloadBtn.type = "button";
    downloadBtn.className = "btn-primary";
    downloadBtn.setAttribute("data-i18n", "Download Project");
    downloadBtn.textContent = t("Download Project", "ui");

    const uploadBtn = documentRef.createElement("button");
    uploadBtn.id = "uploadProjectBtn";
    uploadBtn.type = "button";
    uploadBtn.className = "btn-secondary";
    uploadBtn.setAttribute("data-i18n", "Load Project");
    uploadBtn.textContent = t("Load Project", "ui");

    const fileInput = documentRef.createElement("input");
    fileInput.id = "projectFileInput";
    fileInput.type = "file";
    fileInput.accept = ".json,.zip,application/json,application/zip,application/x-zip-compressed";
    fileInput.className = "hidden";
    fileInput.setAttribute("aria-label", t("Load Project", "ui"));
    fileInput.setAttribute("data-i18n-aria-label", "Load Project");

    const fileMeta = documentRef.createElement("div");
    fileMeta.id = "projectFileMeta";
    fileMeta.className = "project-file-meta";

    const fileMetaLabel = documentRef.createElement("span");
    fileMetaLabel.id = "lblProjectFile";
    fileMetaLabel.className = "section-header";
    fileMetaLabel.setAttribute("data-i18n", "Selected File");
    fileMetaLabel.textContent = t("Selected File", "ui");

    const fileName = documentRef.createElement("span");
    fileName.id = "projectFileName";
    fileName.className = "project-file-name u-truncate";
    fileName.dataset.projectFileState = "empty";
    fileName.textContent = t("No file selected", "ui");

    fileMeta.appendChild(fileMetaLabel);
    fileMeta.appendChild(fileName);

    const projectSaveStatus = documentRef.createElement("p");
    projectSaveStatus.id = "projectSaveStatus";
    projectSaveStatus.className = "sidebar-tool-hint project-save-status";
    projectSaveStatus.setAttribute("role", "status");
    projectSaveStatus.setAttribute("aria-live", "polite");
    projectSaveStatus.setAttribute("aria-atomic", "true");
    projectSaveStatus.classList.add("hidden");
    projectSaveStatus.textContent = "";

    const accountDock = documentRef.createElement("div");
    accountDock.className = "project-account-dock";

    const accountHint = documentRef.createElement("span");
    accountHint.className = "project-account-hint";
    accountHint.textContent = t("Account", "ui");

    const accountToggleBtn = documentRef.createElement("button");
    accountToggleBtn.id = "backendAccountToggleBtn";
    accountToggleBtn.type = "button";
    accountToggleBtn.className = "project-account-toggle";
    accountToggleBtn.setAttribute("aria-haspopup", "dialog");
    accountToggleBtn.setAttribute("aria-expanded", "false");
    accountToggleBtn.setAttribute("aria-controls", "backendAccountPopover");
    accountToggleBtn.setAttribute("aria-label", t("Account and Cloud Saves", "ui"));
    accountToggleBtn.title = t("Account and Cloud Saves", "ui");
    accountToggleBtn.innerHTML = `
      <svg class="project-account-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.6"></circle>
        <path d="M5.5 20a6.5 6.5 0 0 1 13 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>
      </svg>
    `;
    accountDock.append(accountHint, accountToggleBtn);

    const accountPopover = documentRef.createElement("div");
    accountPopover.id = "backendAccountPopover";
    accountPopover.className = "project-account-popover hidden";
    accountPopover.setAttribute("role", "dialog");
    accountPopover.setAttribute("aria-label", t("Account and Cloud Saves", "ui"));
    accountPopover.setAttribute("aria-modal", "true");

    const accountBackdrop = documentRef.createElement("div");
    accountBackdrop.id = "backendAccountBackdrop";
    accountBackdrop.className = "project-account-backdrop hidden";
    accountBackdrop.setAttribute("aria-hidden", "true");

    const accountShelf = documentRef.createElement("div");
    accountShelf.id = "rightSidebarAccountShelf";
    accountShelf.className = "right-sidebar-account-shelf";
    accountShelf.append(accountDock);

    actions.appendChild(downloadBtn);
    actions.appendChild(projectDownloadOptions);
    actions.appendChild(uploadBtn);
    actions.appendChild(projectSaveStatus);
    actions.appendChild(fileMeta);
    actions.appendChild(fileInput);

    projectSection.appendChild(actions);
    {
      const cloudSection = documentRef.createElement("div");
      cloudSection.id = "backendCloudSection";
      cloudSection.className = "project-account-panel";
      cloudSection.hidden = true;

      const cloudHeader = documentRef.createElement("div");
      cloudHeader.className = "project-account-panel-header";

      const cloudHeaderCopy = documentRef.createElement("div");
      cloudHeaderCopy.className = "project-account-panel-copy";

      const cloudTitle = documentRef.createElement("h2");
      cloudTitle.className = "project-account-panel-title";
      cloudTitle.id = "backendAccountPopoverTitle";
      cloudTitle.textContent = t("Cloud Saves", "ui");
      accountPopover.setAttribute("aria-labelledby", "backendAccountPopoverTitle");

      const cloudStatus = documentRef.createElement("p");
      cloudStatus.id = "backendCloudStatus";
      cloudStatus.className = "project-account-panel-status";
      cloudStatus.setAttribute("role", "status");
      cloudStatus.setAttribute("aria-live", "polite");
      cloudStatus.setAttribute("aria-atomic", "true");
      cloudStatus.textContent = t("Local backend cloud saves are available after login.", "ui");
      cloudHeaderCopy.append(cloudTitle, cloudStatus);

      const closeAccountBtn = documentRef.createElement("button");
      closeAccountBtn.id = "backendAccountCloseBtn";
      closeAccountBtn.type = "button";
      closeAccountBtn.className = "project-account-close-btn";
      closeAccountBtn.setAttribute("aria-label", t("Close", "ui"));
      closeAccountBtn.textContent = "×";
      cloudHeader.append(cloudHeaderCopy, closeAccountBtn);

      const cloudCredentialGrid = documentRef.createElement("div");
      cloudCredentialGrid.className = "project-account-field-grid";

      const cloudUsername = documentRef.createElement("input");
      cloudUsername.id = "backendCloudUsername";
      cloudUsername.type = "text";
      cloudUsername.autocomplete = "username";
      cloudUsername.placeholder = t("Username", "ui");
      cloudUsername.className = "input project-account-input";

      const cloudPassword = documentRef.createElement("input");
      cloudPassword.id = "backendCloudPassword";
      cloudPassword.type = "password";
      cloudPassword.autocomplete = "current-password";
      cloudPassword.placeholder = t("Password", "ui");
      cloudPassword.className = "input project-account-input";

      const cloudTitleInput = documentRef.createElement("input");
      cloudTitleInput.id = "backendCloudSaveTitle";
      cloudTitleInput.type = "text";
      cloudTitleInput.placeholder = t("Save title", "ui");
      cloudTitleInput.className = "input project-account-input project-account-title-input";
      cloudCredentialGrid.append(cloudUsername, cloudPassword, cloudTitleInput);

      const cloudActions = documentRef.createElement("div");
      cloudActions.className = "project-account-actions";

      const registerCloudBtn = documentRef.createElement("button");
      registerCloudBtn.id = "backendCloudRegisterBtn";
      registerCloudBtn.type = "button";
      registerCloudBtn.className = "btn-secondary sidebar-support-entry-btn";
      registerCloudBtn.textContent = t("Register", "ui");

      const loginCloudBtn = documentRef.createElement("button");
      loginCloudBtn.id = "backendCloudLoginBtn";
      loginCloudBtn.type = "button";
      loginCloudBtn.className = "btn-secondary sidebar-support-entry-btn";
      loginCloudBtn.textContent = t("Login", "ui");

      const logoutCloudBtn = documentRef.createElement("button");
      logoutCloudBtn.id = "backendCloudLogoutBtn";
      logoutCloudBtn.type = "button";
      logoutCloudBtn.className = "btn-secondary sidebar-support-entry-btn";
      logoutCloudBtn.textContent = t("Logout", "ui");

      const saveCloudBtn = documentRef.createElement("button");
      saveCloudBtn.id = "backendCloudSaveBtn";
      saveCloudBtn.type = "button";
      saveCloudBtn.className = "btn-primary sidebar-support-entry-btn";
      saveCloudBtn.textContent = t("Save Cloud Copy", "ui");

      const publishCloudBtn = documentRef.createElement("button");
      publishCloudBtn.id = "backendCloudPublishBtn";
      publishCloudBtn.type = "button";
      publishCloudBtn.className = "btn-secondary sidebar-support-entry-btn";
      publishCloudBtn.textContent = t("Publish Latest", "ui");

      const refreshCommunityBtn = documentRef.createElement("button");
      refreshCommunityBtn.id = "backendCommunityRefreshBtn";
      refreshCommunityBtn.type = "button";
      refreshCommunityBtn.className = "btn-secondary sidebar-support-entry-btn";
      refreshCommunityBtn.textContent = t("Refresh Community", "ui");

      cloudActions.append(
        registerCloudBtn,
        loginCloudBtn,
        logoutCloudBtn,
        saveCloudBtn,
        publishCloudBtn,
        refreshCommunityBtn
      );

      const communityList = documentRef.createElement("div");
      communityList.id = "backendCommunityList";
      communityList.className = "project-account-community-list";

      cloudSection.append(cloudHeader, cloudCredentialGrid, cloudActions, communityList);
      accountPopover.appendChild(cloudSection);
    }
    documentRef.body.append(accountBackdrop, accountPopover);
    projectManagementStack.appendChild(projectSection);
    rightSidebarContent?.appendChild(accountShelf);
  }

  let legendSection = documentRef.getElementById("legendEditor");
  if (!legendSection && legendEditorStack) {
    legendSection = documentRef.createElement("div");
    legendSection.id = "legendEditor";
    legendSection.className = "inspector-tool-card";

    const list = documentRef.createElement("div");
    list.id = "legendEditorList";
    list.className = "mt-3";

    legendSection.appendChild(list);
    legendEditorStack.appendChild(legendSection);
  }

  let scenarioAuditSection = documentRef.getElementById("scenarioAuditPanel");
  if (!scenarioAuditSection && diagnosticStack) {
    scenarioAuditSection = documentRef.createElement("div");
    scenarioAuditSection.id = "scenarioAuditPanel";
    scenarioAuditSection.className = "inspector-tool-card scenario-audit-panel";
    diagnosticStack.appendChild(scenarioAuditSection);
  }

  let debugViewSection = documentRef.getElementById("debugViewControl");
  if (!debugViewSection && diagnosticStack) {
    debugViewSection = documentRef.createElement("div");
    debugViewSection.id = "debugViewControl";
    debugViewSection.className = "inspector-tool-card sidebar-tool-card-debug";

    const title = documentRef.createElement("div");
    title.className = "section-header sidebar-tool-title";
    title.textContent = t("Debug Mode", "ui");

    const hint = documentRef.createElement("p");
    hint.className = "sidebar-tool-hint";
    hint.textContent = t("Use diagnostics to inspect geometry and artifact behavior.", "ui");

    const group = documentRef.createElement("div");
    group.className = "control-group mt-3";

    const label = documentRef.createElement("label");
    label.setAttribute("for", "debug-mode-select");
    label.textContent = t("View", "ui");

    const select = documentRef.createElement("select");
    select.id = "debug-mode-select";
    select.className = "select-input debug-select";

    [
      ["PROD", "Normal View"],
      ["GEOMETRY", "1. Geometry Check (Pink/Green)"],
      ["ARTIFACTS", "2. Artifact Hunter (Red Giants)"],
      ["ISLANDS", "3. Island Detector (Orange)"],
      ["ID_HASH", "4. ID Stability"],
    ].forEach(([value, label]) => {
      const option = documentRef.createElement("option");
      option.value = value;
      option.id = `debugOption${value}`;
      option.textContent = t(label, "ui");
      select.appendChild(option);
    });

    group.appendChild(label);
    group.appendChild(select);
    debugViewSection.appendChild(title);
    debugViewSection.appendChild(hint);
    debugViewSection.appendChild(group);
    diagnosticStack.appendChild(debugViewSection);
  }

  const downloadProjectBtn = documentRef.getElementById("downloadProjectBtn");
  const workspaceSaveBtn = documentRef.getElementById("workspaceSaveBtn");
  const workspaceSaveStatus = documentRef.getElementById("workspaceSaveStatus");
  let projectExportBusy = false;
  const uploadProjectBtn = documentRef.getElementById("uploadProjectBtn");
  const projectDownloadFormat = documentRef.getElementById("projectDownloadFormat");
  const projectDownloadDestination = documentRef.getElementById("projectDownloadDestination");
  const projectPackageContents = documentRef.getElementById("projectPackageContents");
  const projectLoadSource = documentRef.getElementById("projectLoadSource");
  const projectFileInput = documentRef.getElementById("projectFileInput");
  const projectFileName = documentRef.getElementById("projectFileName");
  const projectSaveStatus = documentRef.getElementById("projectSaveStatus");
  const backendCloudSection = documentRef.getElementById("backendCloudSection");
  const backendCloudStatus = documentRef.getElementById("backendCloudStatus");
  const backendAccountToggleBtn = documentRef.getElementById("backendAccountToggleBtn");
  const backendAccountPopover = documentRef.getElementById("backendAccountPopover");
  const backendAccountBackdrop = documentRef.getElementById("backendAccountBackdrop");
  const backendAccountCloseBtn = documentRef.getElementById("backendAccountCloseBtn");
  const backendCloudUsername = documentRef.getElementById("backendCloudUsername");
  const backendCloudPassword = documentRef.getElementById("backendCloudPassword");
  const backendCloudSaveTitle = documentRef.getElementById("backendCloudSaveTitle");
  const backendCloudRegisterBtn = documentRef.getElementById("backendCloudRegisterBtn");
  const backendCloudLoginBtn = documentRef.getElementById("backendCloudLoginBtn");
  const backendCloudLogoutBtn = documentRef.getElementById("backendCloudLogoutBtn");
  const backendCloudSaveBtn = documentRef.getElementById("backendCloudSaveBtn");
  const backendCloudPublishBtn = documentRef.getElementById("backendCloudPublishBtn");
  const backendCommunityRefreshBtn = documentRef.getElementById("backendCommunityRefreshBtn");
  const backendCommunityList = documentRef.getElementById("backendCommunityList");
  const legendList = documentRef.getElementById("legendEditorList");
  const debugModeSelect = documentRef.getElementById("debug-mode-select");
  if (
    projectFileName
    && (
      !projectFileName.textContent.trim()
      || projectFileName.dataset?.projectFileState === "empty"
    )
  ) {
    if (projectFileName.dataset) projectFileName.dataset.projectFileState = "empty";
    projectFileName.textContent = t("No file selected", "ui");
  }


  const getScenarioAuditSummary = (auditPayload) => (
    auditPayload?.summary && typeof auditPayload.summary === "object" ? auditPayload.summary : {}
  );
  let latestCloudSaveId = "";
  let activeCloudUserKey = "";
  let latestCloudSaveUserKey = "";
  let latestCommunitySaves = [];
  let backendCloudSessionMode = "hidden";
  let lastExpandedSpecialZoneDiagnosticsKey = "";

  const setBackendCloudStatus = (message) => {
    if (backendCloudStatus) {
      backendCloudStatus.textContent = message;
    }
  };

  const setBackendCloudSectionVisible = (visible) => {
    if (backendCloudSection) {
      backendCloudSection.hidden = !visible;
    }
  };

  const setDisabled = (element, disabled) => {
    if (element && typeof element === "object") {
      element.disabled = !!disabled;
    }
  };

  const setBackendCloudSessionState = (mode) => {
    backendCloudSessionMode = mode;
    const backendAvailable = mode === "anonymous" || mode === "authenticated";
    const authenticated = mode === "authenticated";
    setBackendCloudSectionVisible(backendAvailable || mode === "unavailable");
    setDisabled(backendCloudUsername, !backendAvailable);
    setDisabled(backendCloudPassword, !backendAvailable);
    setDisabled(backendCloudRegisterBtn, !backendAvailable);
    setDisabled(backendCloudLoginBtn, !backendAvailable);
    setDisabled(backendCloudSaveTitle, !authenticated);
    setDisabled(backendCloudLogoutBtn, !authenticated);
    setDisabled(backendCloudSaveBtn, !authenticated);
    setDisabled(backendCloudPublishBtn, !authenticated);
    setDisabled(backendCommunityRefreshBtn, !backendAvailable);
    renderCommunitySaves(latestCommunitySaves);
  };

  const resolveCloudUserKey = (user) => (
    String(user?.id || user?.username || user?.displayName || "").trim()
  );

  const updateActiveCloudUser = (user) => {
    const nextUserKey = resolveCloudUserKey(user);
    if (nextUserKey && activeCloudUserKey && nextUserKey !== activeCloudUserKey) {
      latestCloudSaveId = "";
      latestCloudSaveUserKey = "";
    }
    activeCloudUserKey = nextUserKey;
    return nextUserKey;
  };

  const clearActiveCloudUser = () => {
    activeCloudUserKey = "";
    latestCloudSaveId = "";
    latestCloudSaveUserKey = "";
  };

  const ensureBackendSessionProbed = createBackendSessionProbe({
    onProbing: () => setBackendCloudSessionState("probing"),
    onAuthenticated: (payload) => {
      updateActiveCloudUser(payload?.user);
      setBackendCloudSessionState("authenticated");
      setBackendCloudStatus(`${t("Logged in as", "ui")} ${payload?.user?.displayName || payload?.user?.username || ""}`);
    },
    onAnonymous: () => {
      clearActiveCloudUser();
      setBackendCloudSessionState("anonymous");
    },
    onUnavailable: (error) => {
      clearActiveCloudUser();
      setBackendCloudSessionState(error?.payload?.code ? "unavailable" : "hidden");
      setBackendCloudStatus(t("Local backend unavailable. Start the local dev server to use Cloud Saves.", "ui"));
    },
    onSettled: () => {
      if (backendCloudStatus?.dataset) {
        backendCloudStatus.dataset.sessionChecked = "true";
      }
    },
  });

  const setBackendAccountPopoverOpen = (isOpen) => {
    if (!backendAccountPopover || !backendAccountToggleBtn) return;
    backendAccountPopover.classList.toggle("hidden", !isOpen);
    backendAccountBackdrop?.classList.toggle("hidden", !isOpen);
    document.body?.classList.toggle("project-account-dialog-open", !!isOpen);
    backendAccountToggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    if (isOpen) {
      void ensureBackendSessionProbed();
      window.requestAnimationFrame?.(() => backendCloudUsername?.focus?.());
    } else {
      backendAccountToggleBtn.focus?.();
    }
  };

  const openBackendAccountPopover = () => setBackendAccountPopoverOpen(true);

  const getBackendCredentials = () => ({
    username: String(backendCloudUsername?.value || "").trim(),
    password: String(backendCloudPassword?.value || ""),
  });

  const getCloudSaveTitle = () => (
    String(backendCloudSaveTitle?.value || "").trim()
    || String(state.activeScenarioManifest?.display_name || state.activeScenarioId || "Map project").trim()
    || "Map project"
  );

  const confirmReplaceCurrentProject = async () => {
    if (!state.isDirty) return true;
    return showAppDialog({
      title: t("Load Project", "ui"),
      message: t("You have unsaved changes. Loading a project will replace the current map.", "ui"),
      details: t(
        "Continue only if you are ready to discard the current working state or have already exported it.",
        "ui"
      ),
      confirmLabel: t("Discard and Load", "ui"),
      cancelLabel: t("Stay on Current Map", "ui"),
      tone: "warning",
    });
  };

  const runExclusiveButtonTask = async (button, task, restore = null) => {
    if (!button || button.dataset?.busy === "true") return false;
    const wasDisabled = !!button.disabled;
    button.disabled = true;
    if (button.dataset) button.dataset.busy = "true";
    try {
      await task();
      return true;
    } finally {
      if (button.dataset) delete button.dataset.busy;
      button.disabled = wasDisabled;
      if (typeof restore === "function") restore();
    }
  };

  const restoreBackendCloudControls = () => {
    setBackendCloudSessionState(backendCloudSessionMode);
  };

  const formatProjectPackagePreviewDetails = (preview) => {
    if (!preview) return "";
    const scenario = preview.scenario && typeof preview.scenario === "object"
      ? String(preview.scenario.id || "").trim()
      : "";
    const project = preview.project && typeof preview.project === "object" ? preview.project : {};
    const summary = preview.summary && typeof preview.summary === "object" ? preview.summary : {};
    const generatedAt = String(preview.generatedAt || "").trim();
    return [
      `${t("Package", "ui")}: ${preview.filename}`,
      `${t("Schema", "ui")}: ${project.schemaVersion || summary.schemaVersion || "-"}`,
      `${t("Scenario", "ui")}: ${scenario || t("None", "ui")}`,
      `${t("Entries", "ui")}: ${preview.entryCount || 0}`,
      `${t("Export target", "ui")}: ${summary.exportTarget || "-"}`,
      generatedAt ? `${t("Generated", "ui")}: ${generatedAt}` : "",
    ].filter(Boolean).join("\n");
  };

  const confirmProjectPackagePreview = async (preview) => {
    if (!preview) return true;
    return showAppDialog({
      title: t("Load Project Package", "ui"),
      message: t("This ZIP contains an editable project. Review the package summary before loading.", "ui"),
      details: formatProjectPackagePreviewDetails(preview),
      confirmLabel: t("Load Package", "ui"),
      cancelLabel: t("Cancel", "ui"),
      tone: "info",
    });
  };

  const resolveLatestCloudSaveId = async () => {
    // 发布动作以“当前登录用户的最新保存”为边界；切换用户后清空缓存，避免复用上一位用户的 save id。
    if (latestCloudSaveId && latestCloudSaveUserKey === activeCloudUserKey) return latestCloudSaveId;
    const payload = await listBackendSaves();
    const saves = Array.isArray(payload?.saves) ? payload.saves : [];
    const latestSave = saves.find((save) => save?.id);
    latestCloudSaveId = String(latestSave?.id || "");
    latestCloudSaveUserKey = activeCloudUserKey;
    return latestCloudSaveId;
  };

  const hydrateProjectFromCommunitySave = async (saveId) => {
    // Community 下载结果重新包成 File/Blob 后走统一导入漏斗，保持确认弹窗、dirty 状态和渲染回调一致。
    const payload = await downloadCommunitySave(saveId);
    const project = payload?.save?.project;
    if (!project || typeof project !== "object") {
      throw new Error("Community save did not include a project payload.");
    }
    const filename = String(payload?.filename || "community-mapcreator-save.json");
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const file = typeof File === "function" ? new File([blob], filename, { type: "application/json" }) : blob;
    const outcome = await importProjectThroughFunnel(file, {
      ui: {
        t,
        showAppDialog,
        showToast,
      },
      hooks: {
        refreshColorState: mapRenderer.refreshColorState,
        invalidateFrontlineOverlayState,
        onProjectImportComplete: (summary) => {
          completeProjectImportStatus(summary);
          setBackendCloudStatus(t("Community save loaded into the editor.", "ui"));
        },
        onProjectImportError: (error) => {
          const message = failProjectImportStatus(error);
          setBackendCloudStatus(message);
        },
      },
    });
    if (outcome?.status === "committed-with-warnings") {
      setBackendCloudStatus(`${t("Community save loaded into the editor.", "ui")} ${outcome.warnings.map(item => item.resource).join(", ")}`);
    } else if (outcome?.status === "failed" && outcome.reason === "import-in-progress") {
      setBackendCloudStatus(t("Project import is already in progress.", "ui"));
    }
  };

  const renderCommunitySaves = (saves = []) => {
    if (!backendCommunityList) return;
    backendCommunityList.replaceChildren();
    const normalizedSaves = Array.isArray(saves) ? saves : [];
    latestCommunitySaves = normalizedSaves;
    if (!normalizedSaves.length) {
      backendCommunityList.appendChild(createEmptyNote(t("No community saves yet", "ui")));
      return;
    }
    const authenticated = !!activeCloudUserKey;
    normalizedSaves.forEach((save) => {
      const row = document.createElement("div");
      row.className = "scenario-audit-stack-row";
      const title = document.createElement("span");
      title.className = "body-text scenario-audit-key";
      title.textContent = String(save?.title || "Community save");
      const meta = document.createElement("span");
      meta.className = "inspector-mini-label scenario-audit-note";
      meta.textContent = String(save?.owner?.displayName || save?.owner?.username || "unknown");
      const loadButton = document.createElement("button");
      loadButton.type = "button";
      loadButton.className = "btn-secondary";
      loadButton.textContent = t("Load", "ui");
      loadButton.addEventListener("click", async () => {
        await runExclusiveButtonTask(loadButton, async () => {
          try {
            if (!(await confirmReplaceCurrentProject())) return;
            await hydrateProjectFromCommunitySave(String(save.id || ""));
            setBackendCloudStatus(t("Community save import started.", "ui"));
          } catch (error) {
            setBackendCloudStatus(String(error?.message || error || ""));
          }
        });
      });
      const commentButton = document.createElement("button");
      commentButton.type = "button";
      commentButton.className = "btn-secondary";
      commentButton.disabled = !authenticated;
      commentButton.textContent = t("Comment", "ui");
      commentButton.addEventListener("click", async () => {
        try {
          await addCommunityComment(String(save.id || ""), "Tried this save locally.");
          setBackendCloudStatus(t("Comment posted.", "ui"));
        } catch (error) {
          setBackendCloudStatus(String(error?.message || error || ""));
        }
      });
      const reportButton = document.createElement("button");
      reportButton.type = "button";
      reportButton.className = "btn-secondary";
      reportButton.disabled = !authenticated;
      reportButton.textContent = t("Report", "ui");
      reportButton.addEventListener("click", async () => {
        try {
          await reportCommunitySave(String(save.id || ""), "other", "Reported from the local editor.");
          setBackendCloudStatus(t("Report submitted for review.", "ui"));
        } catch (error) {
          setBackendCloudStatus(String(error?.message || error || ""));
        }
      });
      row.append(title, meta, loadButton, commentButton, reportButton);
      backendCommunityList.appendChild(row);
    });
  };

  const refreshCommunitySaves = async () => {
    const payload = await listCommunitySaves();
    renderCommunitySaves(Array.isArray(payload?.saves) ? payload.saves : []);
  };

  const getScenarioAuditBlockerCount = (summary = {}) => {
    const flattened = Number(summary.blocker_count);
    if (Number.isFinite(flattened)) {
      return flattened;
    }
    return (
      Number(summary.geometry_blocker_count || 0)
      + Number(summary.topology_blocker_count || 0)
      + Number(summary.scenario_rule_blocker_count || 0)
    );
  };

  const createAuditValueRow = (label, value) => {
    const row = document.createElement("div");
    row.className = "scenario-audit-row";

    const left = document.createElement("span");
    left.className = "inspector-mini-label scenario-audit-label";
    left.textContent = label;

    const right = document.createElement("span");
    right.className = "country-row-title scenario-audit-value";
    right.textContent = String(value);

    row.appendChild(left);
    row.appendChild(right);
    return row;
  };

  const createAuditList = (items = [], renderItem) => {
    const list = document.createElement("div");
    list.className = "mt-2 flex flex-col gap-2 scenario-audit-list";
    if (!items.length) {
      list.appendChild(createEmptyNote(t("None", "ui")));
      return list;
    }
    items.forEach((item, index) => {
      const node = renderItem(item, index);
      if (node) {
        list.appendChild(node);
      }
    });
    return list;
  };

  const formatSpecialZoneRuntimeDiagnostic = (entry = {}) => {
    const code = String(entry?.code || "diagnostic");
    if (code === "topology_fingerprint_mismatch") {
      return `${code}: expected ${entry.expected || "current"} / got ${entry.actual || "empty"}`;
    }
    if (code === "invalid_feature_id") {
      return `${code}: ${entry.featureId || ""}`.trim();
    }
    if (code === "duplicate_layer_id_dropped") {
      return `${code}: ${entry.layerId || ""}`.trim();
    }
    if (code === SPECIAL_ZONE_LAYER_DIAGNOSTIC_CODES.LOAD_FAILED) {
      return `${code}: ${entry.scenarioId || state.activeScenarioId || ""}`.trim();
    }
    if (code === "legacy_special_zone_fields_dropped") {
      return t("legacy_special_zone_fields_dropped", "ui");
    }
    return code;
  };

  const renderSpecialZoneRuntimeDiagnostics = () => {
    const diagnostics = Array.isArray(state.specialZoneLayers?.diagnostics)
      ? state.specialZoneLayers.diagnostics
      : [];
    if (!diagnostics.length) return null;
    const diagnosticsKey = diagnostics
      .map((entry) => `${entry?.code || "diagnostic"}:${entry?.expected || ""}:${entry?.actual || ""}:${entry?.featureId || ""}:${entry?.layerId || ""}:${entry?.scenarioId || ""}`)
      .join("|");

    const wrapper = document.createElement("div");
    wrapper.className = "mt-4 flex flex-col gap-2 special-zone-runtime-diagnostics";

    const header = document.createElement("div");
    header.className = "section-header-block";
    header.textContent = t("Special zone diagnostics", "ui");
    wrapper.appendChild(header);

    wrapper.appendChild(createAuditList(diagnostics.slice(0, 6), (entry) => {
      const row = document.createElement("div");
      row.className = "scenario-audit-stack-row special-zone-runtime-diagnostic-row";
      row.appendChild(Object.assign(document.createElement("span"), {
        className: "inspector-mini-label scenario-audit-label",
        textContent: String(entry?.code || "diagnostic"),
      }));
      row.appendChild(Object.assign(document.createElement("span"), {
        className: "body-text scenario-audit-note",
        textContent: formatSpecialZoneRuntimeDiagnostic(entry),
      }));
      return row;
    }));

    if (diagnosticsKey && diagnosticsKey !== lastExpandedSpecialZoneDiagnosticsKey) {
      lastExpandedSpecialZoneDiagnosticsKey = diagnosticsKey;
      scenarioAuditSection?.closest?.("details")?.setAttribute?.("open", "");
    }
    return wrapper;
  };

  const getVisibleSpecialZoneLegendLayers = () => (
    legendManager.getSpecialZoneLayers(state)
  );

  let lastProjectImportSummary = null;
  let projectImportController = null;
  const formatProjectImportSummary = (summary) => {
    const scenario = summary.scenarioName || summary.scenarioId || t("None", "ui");
    const restored = t("Project imported: {scenario}. Restored {colors} color entries and {owners} ownership entries.", "ui")
      .replace("{scenario}", scenario)
      .replace("{colors}", String(summary.restoredColorEntries))
      .replace("{owners}", String(summary.restoredOwnershipEntries));
    const details = [restored];
    if (summary.ignoredEntries > 0) {
      details.push(t("Ignored {count} entries that are not valid for this map.", "ui")
        .replace("{count}", String(summary.ignoredEntries)));
    }
    if (summary.migratedEntries > 0) {
      details.push(t("Updated {count} entries to the current map regions.", "ui")
        .replace("{count}", String(summary.migratedEntries)));
    }
    return details.join(" ");
  };
  const completeProjectImportStatus = (summary) => {
    lastProjectImportSummary = summary || null;
    refreshProjectSaveStatus();
  };
  const failProjectImportStatus = (error) => {
    lastProjectImportSummary = null;
    const message = error?.code === "IMPORT_ABORTED"
      ? t("Project import cancelled.", "ui")
      : t("Project import failed before completion. Review the current map state.", "ui");
    refreshProjectSaveStatus(message);
    return message;
  };
  const refreshProjectSaveStatus = (message = "") => {
    // 保存状态只读 dirty contract 与最近一次项目事务，避免各按钮各自拼接状态文案。
    const lastChange = String(state.lastDirtyReason || "").trim();
    if (workspaceSaveStatus) {
      const key = state.isDirty ? "Unsaved changes"
        : lastChange === "project-export" ? "Project downloaded"
        : lastChange === "project-import" ? "Project imported" : "Not saved yet";
      if (message) delete workspaceSaveStatus.dataset.i18n;
      else workspaceSaveStatus.dataset.i18n = key;
      workspaceSaveStatus.textContent = message || t(key, "ui");
    }
    if (!projectSaveStatus) return;
    const setStatusMessage = (text) => {
      projectSaveStatus.textContent = text;
      projectSaveStatus.classList.toggle("hidden", !String(text || "").trim());
    };
    if (message) {
      setStatusMessage(message);
      return;
    }
    if (state.isDirty) {
      setStatusMessage(`${t("Unsaved project changes.", "ui")} ${t("Project export includes appearance and transport settings.", "ui")}`);
      return;
    }
    if (lastChange === "project-export") {
      setStatusMessage(t("Project exported. Appearance and transport settings are saved in the selected project file.", "ui"));
      return;
    }
    if (lastChange === "project-import") {
      setStatusMessage(lastProjectImportSummary
        ? formatProjectImportSummary(lastProjectImportSummary)
        : t("Project imported. Appearance and transport settings were restored from the JSON file.", "ui"));
      return;
    }
    setStatusMessage("");
  };

  const syncProjectPackageContentAvailability = () => {
    if (!projectPackageContents) return;
    const isZip = String(projectDownloadFormat?.value || "json").trim().toLowerCase() === "zip";
    projectPackageContents.disabled = !isZip;
    projectPackageContents.setAttribute?.("aria-disabled", String(!isZip));
  };

  const appendSpecialZoneLegendRows = (layers = getVisibleSpecialZoneLegendLayers(), target = legendList) => {
    if (!layers.length) return false;
    const section = document.createElement("div");
    section.className = "legend-special-zone-section";
    const title = document.createElement("h4");
    title.className = "legend-section-title";
    title.textContent = t("Special Zone Layers", "ui");
    section.appendChild(title);
    layers.forEach((layer) => {
      const row = document.createElement("div");
      row.className = "legend-row legend-row-special-zone";
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch legend-swatch-special-zone";
      const preview = createSpecialZonePatternPreviewStyle(layer.style);
      swatch.style.backgroundColor = preview.backgroundColor;
      swatch.style.backgroundImage = preview.backgroundImage;
      swatch.style.borderColor = preview.borderColor;
      const label = document.createElement("span");
      label.className = "legend-special-zone-label";
      label.textContent = layer.name;
      row.append(swatch, label);
      section.appendChild(row);
    });
    target.appendChild(section);
    return true;
  };

  const createLegendGeneratorControls = () => {
    const config = legendManager.getConfig(state);
    const shell = document.createElement("div");
    shell.className = "legend-generator-card";

    const modeLabel = document.createElement("label");
    modeLabel.className = "legend-generator-field";
    const modeText = document.createElement("span");
    modeText.textContent = t("生成模式", "ui");
    const modeSelect = document.createElement("select");
    modeSelect.className = "legend-generator-select";
    [
      ["weighted-random", t("加权随机", "ui")],
      ["direct-area", t("按实控面积", "ui")],
      ["realm-area", t("按宗主面积", "ui")],
      ["continent-area", t("大洲聚焦", "ui")],
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === config.mode;
      modeSelect.appendChild(option);
    });
    modeLabel.append(modeText, modeSelect);

    const continentLabel = document.createElement("label");
    continentLabel.className = "legend-generator-field";
    const continentText = document.createElement("span");
    continentText.textContent = t("大洲", "ui");
    const continentSelect = document.createElement("select");
    continentSelect.className = "legend-generator-select";
    legendManager.getContinentOptions().forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = t(entry.label, "ui");
      option.selected = entry.id === config.continent;
      continentSelect.appendChild(option);
    });
    continentLabel.append(continentText, continentSelect);

    const modernOrderLabel = document.createElement("label");
    modernOrderLabel.className = "legend-generator-check";
    const modernOrderInput = document.createElement("input");
    modernOrderInput.type = "checkbox";
    modernOrderInput.checked = !!config.useModernMajorOrder;
    const modernOrderText = document.createElement("span");
    modernOrderText.textContent = t("面积模式优先现代大国排序", "ui");
    modernOrderLabel.append(modernOrderInput, modernOrderText);

    const actionRow = document.createElement("div");
    actionRow.className = "legend-generator-actions";
    const applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.className = "legend-generator-apply";
    applyButton.textContent = t("生成图例", "ui");
    applyButton.addEventListener("click", () => {
      const generation = legendManager.generate(state, {
        mode: modeSelect.value,
        continent: continentSelect.value,
        useModernMajorOrder: modernOrderInput.checked,
      });
      legendManager.applyGeneratedLegend(state, generation);
      legendManager.showControl?.(state);
      markDirty("legend-generator");
      if (typeof mapRenderer.renderLegend === "function") {
        mapRenderer.renderLegend(legendManager.getUniqueColors(state), legendManager.getLabels(state));
      }
      lastLegendKey = null;
      refreshLegendEditor();
    });
    actionRow.appendChild(applyButton);

    const syncVisibility = ({ markUserChange = false } = {}) => {
      const mode = modeSelect.value;
      continentLabel.hidden = mode !== "continent-area";
      modernOrderLabel.hidden = mode === "weighted-random";
      const previousConfig = legendManager.getConfig(state);
      const nextConfig = legendManager.updateConfig(state, {
        mode,
        continent: continentSelect.value,
        useModernMajorOrder: modernOrderInput.checked,
      });
      if (markUserChange && JSON.stringify(previousConfig) !== JSON.stringify(nextConfig)) {
        markDirty("legend-generator-config");
      }
    };
    modeSelect.addEventListener("change", () => syncVisibility({ markUserChange: true }));
    continentSelect.addEventListener("change", () => syncVisibility({ markUserChange: true }));
    modernOrderInput.addEventListener("change", () => syncVisibility({ markUserChange: true }));
    syncVisibility();

    shell.append(modeLabel, continentLabel, modernOrderLabel, actionRow);
    return shell;
  };

  const fetchScenarioDiagnosticsReport = async (scenarioId, { preview = false } = {}) => {
    const url = preview
      ? `/api/scenario-diagnostics/${encodeURIComponent(scenarioId)}/preview-repair`
      : `/api/scenario-diagnostics/${encodeURIComponent(scenarioId)}`;
    const response = await fetch(url, {
      method: preview ? "POST" : "GET",
      headers: preview ? { "Content-Type": "application/json" } : undefined,
      body: preview ? JSON.stringify({ scenarioId }) : undefined,
      credentials: "same-origin",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(payload?.message || payload?.error || "Scenario diagnostics request failed."));
    }
    return payload;
  };

  const renderScenarioDiagnosticsSummary = (diagnosticsReport, diagnosticsPreview) => {
    const wrapper = document.createElement("div");
    wrapper.className = "mt-4 flex flex-col gap-2";
    const header = document.createElement("div");
    header.className = "section-header-block";
    header.textContent = t("Scenario diagnostics", "ui");
    wrapper.appendChild(header);
    if (!diagnosticsReport || typeof diagnosticsReport !== "object") {
      wrapper.appendChild(createEmptyNote(t("No diagnostics loaded", "ui")));
      return wrapper;
    }
    wrapper.appendChild(createAuditValueRow(t("Profile", "ui"), diagnosticsReport.profile || "unknown"));
    wrapper.appendChild(createAuditValueRow(
      t("Snapshot", "ui"),
      String(diagnosticsReport.snapshot_fingerprint || "").slice(0, 12) || "missing"
    ));
    wrapper.appendChild(createAuditValueRow(
      t("Safe fixes", "ui"),
      diagnosticsPreview?.preview?.safeRepairAvailable ? t("Available", "ui") : t("None", "ui")
    ));
    wrapper.appendChild(createAuditValueRow(
      t("Risky fixes", "ui"),
      Array.isArray(diagnosticsReport.risky_fixes_required) ? diagnosticsReport.risky_fixes_required.length : 0
    ));
    wrapper.appendChild(createAuditValueRow(
      t("Forbidden", "ui"),
      Array.isArray(diagnosticsReport.forbidden_violations) ? diagnosticsReport.forbidden_violations.length : 0
    ));
    wrapper.appendChild(createAuditValueRow(
      t("Owner bucket mismatches", "ui"),
      diagnosticsReport.owner_bucket_mismatch_count ?? 0
    ));
    wrapper.appendChild(createAuditValueRow(
      t("Coverage gaps", "ui"),
      diagnosticsReport.reverse_coverage_gap_count ?? 0
    ));
    const violations = Array.isArray(diagnosticsReport.violations) ? diagnosticsReport.violations.slice(0, 8) : [];
    wrapper.appendChild(createAuditList(violations, (item) => {
      const row = document.createElement("div");
      row.className = "scenario-audit-stack-row";
      row.appendChild(Object.assign(document.createElement("span"), {
        className: "inspector-mini-label scenario-audit-label",
        textContent: String(item?.fix_class || "info"),
      }));
      row.appendChild(Object.assign(document.createElement("span"), {
        className: "body-text scenario-audit-note",
        textContent: String(item?.message || ""),
      }));
      return row;
    }));
    return wrapper;
  };

  const renderScenarioAuditSummary = (auditPayload, manifestSummary = {}) => {
    const summary = getScenarioAuditSummary(auditPayload);
    const container = document.createElement("div");
    container.className = "mt-3 flex flex-col gap-2";
    container.appendChild(createAuditValueRow(
      t("Owners", "ui"),
      resolveAuditNumber(summary.owner_count, manifestSummary.owner_count)
    ));
    container.appendChild(createAuditValueRow(
      t("Features", "ui"),
      resolveAuditNumber(summary.feature_count, manifestSummary.feature_count)
    ));
    container.appendChild(createAuditValueRow(
      t("Approximate", "ui"),
      resolveAuditNumber(
        summary.approximate_count,
        summary.quality_counts?.approx_existing_geometry,
        manifestSummary.approximate_count,
        manifestSummary.quality_counts?.approx_existing_geometry
      )
    ));
    container.appendChild(createAuditValueRow(
      t("Manual-reviewed", "ui"),
      resolveAuditNumber(
        summary.manual_reviewed_feature_count,
        summary.quality_counts?.manual_reviewed,
        manifestSummary.manual_reviewed_feature_count,
        manifestSummary.quality_counts?.manual_reviewed
      )
    ));
    container.appendChild(createAuditValueRow(
      t("Synthetic", "ui"),
      resolveAuditNumber(
        summary.synthetic_count,
        summary.synthetic_owner_feature_count,
        manifestSummary.synthetic_count,
        manifestSummary.synthetic_owner_feature_count
      )
    ));
    container.appendChild(createAuditValueRow(
      t("Blockers", "ui"),
      getScenarioAuditBlockerCount(Object.keys(summary).length ? summary : manifestSummary)
    ));
    container.appendChild(createAuditValueRow(
      t("Critical checks", "ui"),
      resolveAuditNumber(
        summary.critical_region_check_count,
        summary.manual_reviewed_region_count,
        manifestSummary.critical_region_check_count,
        manifestSummary.manual_reviewed_region_count
      )
    ));
    return container;
  };

  const renderScenarioCriticalChecks = (auditPayload) => {
    const section = document.createElement("div");
    section.className = "mt-4";

    const title = document.createElement("div");
    title.className = "section-header-block";
    title.textContent = t("Critical checks", "ui");
    section.appendChild(title);

    const criticalRegions = Array.isArray(auditPayload?.critical_regions)
      ? auditPayload.critical_regions
      : [];
    const regionChecks = auditPayload?.region_checks && typeof auditPayload.region_checks === "object"
      ? auditPayload.region_checks
      : {};

    const items = criticalRegions.length
      ? criticalRegions.map((item) => ({
        regionId: String(item?.region_id || "").trim(),
        status: String(item?.status || regionChecks?.[item?.region_id]?.status || "unknown").trim(),
        notes: String(regionChecks?.[item?.region_id]?.notes || "").trim(),
      }))
      : Object.entries(regionChecks).map(([regionId, payload]) => ({
        regionId: String(regionId || "").trim(),
        status: String(payload?.status || "unknown").trim(),
        notes: String(payload?.notes || "").trim(),
      }));

    section.appendChild(createAuditList(items, ({ regionId, status, notes }) => {
      if (notes) {
        const details = document.createElement("details");
        details.className = "inspector-preset-details scenario-audit-check-details";

        const summary = document.createElement("summary");
        summary.className = "inspector-accordion-btn scenario-audit-check-summary";
        summary.textContent = `${regionId} · ${status}`;

        const body = document.createElement("div");
        body.className = "preset-country-body scenario-audit-note";
        body.textContent = notes;

        details.appendChild(summary);
        details.appendChild(body);
        return details;
      }

      const row = document.createElement("div");
      row.className = "scenario-audit-row scenario-audit-check-row";
      row.appendChild(Object.assign(document.createElement("span"), {
        className: "body-text scenario-audit-key",
        textContent: regionId,
      }));
      row.appendChild(Object.assign(document.createElement("span"), {
        className: "inspector-mini-label scenario-audit-status",
        textContent: status,
      }));
      return row;
    }));

    return section;
  };

  const renderScenarioAuditBlockers = (auditPayload) => {
    const section = document.createElement("div");
    section.className = "mt-4 flex flex-col gap-4";

    const topologyWrapper = document.createElement("div");
    const topologyTitle = document.createElement("div");
    topologyTitle.className = "section-header-block";
    topologyTitle.textContent = t("Topology blockers", "ui");
    topologyWrapper.appendChild(topologyTitle);
    topologyWrapper.appendChild(createAuditList(
      Array.isArray(auditPayload?.topology_blockers) ? auditPayload.topology_blockers : [],
      (item) => {
        const row = document.createElement("div");
        row.className = "scenario-audit-stack-row";
        row.appendChild(Object.assign(document.createElement("span"), {
          className: "body-text scenario-audit-key",
          textContent: String(item?.blocker_id || item?.id || "unknown"),
        }));
        if (item?.notes) {
          row.appendChild(Object.assign(document.createElement("span"), {
            className: "inspector-mini-label scenario-audit-note",
            textContent: String(item.notes),
          }));
        }
        return row;
      }
    ));

    const ruleWrapper = document.createElement("div");
    const ruleTitle = document.createElement("div");
    ruleTitle.className = "section-header-block";
    ruleTitle.textContent = t("Scenario rule blockers", "ui");
    ruleWrapper.appendChild(ruleTitle);
    ruleWrapper.appendChild(createAuditList(
      Array.isArray(auditPayload?.scenario_rule_blockers) ? auditPayload.scenario_rule_blockers : [],
      (item) => {
        const row = document.createElement("div");
        row.className = "scenario-audit-stack-row";
        row.appendChild(Object.assign(document.createElement("span"), {
          className: "body-text scenario-audit-key",
          textContent: String(item?.rule_id || item?.blocker_id || "unknown"),
        }));
        if (item?.notes) {
          row.appendChild(Object.assign(document.createElement("span"), {
            className: "inspector-mini-label scenario-audit-note",
            textContent: String(item.notes),
          }));
        }
        return row;
      }
    ));

    section.appendChild(topologyWrapper);
    section.appendChild(ruleWrapper);
    return section;
  };

  const renderScenarioAuditTopologySummary = (auditPayload) => {
    const section = document.createElement("div");
    section.className = "mt-4";

    const title = document.createElement("div");
    title.className = "section-header-block";
    title.textContent = t("Topology Summary", "ui");
    section.appendChild(title);

    const belarusHybrid = auditPayload?.topology_summaries?.belarus_hybrid || {};
    const rows = [
      [t("Total features", "ui"), belarusHybrid.total_feature_count],
      [t("Border rayons kept", "ui"), belarusHybrid.border_rayons_kept],
      [t("Historical composites built", "ui"), belarusHybrid.historical_composites_built],
      [t("Interior groups built", "ui"), belarusHybrid.interior_groups_built],
    ].filter(([, value]) => Number.isFinite(Number(value)));

    if (!rows.length) {
      section.appendChild(createEmptyNote(t("None", "ui")));
      return section;
    }

    const subtitle = document.createElement("div");
    subtitle.className = "inspector-mini-label mt-2";
    subtitle.textContent = t("Belarus hybrid", "ui");
    section.appendChild(subtitle);

    const list = document.createElement("div");
    list.className = "mt-2 flex flex-col gap-2";
    rows.forEach(([label, value]) => {
      list.appendChild(createAuditValueRow(label, value));
    });
    section.appendChild(list);
    return section;
  };

  const renderScenarioAuditPanel = () => {
    if (!scenarioAuditSection) return;

    // Audit 与 diagnostics 分开记录 loadedForScenarioId，切换场景时只展示当前场景的已加载结果。
    const activeScenarioId = String(state.activeScenarioId || "").trim();
    const auditUi = state.scenarioAuditUi || {};
    const diagnosticsUi = state.scenarioDiagnosticsUi || {};
    const activeAuditLoaded =
      !!activeScenarioId &&
      auditUi.loadedForScenarioId === activeScenarioId &&
      state.scenarioAudit &&
      typeof state.scenarioAudit === "object";
    const activeDiagnosticsLoaded =
      !!activeScenarioId &&
      diagnosticsUi.loadedForScenarioId === activeScenarioId &&
      state.scenarioDiagnostics &&
      typeof state.scenarioDiagnostics === "object";
    const manifestSummary =
      state.activeScenarioManifest?.summary && typeof state.activeScenarioManifest.summary === "object"
        ? state.activeScenarioManifest.summary
        : {};

    scenarioAuditSection.replaceChildren();

    const title = document.createElement("div");
    title.className = "section-header sidebar-tool-title";
    title.textContent = t("Scenario Audit", "ui");

    const hint = document.createElement("p");
    hint.className = "sidebar-tool-hint";
    hint.textContent = t(
      "Inspect critical checks, blockers, and source quality for the active scenario.",
      "ui"
    );

    scenarioAuditSection.appendChild(title);
    scenarioAuditSection.appendChild(hint);

    const appendScenarioDiagnosticsStatus = () => {
      const specialZoneDiagnostics = renderSpecialZoneRuntimeDiagnostics();
      if (specialZoneDiagnostics) {
        scenarioAuditSection.appendChild(specialZoneDiagnostics);
      }
      if (diagnosticsUi.loading) {
        scenarioAuditSection.appendChild(createEmptyNote(t("Loading diagnostics…", "ui")));
      } else if (diagnosticsUi.errorMessage) {
        const diagnosticsError = document.createElement("div");
        diagnosticsError.className = "inspector-mini-label mt-3";
        diagnosticsError.textContent = `${t("Unable to load diagnostics", "ui")}: ${diagnosticsUi.errorMessage}`;
        scenarioAuditSection.appendChild(diagnosticsError);
      } else if (activeDiagnosticsLoaded) {
        scenarioAuditSection.appendChild(
          renderScenarioDiagnosticsSummary(state.scenarioDiagnostics, state.scenarioDiagnosticsPreview)
        );
      }
    };

    if (!activeScenarioId) {
      scenarioAuditSection.appendChild(createEmptyNote(t("No scenario active", "ui")));
      return;
    }

    const actions = document.createElement("div");
    actions.className = "mt-3 flex flex-col gap-2";

    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.className = activeAuditLoaded ? "btn-secondary" : "btn-primary";
    loadButton.disabled = !!auditUi.loading;
    loadButton.textContent = t(activeAuditLoaded ? "Hide Audit Details" : "Load Audit Details", "ui");
    loadButton.addEventListener("click", async () => {
      if (activeAuditLoaded) {
        releaseScenarioAuditPayload(activeScenarioId);
        return;
      }
      try {
        await loadScenarioAuditPayload(activeScenarioId, {
          forceReload: false,
        });
      } catch (error) {
        console.error("Failed to load scenario audit:", error);
      }
    });
    actions.appendChild(loadButton);

    const diagnosticsButton = document.createElement("button");
    diagnosticsButton.type = "button";
    diagnosticsButton.className = activeDiagnosticsLoaded ? "btn-secondary" : "btn-primary";
    diagnosticsButton.disabled = !!diagnosticsUi.loading;
    diagnosticsButton.textContent = t(activeDiagnosticsLoaded ? "Hide Diagnostics" : "Load Diagnostics", "ui");
    diagnosticsButton.addEventListener("click", async () => {
      if (activeDiagnosticsLoaded) {
        setScenarioDiagnosticsState(state);
        renderScenarioAuditPanel();
        return;
      }
      setScenarioDiagnosticsState(state, {
        ui: {
          loading: true,
          errorMessage: "",
          loadedForScenarioId: activeScenarioId,
        },
      });
      renderScenarioAuditPanel();
      try {
        const report = await fetchScenarioDiagnosticsReport(activeScenarioId);
        const previewPayload = await fetchScenarioDiagnosticsReport(activeScenarioId, { preview: true });
        setScenarioDiagnosticsState(state, {
          report,
          preview: previewPayload,
          ui: {
            loading: false,
            errorMessage: "",
            loadedForScenarioId: activeScenarioId,
          },
        });
      } catch (error) {
        console.error("Failed to load scenario diagnostics:", error);
        setScenarioDiagnosticsState(state, {
          ui: {
            loading: false,
            errorMessage: String(error?.message || error || ""),
            loadedForScenarioId: activeScenarioId,
          },
        });
      }
      renderScenarioAuditPanel();
    });
    actions.appendChild(diagnosticsButton);

    if (!activeAuditLoaded) {
      if (auditUi.loading) {
        scenarioAuditSection.appendChild(createEmptyNote(t("Loading audit details…", "ui")));
      } else if (auditUi.errorMessage) {
        const errorNote = createEmptyNote(t("Unable to load audit details", "ui"));
        scenarioAuditSection.appendChild(errorNote);

        const detail = document.createElement("div");
        detail.className = "inspector-mini-label mt-2";
        detail.textContent = auditUi.errorMessage;
        scenarioAuditSection.appendChild(detail);
      }
      appendScenarioDiagnosticsStatus();
      scenarioAuditSection.appendChild(actions);
      return;
    }

    if (auditUi.loading) {
      scenarioAuditSection.appendChild(createEmptyNote(t("Loading audit details…", "ui")));
    } else if (auditUi.errorMessage) {
      const errorDetail = document.createElement("div");
      errorDetail.className = "inspector-mini-label mt-3";
      errorDetail.textContent = `${t("Unable to load audit details", "ui")}: ${auditUi.errorMessage}`;
      scenarioAuditSection.appendChild(errorDetail);
    }

    scenarioAuditSection.appendChild(renderScenarioAuditSummary(state.scenarioAudit, manifestSummary));
    scenarioAuditSection.appendChild(renderScenarioCriticalChecks(state.scenarioAudit));
    scenarioAuditSection.appendChild(renderScenarioAuditBlockers(state.scenarioAudit));
    scenarioAuditSection.appendChild(renderScenarioAuditTopologySummary(state.scenarioAudit));
    appendScenarioDiagnosticsStatus();
    scenarioAuditSection.appendChild(actions);
  };


  const LEGEND_EDITOR_PAGE_SIZE = 10;
  const LEGEND_EDITOR_MAX_ITEMS = 30;
  let legendEditorPageIndex = 0;
  let lastLegendKey = null;

  const clearLegendList = () => {
    if (typeof legendList.replaceChildren === "function") {
      legendList.replaceChildren();
      return;
    }
    legendList.innerHTML = "";
  };

  const createLegendLabelRow = (color, index, colors) => {
    const row = document.createElement("div");
    row.className = "legend-row";

    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.backgroundColor = color;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "legend-input";
    input.placeholder = `Category ${index + 1}`;
    input.setAttribute("aria-label", `${t("Legend", "ui")} ${index + 1}: ${color}`);
    input.value = legendManager.getLabel(color, state);
    input.addEventListener("input", (event) => {
      legendManager.setLabel(color, event.target.value, state);
      markDirty("legend-label");
      mapRenderer.renderLegend(colors, legendManager.getLabels(state));
    });

    row.appendChild(swatch);
    row.appendChild(input);
    return row;
  };

  const createLegendPagerControls = (pageIndex, pageCount) => {
    const pager = document.createElement("div");
    pager.className = "legend-editor-pager";

    const previousButton = document.createElement("button");
    previousButton.type = "button";
    previousButton.className = "legend-editor-page-btn";
    previousButton.textContent = "‹";
    previousButton.ariaLabel = t("Previous page", "ui");
    previousButton.disabled = pageIndex <= 0;
    previousButton.addEventListener("click", () => {
      legendEditorPageIndex = Math.max(0, legendEditorPageIndex - 1);
      lastLegendKey = null;
      refreshLegendEditor();
    });

    const pageStatus = document.createElement("span");
    pageStatus.className = "legend-editor-page-status";
    pageStatus.textContent = `${pageIndex + 1} / ${pageCount}`;

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "legend-editor-page-btn";
    nextButton.textContent = "›";
    nextButton.ariaLabel = t("Next page", "ui");
    nextButton.disabled = pageIndex >= pageCount - 1;
    nextButton.addEventListener("click", () => {
      legendEditorPageIndex = Math.min(pageCount - 1, legendEditorPageIndex + 1);
      lastLegendKey = null;
      refreshLegendEditor();
    });

    pager.append(previousButton, pageStatus, nextButton);
    return pager;
  };

  const refreshLegendEditor = () => {
    if (!legendList) return;
    incrementSidebarCounter("legendRenders");
    const colors = legendManager.getUniqueColors(state);
    const specialZoneLegendLayers = getVisibleSpecialZoneLegendLayers();
    const specialZoneLegendKey = legendManager.getSpecialZoneSignature(state);
    const colorItems = colors.map((color, index) => ({ type: "color", color, index }));
    const specialZoneItems = specialZoneLegendLayers.map((layer) => ({ type: "special-zone", layer }));
    const cappedItems = [...colorItems, ...specialZoneItems].slice(0, LEGEND_EDITOR_MAX_ITEMS);
    const pageCount = Math.max(1, Math.ceil(cappedItems.length / LEGEND_EDITOR_PAGE_SIZE));
    legendEditorPageIndex = Math.min(Math.max(legendEditorPageIndex, 0), pageCount - 1);
    const pageStart = legendEditorPageIndex * LEGEND_EDITOR_PAGE_SIZE;
    const pageItems = cappedItems.slice(pageStart, pageStart + LEGEND_EDITOR_PAGE_SIZE);
    const visibleLegendRows = Math.min(Math.max(pageItems.length, 1), LEGEND_EDITOR_PAGE_SIZE);
    const pagerReserve = pageCount > 1 ? 38 : 0;
    legendList.dataset.pageCount = String(pageCount);
    legendList.dataset.paged = pageCount > 1 ? "true" : "false";
    legendList.style.setProperty("--legend-editor-dynamic-max-height", `${Math.min(680, 168 + (visibleLegendRows * 52) + pagerReserve)}px`);
    const key = [
      colors.join("|"),
      specialZoneLegendKey,
      JSON.stringify(legendManager.getConfig(state)),
      legendEditorPageIndex,
    ].join("::");
    if (key === lastLegendKey && legendList.dataset.ready === "true") return;
    lastLegendKey = key;
    legendList.dataset.ready = "true";
    clearLegendList();
    legendList.appendChild(createLegendGeneratorControls());

    if (!colors.length && !specialZoneLegendKey) {
      const empty = document.createElement("div");
      empty.className = "legend-empty-state";
      empty.textContent = t("先生成或填充地图颜色，再在这里修改图例名称。", "ui");
      legendList.appendChild(empty);
      return;
    }

    pageItems.filter((item) => item.type === "color").forEach((item) => {
      legendList.appendChild(createLegendLabelRow(item.color, item.index, colors));
    });
    const visibleSpecialZoneLayers = pageItems
      .filter((item) => item.type === "special-zone")
      .map((item) => item.layer);
    appendSpecialZoneLegendRows(visibleSpecialZoneLayers);
    if (pageCount > 1) {
      legendList.appendChild(createLegendPagerControls(legendEditorPageIndex, pageCount));
    }
  };


  const bindEvents = () => {
    refreshProjectSaveStatus();
    syncProjectPackageContentAvailability();
    if (projectDownloadFormat?.dataset && !projectDownloadFormat.dataset.packageContentsBound) {
      projectDownloadFormat.addEventListener?.("change", syncProjectPackageContentAvailability);
      projectDownloadFormat.dataset.packageContentsBound = "true";
    }
    const exportProject = async () => {
      if (projectExportBusy) return;
      projectExportBusy = true;
      const buttons = [downloadProjectBtn, workspaceSaveBtn].filter(Boolean);
      const disabledStates = buttons.map((button) => button.disabled);
      buttons.forEach((button) => { button.disabled = true; });
      refreshProjectSaveStatus(t("Exporting project file with appearance and transport settings.", "ui"));
      try {
        const exported = await fileManager.exportProject(state, {
          format: projectDownloadFormat?.value || "json",
          destination: projectDownloadDestination?.value || "picker",
          packageContents: projectPackageContents?.value || "recommended",
        });
        refreshProjectSaveStatus(exported === false ? t("Project export cancelled.", "ui") : "");
      } catch (error) {
        refreshProjectSaveStatus(String(error?.message || error || ""));
      } finally {
        projectExportBusy = false;
        buttons.forEach((button, index) => { button.disabled = disabledStates[index]; });
      }
    };
    [downloadProjectBtn, workspaceSaveBtn].forEach((button) => {
      if (!button || button.dataset.bound) return;
      button.addEventListener("click", exportProject);
      button.dataset.bound = "true";
    });

    if (uploadProjectBtn && projectFileInput && !uploadProjectBtn.dataset.bound) {
      uploadProjectBtn.addEventListener("click", async () => {
        if (String(projectLoadSource?.value || "local") === "community") {
          openBackendAccountPopover();
          try {
            await refreshCommunitySaves();
            setBackendCloudStatus(t("Community saves refreshed.", "ui"));
          } catch (error) {
            setBackendCloudStatus(String(error?.message || error || ""));
          }
          return;
        }
        if (!(await confirmReplaceCurrentProject())) return;
        projectFileInput.click();
      });
      uploadProjectBtn.dataset.bound = "true";
    }

    if (projectFileInput && !projectFileInput.dataset.bound) {
      projectFileInput.addEventListener("change", async () => {
        projectImportController?.abort();
        const importController = new AbortController();
        projectImportController = importController;
        const file = projectFileInput.files?.[0];
        if (!file) {
          projectImportController = null;
          if (projectFileName) {
            if (projectFileName.dataset) projectFileName.dataset.projectFileState = "empty";
            projectFileName.textContent = t("No file selected", "ui");
          }
          refreshProjectSaveStatus(t("No file selected", "ui"));
          return;
        }
        if (projectFileName) {
          if (projectFileName.dataset) projectFileName.dataset.projectFileState = "selected";
          projectFileName.textContent = file.name;
        }
        refreshProjectSaveStatus(t("Project import started. Appearance and transport settings will be restored from the file.", "ui"));
        lastProjectImportSummary = null;
        try {
          const { file: importFile, preview, projectPayload } = await prepareProjectImportFile(file, {
            materializeFile: false,
            signal: importController.signal,
          });
          if (importController.signal.aborted) return;
          const confirmed = await confirmProjectPackagePreview(preview);
          if (importController.signal.aborted) return;
          if (!confirmed) {
            refreshProjectSaveStatus(t("Project import cancelled.", "ui"));
            return;
          }
          const outcome = await importProjectThroughFunnel(importFile, {
            projectPayload,
            fileName: file.name,
            signal: importController.signal,
            ui: {
              t,
              showAppDialog,
              showToast,
            },
            hooks: {
              refreshColorState: mapRenderer.refreshColorState,
              invalidateFrontlineOverlayState,
              onProjectImportComplete: completeProjectImportStatus,
                onProjectImportError: failProjectImportStatus,
                onProjectImportRecoveryState: recovery => {
                  if (projectImportController && projectImportController !== importController) return;
                  if (recovery.phase === "complete") refreshProjectSaveStatus();
                  else if (recovery.warnings.length) refreshProjectSaveStatus(
                    `${t("Project imported", "ui")}: ${recovery.warnings.map(item => item.resource).join(", ")}`
                  );
                },
            },
          });
          if (importController.signal.aborted) return;
          if (outcome?.status === "committed-with-warnings") {
            refreshProjectSaveStatus(`${t("Project imported", "ui")}: ${outcome.warnings.map(item => item.resource).join(", ")}`);
          } else if (outcome?.status === "failed" && outcome.reason === "import-in-progress") {
            refreshProjectSaveStatus(t("Project import is already in progress.", "ui"));
          }
        } catch (error) {
          if (importController.signal.aborted) return;
          const message = String(error?.message || error || "");
          refreshProjectSaveStatus(message);
          if (typeof showToast === "function") {
            showToast(message, {
              title: t("Project import failed", "ui"),
              tone: "error",
            });
          }
        } finally {
          if (projectImportController === importController) {
            projectFileInput.value = "";
            projectImportController = null;
          }
        }
      });
      projectFileInput.dataset.bound = "true";
    }

    if (backendAccountToggleBtn && backendAccountPopover && !backendAccountToggleBtn.dataset.bound) {
      backendAccountToggleBtn.addEventListener("click", () => {
        const isOpen = !backendAccountPopover.classList.contains("hidden");
        if (isOpen) {
          setBackendAccountPopoverOpen(false);
        } else {
          openBackendAccountPopover();
        }
      });
      backendAccountToggleBtn.dataset.bound = "true";
    }

    if (backendAccountBackdrop && !backendAccountBackdrop.dataset.bound) {
      backendAccountBackdrop.addEventListener("click", () => setBackendAccountPopoverOpen(false));
      backendAccountBackdrop.dataset.bound = "true";
    }

    if (backendAccountCloseBtn && !backendAccountCloseBtn.dataset.bound) {
      backendAccountCloseBtn.addEventListener("click", () => setBackendAccountPopoverOpen(false));
      backendAccountCloseBtn.dataset.bound = "true";
    }

    if (backendAccountPopover && !backendAccountPopover.dataset.escapeBound) {
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !backendAccountPopover.classList.contains("hidden")) {
          setBackendAccountPopoverOpen(false);
        }
      });
      backendAccountPopover.dataset.escapeBound = "true";
    }

    if (debugModeSelect && !debugModeSelect.dataset.bound) {
      debugModeSelect.value = String(state.debugMode || "PROD").toUpperCase();
      debugModeSelect.addEventListener("change", (event) => {
        mapRenderer.setDebugMode(event.target.value);
      });
      debugModeSelect.dataset.bound = "true";
    }

    if (backendCloudRegisterBtn && !backendCloudRegisterBtn.dataset.bound) {
      backendCloudRegisterBtn.addEventListener("click", async () => {
        try {
          const credentials = getBackendCredentials();
          const payload = await registerBackendUser({
            ...credentials,
            displayName: credentials.username,
          });
          latestCloudSaveId = "";
          latestCloudSaveUserKey = "";
          updateActiveCloudUser(payload?.user);
          setBackendCloudSessionState("authenticated");
          setBackendCloudStatus(`${t("Logged in as", "ui")} ${payload?.user?.displayName || credentials.username}`);
        } catch (error) {
          setBackendCloudStatus(String(error?.message || error || ""));
        }
      });
      backendCloudRegisterBtn.dataset.bound = "true";
    }

    if (backendCloudLoginBtn && !backendCloudLoginBtn.dataset.bound) {
      backendCloudLoginBtn.addEventListener("click", async () => {
        try {
          const credentials = getBackendCredentials();
          const payload = await loginBackendUser(credentials);
          latestCloudSaveId = "";
          latestCloudSaveUserKey = "";
          updateActiveCloudUser(payload?.user);
          setBackendCloudSessionState("authenticated");
          setBackendCloudStatus(`${t("Logged in as", "ui")} ${payload?.user?.displayName || credentials.username}`);
        } catch (error) {
          setBackendCloudStatus(String(error?.message || error || ""));
        }
      });
      backendCloudLoginBtn.dataset.bound = "true";
    }

    if (backendCloudLogoutBtn && !backendCloudLogoutBtn.dataset.bound) {
      backendCloudLogoutBtn.addEventListener("click", async () => {
        try {
          await logoutBackendUser();
          clearActiveCloudUser();
          setBackendCloudSessionState("anonymous");
          setBackendCloudStatus(t("Logged out.", "ui"));
        } catch (error) {
          setBackendCloudStatus(String(error?.message || error || ""));
        }
      });
      backendCloudLogoutBtn.dataset.bound = "true";
    }

    if (backendCloudSaveBtn && !backendCloudSaveBtn.dataset.bound) {
      backendCloudSaveBtn.addEventListener("click", async () => {
        await runExclusiveButtonTask(backendCloudSaveBtn, async () => {
          try {
            const project = fileManager.buildProjectPayload?.(state);
            if (!project) throw new Error("Project state is unavailable.");
            const payload = await createBackendSave({
              title: getCloudSaveTitle(),
              description: String(state.activeScenarioId || ""),
              project,
            });
            latestCloudSaveId = String(payload?.save?.id || "");
            latestCloudSaveUserKey = activeCloudUserKey;
            setBackendCloudStatus(t("Cloud save created.", "ui"));
          } catch (error) {
            setBackendCloudStatus(String(error?.message || error || ""));
          }
        }, restoreBackendCloudControls);
      });
      backendCloudSaveBtn.dataset.bound = "true";
    }

    if (backendCloudPublishBtn && !backendCloudPublishBtn.dataset.bound) {
      backendCloudPublishBtn.addEventListener("click", async () => {
        await runExclusiveButtonTask(backendCloudPublishBtn, async () => {
          try {
            const saveId = await resolveLatestCloudSaveId();
            if (!saveId) throw new Error("Create a cloud save before publishing.");
            await publishBackendSave(saveId);
            await refreshCommunitySaves();
            setBackendCloudStatus(t("Latest cloud save published.", "ui"));
          } catch (error) {
            setBackendCloudStatus(String(error?.message || error || ""));
          }
        }, restoreBackendCloudControls);
      });
      backendCloudPublishBtn.dataset.bound = "true";
    }

    if (backendCommunityRefreshBtn && !backendCommunityRefreshBtn.dataset.bound) {
      backendCommunityRefreshBtn.addEventListener("click", async () => {
        await runExclusiveButtonTask(backendCommunityRefreshBtn, async () => {
          try {
            await refreshCommunitySaves();
            setBackendCloudStatus(t("Community saves refreshed.", "ui"));
          } catch (error) {
            setBackendCloudStatus(String(error?.message || error || ""));
          }
        }, restoreBackendCloudControls);
      });
      backendCommunityRefreshBtn.dataset.bound = "true";
    }

  };

  return {
    bindEvents,
    refreshProjectSaveStatus,
    refreshLegendEditor,
    renderScenarioAuditPanel,
  };
}
