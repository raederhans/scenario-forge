// 控件画廊：把每个样本复制成"默认 / 悬停 / 聚焦 / 禁用"等状态格，再调用真实的
// styled_selects、app_dialog、toast 生成结构。悬停和聚焦只做标记（data-force），
// 由截图 spec 通过 DevTools 协议强制伪类，页面本身不模拟交互。
import { initStyledSelects } from "../../../js/ui/styled_selects.js";
import { showAppDialog } from "../../../js/ui/components/app_dialog.js";
import { initToast, showToast } from "../../../js/ui/components/toast.js";

const STATE_LABELS = {
  default: "默认",
  hover: "悬停",
  focus: "聚焦",
  disabled: "禁用",
  selected: "选中",
  open: "展开",
};

function findTarget(cell) {
  return cell.querySelector("[data-gallery-target]")
    || cell.querySelector("summary, button, input, select, a");
}

function applyState(cell, stateName) {
  const target = findTarget(cell);
  if (!target) return;
  if (stateName === "hover") target.dataset.force = "hover";
  if (stateName === "focus") target.dataset.force = "focus focus-visible";
  if (stateName === "disabled") target.disabled = true;
  if (stateName === "selected") {
    if (target.hasAttribute("aria-selected")) target.setAttribute("aria-selected", "true");
    if (target.hasAttribute("aria-pressed")) target.setAttribute("aria-pressed", "true");
    // 与各 owner 的选中写法一致：国家行把 is-selected 加在行容器上（country_inspector_controller.js），
    // 调色板行加在按钮自身，其余家族用 is-active。
    const countryRow = target.closest(".country-select-row");
    if (countryRow) countryRow.classList.add("is-selected");
    else target.classList.add(target.classList.contains("palette-library-row") ? "is-selected" : "is-active");
  }
  if (stateName === "open") target.closest("details")?.setAttribute("open", "");
}

function buildSpecimenRows() {
  document.querySelectorAll("[data-specimen]").forEach((specimen) => {
    const states = (specimen.dataset.states || "default hover focus disabled").split(/\s+/);
    const template = Array.from(specimen.childNodes);
    const row = document.createElement("div");
    row.className = "gallery-row";
    const name = document.createElement("div");
    name.className = "gallery-row-name";
    name.textContent = specimen.dataset.specimen;
    row.appendChild(name);
    states.forEach((stateName) => {
      const cell = document.createElement("div");
      cell.className = "gallery-cell";
      cell.dataset.state = stateName;
      const caption = document.createElement("span");
      caption.className = "gallery-cell-caption";
      caption.textContent = STATE_LABELS[stateName] || stateName;
      const stage = document.createElement("div");
      stage.className = "gallery-cell-stage";
      template.forEach((node) => stage.appendChild(node.cloneNode(true)));
      cell.append(caption, stage);
      applyState(stage, stateName);
      row.appendChild(cell);
    });
    specimen.replaceChildren(row);
  });
}

function buildDialogs() {
  document.querySelectorAll(".gallery-dialog-slot").forEach((slot) => {
    const tone = slot.dataset.dialogTone;
    void showAppDialog({
      title: tone === "warning" ? "Discard unsaved changes?" : "Apply preset to 12 regions?",
      message: tone === "warning"
        ? "Your edits since the last save will be lost."
        : "Existing colors in these regions will be replaced.",
      details: tone === "warning" ? "3 layers and 41 parcels changed." : "",
      confirmLabel: tone === "warning" ? "Discard" : "Apply",
      cancelLabel: "Cancel",
      tone,
    });
    // 同一时间只允许一个弹窗，打开下一个会关掉上一个；所以复制生成的结构放进画廊格子，
    // 遮罩改成静态展示，其余结构保持生成时原样。
    const overlay = document.body.lastElementChild;
    if (overlay?.matches(".app-dialog-overlay")) {
      const copy = overlay.cloneNode(true);
      copy.classList.add("gallery-inline-overlay");
      slot.appendChild(copy);
      overlay.remove();
    }
  });
}

function buildToasts() {
  initToast();
  showToast("Project saved.", { tone: "success", duration: 0 });
  showToast("Map data is still loading.", { title: "Heads up", tone: "info", duration: 0 });
  showToast("Some parcels were skipped.", { tone: "warning", duration: 0, actionLabel: "Review", onAction: () => {} });
  showToast("Export failed.", { title: "Error", tone: "error", duration: 0, actionLabel: "Retry", onAction: () => {} });
}

// 增强后的下拉由外壳按钮承接交互，强制状态要落在按钮上。
function moveForcedStateToSelectButtons() {
  document.querySelectorAll("select[data-force]").forEach((select) => {
    const button = select.closest(".app-select-shell")?.querySelector(".app-select-button");
    if (!button) return;
    button.dataset.force = select.dataset.force;
    delete select.dataset.force;
  });
}

buildSpecimenRows();
initStyledSelects(document);
moveForcedStateToSelectButtons();
buildDialogs();
buildToasts();
await document.fonts.ready;
document.documentElement.dataset.galleryReady = "true";
