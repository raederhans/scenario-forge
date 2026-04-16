// Translation helpers (Phase 13)
import { state } from "../core/state.js";

const INLINE_UI_TRANSLATIONS = Object.freeze({
  Guide: { zh: "\u6307\u5357", en: "Guide" },
  Reference: { zh: "\u53c2\u8003", en: "Reference" },
  Export: { zh: "\u5bfc\u51fa", en: "Export" },
  Language: { zh: "\u8bed\u8a00", en: "Language" },
  "Viewport controls": { zh: "\u89c6\u53e3\u63a7\u5236", en: "Viewport controls" },
  "System status": { zh: "\u7cfb\u7edf\u72b6\u6001", en: "System status" },
  "Workspace entry": { zh: "\u5de5\u4f5c\u533a\u5165\u53e3", en: "Workspace entry" },
  "Transport guide": { zh: "Transport \u6307\u5357", en: "Transport guide" },
  "Guide sections": { zh: "\u6307\u5357\u5206\u6bb5", en: "Guide sections" },
  "Quick path": { zh: "\u5feb\u901f\u8def\u5f84", en: "Quick path" },
  "Before you edit": { zh: "\u5f00\u59cb\u524d", en: "Before you edit" },
  "Project tools": { zh: "\u9879\u76ee\u5de5\u5177", en: "Project tools" },
  Checks: { zh: "\u68c0\u67e5", en: "Checks" },
  "Scenario Quick Start": { zh: "\u573a\u666f\u5feb\u901f\u5f00\u59cb", en: "Scenario Quick Start" },
  "Close scenario guide": { zh: "\u5173\u95ed\u573a\u666f\u6307\u5357", en: "Close scenario guide" },
  "Classic Graphite": { zh: "\u7ecf\u5178\u77f3\u58a8\u7070", en: "Classic Graphite" },
  "Atlas Ink": { zh: "\u56fe\u96c6\u58a8\u84dd", en: "Atlas Ink" },
  "Parchment Sepia": { zh: "\u7eb8\u9762\u68d5\u8910", en: "Parchment Sepia" },
  "Slate Blue": { zh: "\u77f3\u677f\u84dd", en: "Slate Blue" },
  "Ivory Outline": { zh: "\u8c61\u7259\u63cf\u8fb9", en: "Ivory Outline" },
  "Preset & Density": { zh: "\u9884\u8bbe\u4e0e\u5bc6\u5ea6", en: "Preset & Density" },
  "Choose a restrained map treatment first, then tune how many point markers and labels are allowed to surface.": {
    zh: "\u5148\u9009\u62e9\u4e00\u5957\u66f4\u514b\u5236\u7684\u5730\u56fe\u98ce\u683c\uff0c\u518d\u8c03\u6574\u5141\u8bb8\u51fa\u73b0\u7684\u57ce\u5e02\u70b9\u548c\u6807\u7b7e\u6570\u91cf\u3002",
    en: "Choose a restrained map treatment first, then tune how many point markers and labels are allowed to surface.",
  },
  "Visibility": { zh: "\u53ef\u89c1\u6027", en: "Visibility" },
  "Show Rail": { zh: "\u663e\u793a\u94c1\u8def", en: "Show Rail" },
  "Show Rail Labels": { zh: "\u663e\u793a\u94c1\u8def\u6807\u7b7e", en: "Show Rail Labels" },
  "Show Road": { zh: "\u663e\u793a\u9053\u8def", en: "Show Road" },
  road: { zh: "\u9053\u8def", en: "road" },
  roads: { zh: "\u9053\u8def", en: "roads" },
  railway: { zh: "\u94c1\u8def", en: "railway" },
  railways: { zh: "\u94c1\u8def", en: "railways" },
  "Rail labels currently use line names only.": {
    zh: "\u5f53\u524d\u94c1\u8def\u6807\u7b7e\u53ea\u4f7f\u7528\u7ebf\u8def\u540d\u79f0\u3002",
    en: "Rail labels currently use line names only.",
  },
  "Mainline Only": { zh: "\u4ec5\u4e3b\u5e72\u7ebf", en: "Mainline Only" },
  "Mainline + Regional": { zh: "\u4e3b\u5e72\u7ebf + \u533a\u57df\u7ebf", en: "Mainline + Regional" },
  "Motorway Only": { zh: "\u4ec5\u9ad8\u901f\u516c\u8def", en: "Motorway Only" },
  "Motorway + Trunk": { zh: "\u9ad8\u901f\u516c\u8def + \u4e3b\u5e72\u9053", en: "Motorway + Trunk" },
  "Road labels stay off in this first runtime pass.": {
    zh: "\u8fd9\u4e00\u7248 runtime \u91cc\u9053\u8def\u6807\u7b7e\u4ecd\u7136\u5173\u95ed\u3002",
    en: "Road labels stay off in this first runtime pass.",
  },
  "Keep the main visibility controls together so opacity, labels, and capital emphasis read as one layer.": {
    zh: "\u628a\u4e3b\u8981\u7684\u53ef\u89c1\u6027\u63a7\u4ef6\u653e\u5728\u4e00\u8d77\uff0c\u8ba9\u900f\u660e\u5ea6\u3001\u6807\u7b7e\u548c\u9996\u90fd\u5f3a\u8c03\u8bfb\u8d77\u6765\u5c5e\u4e8e\u540c\u4e00\u5c42\u3002",
    en: "Keep the main visibility controls together so opacity, labels, and capital emphasis read as one layer.",
  },
  "Fine-tune colors and label size once the preset and density feel close.": {
    zh: "\u5f53\u9884\u8bbe\u548c\u5bc6\u5ea6\u5df2\u7ecf\u63a5\u8fd1\u7406\u60f3\u72b6\u6001\u65f6\uff0c\u518d\u8fdb\u4e00\u6b65\u5fae\u8c03\u989c\u8272\u548c\u6807\u7b7e\u5927\u5c0f\u3002",
    en: "Fine-tune colors and label size once the preset and density feel close.",
  },
  "Apply Scenario": { zh: "\u5e94\u7528\u573a\u666f", en: "Apply Scenario" },
  "Select a country in Inspector": { zh: "\u5728 Inspector \u4e2d\u9009\u62e9\u56fd\u5bb6", en: "Select a country in Inspector" },
  "Use an active owner for political actions": { zh: "\u4f7f\u7528\u5f53\u524d\u6fc0\u6d3b\u5f52\u5c5e\u6267\u884c\u653f\u6cbb\u64cd\u4f5c", en: "Use an active owner for political actions" },
  "Use Activate or Scenario Actions for ownership changes": { zh: "\u901a\u8fc7 Activate \u6216 Scenario Actions \u4fee\u6539\u5f52\u5c5e", en: "Use Activate or Scenario Actions for ownership changes" },
  "Historical only": { zh: "\u4ec5\u9650\u5386\u53f2\u6a21\u5f0f", en: "Historical only" },
  "Historical Light Density": { zh: "\u5386\u53f2\u706f\u5149\u5bc6\u5ea6", en: "Historical Light Density" },
  "Secondary City Retention": { zh: "\u6b21\u7ea7\u57ce\u5e02\u4fdd\u7559", en: "Secondary City Retention" },
  "Reference Image": { zh: "\u53c2\u8003\u56fe\u50cf", en: "Reference Image" },
  "Open this manual from the scenario bar or the Utilities panel. Both Guide buttons open the same help surface, so you can keep the next editing step visible while you work.": {
    zh: "\u53ef\u4ee5\u4ece\u9876\u90e8 scenario bar \u6216 Utilities \u9762\u677f\u6253\u5f00\u8fd9\u4efd\u624b\u518c\u3002\u4e24\u4e2a Guide \u6309\u94ae\u6253\u5f00\u7684\u662f\u540c\u4e00\u4e2a\u5e2e\u52a9\u9762\u677f\uff0c\u8fd9\u6837\u4f60\u53ef\u4ee5\u4e00\u8fb9\u64cd\u4f5c\uff0c\u4e00\u8fb9\u4fdd\u6301\u4e0b\u4e00\u6b65\u53ef\u89c1\u3002",
    en: "Open this manual from the scenario bar or the Utilities panel. Both Guide buttons open the same help surface, so you can keep the next editing step visible while you work.",
  },
  "Upload a local image, align it with opacity / scale / offsets, then keep those alignment values in the project. The image file itself needs to be uploaded again when you restore the project.": {
    zh: "\u4e0a\u4f20\u4e00\u5f20\u672c\u5730\u56fe\u50cf\uff0c\u518d\u7528 opacity / scale / offsets \u5b8c\u6210\u5bf9\u4f4d\u3002\u9879\u76ee\u4f1a\u4fdd\u5b58\u8fd9\u4e9b\u5bf9\u4f4d\u53c2\u6570\uff0c\u4f46\u56fe\u50cf\u6587\u4ef6\u672c\u8eab\u5728\u91cd\u65b0\u6253\u5f00\u9879\u76ee\u65f6\u9700\u8981\u518d\u6b21\u4e0a\u4f20\u3002",
    en: "Upload a local image, align it with opacity / scale / offsets, then keep those alignment values in the project. The image file itself needs to be uploaded again when you restore the project.",
  },
  Target: { zh: "\u76ee\u6807", en: "Target" },
  "Composite image": { zh: "\u4e3b\u56fe\u5408\u6210", en: "Composite image" },
  "Per-layer PNG": { zh: "\u5355\u5c42 PNG", en: "Per-layer PNG" },
  "Bake pack (v1.1)": { zh: "\u70d8\u7119\u5305\uff08v1.1\uff09", en: "Bake pack (v1.1)" },
  "Target:": { zh: "\u76ee\u6807\uff1a", en: "Target:" },
  "Composite image": { zh: "\u4e3b\u56fe\u5408\u6210", en: "Composite image" },
  "Per-layer PNG": { zh: "\u5355\u5c42 PNG", en: "Per-layer PNG" },
  "Bake pack (v1.1)": { zh: "\u70d8\u7119\u5305\uff08v1.1\uff09", en: "Bake pack (v1.1)" },
  "Main Layers": { zh: "\u4e3b\u56fe\u5c42", en: "Main Layers" },
  "Drag to reorder exported layer groups. Visibility only applies to this export session.": {
    zh: "\u62d6\u52a8\u4ee5\u91cd\u6392\u5bfc\u51fa\u56fe\u5c42\u7ec4\u3002\u53ef\u89c1\u6027\u8bbe\u7f6e\u4ec5\u5f71\u54cd\u5f53\u524d\u5bfc\u51fa\u4f1a\u8bdd\u3002",
    en: "Drag to reorder exported layer groups. Visibility only applies to this export session.",
  },
  "Selected export target is not available yet. Falling back to Composite image.": {
    zh: "\u6240\u9009\u5bfc\u51fa\u76ee\u6807\u6682\u4e0d\u53ef\u7528\uff0c\u5df2\u81ea\u52a8\u56de\u9000\u5230\u4e3b\u56fe\u5408\u6210\u5bfc\u51fa\u3002",
    en: "Selected export target is not available yet. Falling back to Composite image.",
  },
  "Export target fallback": {
    zh: "\u5bfc\u51fa\u76ee\u6807\u56de\u9000",
    en: "Export target fallback",
  },
  "Export Resolution": {
    zh: "\u5bfc\u51fa\u5206\u8fa8\u7387",
    en: "Export Resolution",
  },
  "Current preview (1\u00d7)": {
    zh: "\u5f53\u524d\u9884\u89c8\uff081\u00d7\uff09",
    en: "Current preview (1\u00d7)",
  },
  "High (1.5\u00d7)": {
    zh: "\u9ad8\uff081.5\u00d7\uff09",
    en: "High (1.5\u00d7)",
  },
  "Ultra (2\u00d7)": {
    zh: "\u8d85\u6e05\uff082\u00d7\uff09",
    en: "Ultra (2\u00d7)",
  },
  "Maximum detail (4\u00d7)": {
    zh: "\u6700\u9ad8\u7ec6\u8282\uff084\u00d7\uff09",
    en: "Maximum detail (4\u00d7)",
  },
  "Preview rendering and final export resolution are independent. Final export is capped at 8K (7680 \u00d7 4320).": {
    zh: "\u9884\u89c8\u6e32\u67d3\u4e0e\u6700\u7ec8\u5bfc\u51fa\u5206\u8fa8\u7387\u76f8\u4e92\u72ec\u7acb\u3002\u6700\u7ec8\u5bfc\u51fa\u4e0a\u9650\u4e3a 8K\uff087680 \u00d7 4320\uff09\u3002",
    en: "Preview rendering and final export resolution are independent. Final export is capped at 8K (7680 \u00d7 4320).",
  },
  "An export is already in progress. Wait for it to finish before starting another export.": {
    zh: "\u5bfc\u51fa\u4efb\u52a1\u6b63\u5728\u8fdb\u884c\u4e2d\u3002\u8bf7\u7b49\u5f85\u5f53\u524d\u4efb\u52a1\u5b8c\u6210\u540e\u518d\u53d1\u8d77\u65b0\u7684\u5bfc\u51fa\u3002",
    en: "An export is already in progress. Wait for it to finish before starting another export.",
  },
  "Export queue is full": {
    zh: "\u5bfc\u51fa\u961f\u5217\u5df2\u6ee1",
    en: "Export queue is full",
  },
  "Export failed: not enough available memory. Reduce export resolution (for example 2\u00d7 \u2192 1\u00d7), close heavy tabs, then retry.": {
    zh: "\u5bfc\u51fa\u5931\u8d25\uff1a\u53ef\u7528\u5185\u5b58\u4e0d\u8db3\u3002\u8bf7\u964d\u4f4e\u5bfc\u51fa\u5206\u8fa8\u7387\uff08\u4f8b\u5982 2\u00d7 \u2192 1\u00d7\uff09\uff0c\u5173\u95ed\u9ad8\u5360\u7528\u9875\u7b7e\u540e\u91cd\u8bd5\u3002",
    en: "Export failed: not enough available memory. Reduce export resolution (for example 2\u00d7 \u2192 1\u00d7), close heavy tabs, then retry.",
  },
  "Export failed \u00b7 Out of memory": {
    zh: "\u5bfc\u51fa\u5931\u8d25 \u00b7 \u5185\u5b58\u4e0d\u8db3",
    en: "Export failed \u00b7 Out of memory",
  },
  "Export failed: SVG overlay includes cross-origin assets. Use same-origin assets, remove cross-origin images, or hide SVG overlays before retrying.": {
    zh: "\u5bfc\u51fa\u5931\u8d25\uff1aSVG \u53e0\u52a0\u5c42\u5305\u542b\u8de8\u57df\u8d44\u6e90\u3002\u8bf7\u4f7f\u7528\u540c\u6e90\u8d44\u6e90\uff0c\u79fb\u9664\u8de8\u57df\u56fe\u7247\uff0c\u6216\u5148\u9690\u85cf SVG \u53e0\u52a0\u5c42\u540e\u91cd\u8bd5\u3002",
    en: "Export failed: SVG overlay includes cross-origin assets. Use same-origin assets, remove cross-origin images, or hide SVG overlays before retrying.",
  },
  "Export failed \u00b7 Cross-origin SVG": {
    zh: "\u5bfc\u51fa\u5931\u8d25 \u00b7 \u8de8\u57df SVG",
    en: "Export failed \u00b7 Cross-origin SVG",
  },
  "Export failed: invalid parameters. Check export scale and format, then retry.": {
    zh: "\u5bfc\u51fa\u5931\u8d25\uff1a\u53c2\u6570\u65e0\u6548\u3002\u8bf7\u68c0\u67e5\u5bfc\u51fa\u500d\u7387\u548c\u683c\u5f0f\u540e\u91cd\u8bd5\u3002",
    en: "Export failed: invalid parameters. Check export scale and format, then retry.",
  },
  "Export failed \u00b7 Invalid parameters": {
    zh: "\u5bfc\u51fa\u5931\u8d25 \u00b7 \u53c2\u6570\u9519\u8bef",
    en: "Export failed \u00b7 Invalid parameters",
  },
  "Open the export workbench for preview, layer order, image adjustments, target selection, and final resolution.": {
    zh: "\u6253\u5f00\u5bfc\u51fa\u5de5\u4f5c\u53f0\uff0c\u67e5\u770b\u9884\u89c8\uff0c\u8c03\u6574\u56fe\u5c42\u987a\u5e8f\u3001\u753b\u9762\u53c2\u6570\u3001\u5bfc\u51fa\u76ee\u6807\u548c\u6700\u7ec8\u5206\u8fa8\u7387\u3002",
    en: "Open the export workbench for preview, layer order, image adjustments, target selection, and final resolution.",
  },
  "Open the export workbench to preview the map, reorder layers, tune image adjustments, choose the target format, and export up to the current 8K limit.": {
    zh: "\u6253\u5f00\u5bfc\u51fa\u5de5\u4f5c\u53f0\uff0c\u9884\u89c8\u5730\u56fe\uff0c\u91cd\u6392\u56fe\u5c42\uff0c\u8c03\u6574\u753b\u9762\u53c2\u6570\uff0c\u9009\u62e9\u5bfc\u51fa\u76ee\u6807\uff0c\u5e76\u5728\u5f53\u524d 8K \u4e0a\u9650\u5185\u5bfc\u51fa\u3002",
    en: "Open the export workbench to preview the map, reorder layers, tune image adjustments, choose the target format, and export up to the current 8K limit.",
  },
  "Use Guide for workflow steps and Reference for visual alignment. Both stay in the Project tab so you can check instructions without losing context.": {
    zh: "\u7528 Guide \u67e5\u770b\u64cd\u4f5c\u6d41\u7a0b\uff0c\u7528 Reference \u505a\u89c6\u89c9\u5bf9\u4f4d\u3002\u5b83\u4eec\u90fd\u7559\u5728 Project tab \u91cc\uff0c\u8fd9\u6837\u4f60\u53ef\u4ee5\u5bf9\u7167\u6307\u5f15\u800c\u4e0d\u4f1a\u4e22\u5931\u5f53\u524d\u4e0a\u4e0b\u6587\u3002",
    en: "Use Guide for workflow steps and Reference for visual alignment. Both stay in the Project tab so you can check instructions without losing context.",
  },
  "Review scenario-derived frontlines or open the project-local strategic workspace for operational overlays.": {
    zh: "\u5728\u8fd9\u91cc\u53ef\u4ee5\u67e5\u770b\u573a\u666f\u63a8\u5bfc\u51fa\u7684 frontline\uff0c\u4e5f\u53ef\u4ee5\u6253\u5f00\u9879\u76ee\u672c\u5730\u7684 strategic workspace \u6765\u7ed8\u5236 operational overlays\u3002",
    en: "Review scenario-derived frontlines or open the project-local strategic workspace for operational overlays.",
  },
  "Use Frontline after you apply a scenario. This section combines the derived conflict overlay with the project-local strategic workspace for operational lines, graphics, and unit counters.": {
    zh: "\u5148\u5e94\u7528\u573a\u666f\uff0c\u518d\u4f7f\u7528 Frontline\u3002\u8fd9\u4e2a\u533a\u5757\u540c\u65f6\u7ba1\u7406 derived conflict overlay \u548c project-local strategic workspace\uff0c\u7528\u4e8e operational lines\u3001graphics \u548c unit counters\u3002",
    en: "Use Frontline after you apply a scenario. This section combines the derived conflict overlay with the project-local strategic workspace for operational lines, graphics, and unit counters.",
  },
  "Live in Transport Workbench": {
    zh: "\u5df2\u5728 Transport Workbench \u4e2d\u542f\u7528",
    en: "Live in Transport Workbench",
  },
  "Use the workbench Display and Data tabs to review live rail visibility rules, pack status, and reconciliation notes.": {
    zh: "\u5728 workbench \u7684 Display \u548c Data \u9875\u7b7e\u91cc\u67e5\u770b rail \u7684\u5f53\u524d\u53ef\u89c1\u6027\u89c4\u5219\u3001pack \u72b6\u6001\u548c reconciliation \u8bf4\u660e\u3002",
    en: "Use the workbench Display and Data tabs to review live rail visibility rules, pack status, and reconciliation notes.",
  },
  "Rail label rules live in the workbench Labels tab, where major-station labels and density are tuned.": {
    zh: "Rail \u6807\u7b7e\u89c4\u5219\u5df2\u79fb\u5230 workbench \u7684 Labels \u9875\u7b7e\uff0c\u5728\u90a3\u91cc\u8c03\u6574 major-station \u6807\u7b7e\u548c\u5bc6\u5ea6\u3002",
    en: "Rail label rules live in the workbench Labels tab, where major-station labels and density are tuned.",
  },
  "Rail scope currently centers on the Japan main network and major stations inside the workbench.": {
    zh: "Rail \u7684\u5f53\u524d scope \u4ee5 workbench \u91cc\u7684 Japan \u4e3b\u5e72\u7f51\u7edc\u548c major stations \u4e3a\u4e3b\u3002",
    en: "Rail scope currently centers on the Japan main network and major stations inside the workbench.",
  },
  "Open the Transport workbench to review family context on the left, preview or reorder in the center, and tune or verify rules in the inspector tabs on the right.": {
    zh: "\u6253\u5f00 Transport workbench\uff0c\u5728\u5de6\u4fa7\u67e5\u770b family \u4e0a\u4e0b\u6587\uff0c\u5728\u4e2d\u95f4\u9884\u89c8\u6216\u6392\u5e8f\uff0c\u5728\u53f3\u4fa7 inspector tabs \u91cc\u8c03\u6574\u548c\u6838\u5bf9\u89c4\u5219\u3002",
    en: "Open the Transport workbench to review family context on the left, preview or reorder in the center, and tune or verify rules in the inspector tabs on the right.",
  },
  "Save the current map state as a project file or restore one from disk. Loading a project replaces the current working state, and the app asks before continuing when the saved scenario baseline differs from the current assets.": {
    zh: "\u628a\u5f53\u524d\u5730\u56fe\u72b6\u6001\u4fdd\u5b58\u6210 project file\uff0c\u6216\u4ece\u78c1\u76d8\u6062\u590d\u65e2\u6709\u9879\u76ee\u3002\u52a0\u8f7d\u9879\u76ee\u4f1a\u66ff\u6362\u5f53\u524d working state\uff1b\u5982\u679c\u4fdd\u5b58\u65f6\u7684 scenario baseline \u548c\u5f53\u524d assets \u4e0d\u4e00\u81f4\uff0c\u7cfb\u7edf\u4f1a\u5148\u5f39\u51fa\u786e\u8ba4\u63d0\u793a\u3002",
    en: "Save the current map state as a project file or restore one from disk. Loading a project replaces the current working state, and the app asks before continuing when the saved scenario baseline differs from the current assets.",
  },
  "Paint the map first, then rename each color entry here. Empty names clear the label, and the current legend list is kept inside this working session.": {
    zh: "\u5148\u7ed9\u5730\u56fe\u4e0a\u8272\uff0c\u518d\u5728\u8fd9\u91cc\u91cd\u547d\u540d\u6bcf\u4e2a color entry\u3002\u540d\u79f0\u6e05\u7a7a\u540e\u4f1a\u79fb\u9664\u8be5 label\uff0c\u800c\u5f53\u524d legend list \u4f1a\u4fdd\u6301\u5728\u8fd9\u6b21 working session \u91cc\u3002",
    en: "Paint the map first, then rename each color entry here. Empty names clear the label, and the current legend list is kept inside this working session.",
  },
  "Current lens": { zh: "\u5f53\u524d\u955c\u5934", en: "Current lens" },
  Baseline: { zh: "\u57fa\u7ebf", en: "Baseline" },
  "Compare action": { zh: "\u5bf9\u6bd4\u52a8\u4f5c", en: "Compare action" },
  Availability: { zh: "\u53ef\u7528\u6027", en: "Availability" },
  "Preview controls": { zh: "\u9884\u89c8\u63a7\u5236", en: "Preview controls" },
  "Data path": { zh: "\u6570\u636e\u8def\u5f84", en: "Data path" },
  "Current use": { zh: "\u5f53\u524d\u7528\u9014", en: "Current use" },
  "Board behavior": { zh: "\u6392\u5e8f\u677f\u884c\u4e3a", en: "Board behavior" },
  "Inspector role": { zh: "Inspector \u5206\u5de5", en: "Inspector role" },
  "Future draw stack": { zh: "\u672a\u6765\u7ed8\u5236\u5c42\u53e0", en: "Future draw stack" },
  "Review focus": { zh: "\u5ba1\u6838\u91cd\u70b9", en: "Review focus" },
  "No controls in this tab": { zh: "\u8fd9\u4e2a tab \u6682\u65f6\u6ca1\u6709\u5355\u72ec\u63a7\u4ef6", en: "No controls in this tab" },
  "This family has not exposed extra manifest or audit cards in the current shell.": {
    zh: "\u8fd9\u4e2a family \u76ee\u524d\u8fd8\u6ca1\u6709\u5728\u8fd9\u4e2a shell \u91cc\u66b4\u9732\u989d\u5916\u7684 manifest \u6216 audit \u5361\u7247\u3002",
    en: "This family has not exposed extra manifest or audit cards in the current shell.",
  },
  "Export summary": { zh: "\u5bfc\u51fa\u6458\u8981", en: "Export summary" },
  "Export actions": { zh: "\u5bfc\u51fa\u64cd\u4f5c", en: "Export actions" },
  "Open workbench": { zh: "\u6253\u5f00\u5de5\u4f5c\u53f0", en: "Open workbench" },
  "Bake outputs": { zh: "\u70d8\u7119\u8f93\u51fa", en: "Bake outputs" },
  "Prepare reusable export layers": { zh: "\u9884\u5148\u751f\u6210\u53ef\u590d\u7528\u7684\u5bfc\u51fa\u56fe\u5c42", en: "Prepare reusable export layers" },
  "Bake current pack": { zh: "\u70d8\u7119\u5f53\u524d\u5bfc\u51fa\u5305", en: "Bake current pack" },
  "Clear baked cache": { zh: "\u6e05\u7a7a\u70d8\u7119\u7f13\u5b58", en: "Clear baked cache" },
  "Preview source": { zh: "\u9884\u89c8\u6765\u6e90", en: "Preview source" },
  "Export preview ready": { zh: "\u5bfc\u51fa\u9884\u89c8\u5df2\u5c31\u7eea", en: "Export preview ready" },
  "Rendering export preview\u2026": { zh: "\u6b63\u5728\u6e32\u67d3\u5bfc\u51fa\u9884\u89c8\u2026", en: "Rendering export preview\u2026" },
  "Single layer preview ready": { zh: "\u5355\u5c42\u9884\u89c8\u5df2\u5c31\u7eea", en: "Single layer preview ready" },
  "Main image preview ready": { zh: "\u4e3b\u56fe\u9884\u89c8\u5df2\u5c31\u7eea", en: "Main image preview ready" },
  "Preview unavailable. Export settings remain editable.": { zh: "\u9884\u89c8\u6682\u4e0d\u53ef\u7528\uff0c\u4f46\u4ecd\u53ef\u7ee7\u7eed\u8c03\u6574\u5bfc\u51fa\u8bbe\u7f6e\u3002", en: "Preview unavailable. Export settings remain editable." },
  "Render-pass labels and SVG annotations": { zh: "\u6e32\u67d3 pass \u6807\u7b7e\u4e0e SVG \u6807\u6ce8", en: "Render-pass labels and SVG annotations" },
  "Sort \u00b7 Visibility": { zh: "\u6392\u5e8f \u00b7 \u53ef\u89c1\u6027", en: "Sort \u00b7 Visibility" },
  "Render-pass labels": { zh: "\u6e32\u67d3 pass \u6807\u7b7e", en: "Render-pass labels" },
  "SVG annotations": { zh: "SVG \u6807\u6ce8", en: "SVG annotations" },
  nodes: { zh: "\u8282\u70b9", en: "nodes" },
  "Not baked yet": { zh: "\u5c1a\u672a\u70d8\u7119", en: "Not baked yet" },
  "Ready to export": { zh: "\u53ef\u76f4\u63a5\u5bfc\u51fa", en: "Ready to export" },
  Cached: { zh: "\u5df2\u7f13\u5b58", en: "Cached" },
  "Download Bake Pack": { zh: "\u4e0b\u8f7d\u70d8\u7119\u5305", en: "Download Bake Pack" },
  "Download Layers": { zh: "\u4e0b\u8f7d\u56fe\u5c42", en: "Download Layers" },
  "Layer export finished.": { zh: "\u56fe\u5c42\u5bfc\u51fa\u5b8c\u6210\u3002", en: "Layer export finished." },
  "Layers exported": { zh: "\u56fe\u5c42\u5df2\u5bfc\u51fa", en: "Layers exported" },
  "Bake outputs updated.": { zh: "\u70d8\u7119\u8f93\u51fa\u5df2\u66f4\u65b0\u3002", en: "Bake outputs updated." },
  "Bake ready": { zh: "\u70d8\u7119\u5df2\u5c31\u7eea", en: "Bake ready" },
  "Cleared baked cache.": { zh: "\u5df2\u6e05\u7a7a\u70d8\u7119\u7f13\u5b58\u3002", en: "Cleared baked cache." },
  "Bake cache cleared": { zh: "\u70d8\u7119\u7f13\u5b58\u5df2\u6e05\u7a7a", en: "Bake cache cleared" },
  "Bake pack downloaded as multiple files.": { zh: "\u70d8\u7119\u5305\u5df2\u4ee5\u591a\u4e2a\u6587\u4ef6\u5f62\u5f0f\u4e0b\u8f7d\u3002", en: "Bake pack downloaded as multiple files." },
  "Bake pack exported": { zh: "\u70d8\u7119\u5305\u5df2\u5bfc\u51fa", en: "Bake pack exported" },
  Background: { zh: "\u80cc\u666f", en: "Background" },
  Political: { zh: "\u653f\u6cbb", en: "Political" },
  Context: { zh: "\u4e0a\u4e0b\u6587", en: "Context" },
  Effects: { zh: "\u6548\u679c", en: "Effects" },
  "Base frame": { zh: "\u57fa\u7840\u753b\u9762", en: "Base frame" },
  "Terrain + ownership": { zh: "\u5730\u5f62 + \u5f52\u5c5e", en: "Terrain + ownership" },
  "Scenario overlays": { zh: "\u573a\u666f\u53e0\u52a0", en: "Scenario overlays" },
  "Borders + overlays": { zh: "\u8fb9\u754c + \u53e0\u52a0", en: "Borders + overlays" },
  "City and map labels from the labels pass": { zh: "\u6765\u81ea labels pass \u7684\u57ce\u5e02\u4e0e\u5730\u56fe\u6807\u7b7e", en: "City and map labels from the labels pass" },
  "Frontlines, graphics, counters, and other SVG overlays": { zh: "\u524d\u7ebf\u3001\u56fe\u5f62\u3001\u8ba1\u6570\u5668\u548c\u5176\u4ed6 SVG \u53e0\u52a0", en: "Frontlines, graphics, counters, and other SVG overlays" },
  "Color bake": { zh: "\u989c\u8272\u70d8\u7119", en: "Color bake" },
  "Base color and scenario fills": { zh: "\u57fa\u7840\u989c\u8272\u548c\u573a\u666f\u586b\u5145", en: "Base color and scenario fills" },
  "Line bake": { zh: "\u7ebf\u6761\u70d8\u7119", en: "Line bake" },
  "Borders and line effects": { zh: "\u8fb9\u754c\u4e0e\u7ebf\u6761\u6548\u679c", en: "Borders and line effects" },
  "Text bake": { zh: "\u6587\u5b57\u70d8\u7119", en: "Text bake" },
  "SVG annotations and text overlays": { zh: "SVG \u6807\u6ce8\u4e0e\u6587\u5b57\u53e0\u52a0", en: "SVG annotations and text overlays" },
  "Composite bake": { zh: "\u5408\u6210\u70d8\u7119", en: "Composite bake" },
  "Full packed export layer": { zh: "\u5b8c\u6574\u5c01\u88c5\u5bfc\u51fa\u5c42", en: "Full packed export layer" },
  "Composite image": { zh: "\u4e3b\u56fe\u5408\u6210", en: "Composite image" },
  "Per-layer PNG": { zh: "\u5355\u5c42 PNG", en: "Per-layer PNG" },
  "Bake pack (v1.1)": { zh: "\u70d8\u7119\u5305\uff08v1.1\uff09", en: "Bake pack (v1.1)" },
  "Primary Color": { zh: "\u4e3b\u8272", en: "Primary Color" },
  Tier: { zh: "\u7ea7\u522b", en: "Tier" },
  airport: { zh: "\u673a\u573a", en: "airport" },
  airports: { zh: "\u673a\u573a", en: "airports" },
  port: { zh: "\u6e2f\u53e3", en: "port" },
  ports: { zh: "\u6e2f\u53e3", en: "ports" },
  "More fields": { zh: "\u66f4\u591a\u5b57\u6bb5", en: "More fields" },
  "Less fields": { zh: "\u6536\u8d77\u5b57\u6bb5", en: "Less fields" },
  "Locate and zoom": { zh: "\u5b9a\u4f4d\u5e76\u653e\u5927", en: "Locate and zoom" },
  "Airport type": { zh: "\u673a\u573a\u7c7b\u578b", en: "Airport type" },
  Owner: { zh: "\u6240\u6709\u65b9", en: "Owner" },
  Manager: { zh: "\u7ba1\u7406\u65b9", en: "Manager" },
  Status: { zh: "\u72b6\u6001", en: "Status" },
  Agencies: { zh: "\u673a\u6784", en: "Agencies" },
  "Ferry service": { zh: "\u6e21\u8f6e\u670d\u52a1", en: "Ferry service" },
  "Unnamed facility": { zh: "\u672a\u547d\u540d\u8bbe\u65bd", en: "Unnamed facility" },
  "Owner / Manager": { zh: "\u6240\u6709\u65b9 / \u8fd0\u8425\u65b9", en: "Owner / Manager" },
  "Manager / Agencies": { zh: "\u7ba1\u7406\u65b9 / \u673a\u6784", en: "Manager / Agencies" },
  "Runway": { zh: "\u8dd1\u9053", en: "Runway" },
  "Passengers/day": { zh: "\u65e5\u5747\u65c5\u5ba2", en: "Passengers/day" },
  "Landings/day": { zh: "\u65e5\u5747\u8d77\u964d", en: "Landings/day" },
  "Hours": { zh: "\u8fd0\u8425\u65f6\u95f4", en: "Hours" },
  "Designation": { zh: "\u6307\u5b9a\u7c7b\u522b", en: "Designation" },
  "Class": { zh: "\u7b49\u7ea7", en: "Class" },
  "Ferry": { zh: "\u6e21\u8f6e", en: "Ferry" },
  "Mooring": { zh: "\u6cca\u4f4d", en: "Mooring" },
  "Outer facility": { zh: "\u5916\u90e8\u8bbe\u65bd", en: "Outer facility" },
  "Established": { zh: "\u8bbe\u7acb\u65f6\u95f4", en: "Established" },
  "No facility details available yet.": { zh: "\u6682\u65f6\u6ca1\u6709\u53ef\u7528\u7684 facility \u8be6\u60c5\u3002", en: "No facility details available yet." },
  Yes: { zh: "\u662f", en: "Yes" },
  No: { zh: "\u5426", en: "No" },
  "Compare baseline": { zh: "\u5bf9\u6bd4\u57fa\u7ebf", en: "Compare baseline" },
  "Baseline unavailable": { zh: "\u57fa\u7ebf\u4e0d\u53ef\u7528", en: "Baseline unavailable" },
  "Baseline unavailable for this family": { zh: "\u8fd9\u4e2a family \u6ca1\u6709\u53ef\u7528\u57fa\u7ebf", en: "Baseline unavailable for this family" },
  "Baseline preview": { zh: "\u57fa\u7ebf\u9884\u89c8\u4e2d", en: "Baseline preview" },
  "Live working state": { zh: "\u5f53\u524d\u5de5\u4f5c\u72b6\u6001", en: "Live working state" },
  Labels: { zh: "\u6807\u7b7e", en: "Labels" },
  "Visual Preset": { zh: "\u89c6\u89c9\u9884\u8bbe", en: "Visual Preset" },
  "Political Clean": { zh: "\u653f\u6cbb\u4f18\u5148", en: "Political Clean" },
  Balanced: { zh: "\u5747\u8861", en: "Balanced" },
  "Terrain Rich": { zh: "\u5730\u8c8c\u4f18\u5148", en: "Terrain Rich" },
  "Balanced keeps terrain visible while staying cleaner over political fills.": {
    zh: "\u5747\u8861\u6a21\u5f0f\u4f1a\u4fdd\u7559\u5730\u8c8c\u5b58\u5728\u611f\uff0c\u540c\u65f6\u5c3d\u91cf\u907f\u514d\u628a\u653f\u6cbb\u5e95\u8272\u5f04\u810f\u3002",
    en: "Balanced keeps terrain visible while staying cleaner over political fills.",
  },
  "Political Clean keeps only the clearest landform cues over political fills.": {
    zh: "\u653f\u6cbb\u4f18\u5148\u6a21\u5f0f\u53ea\u4fdd\u7559\u6700\u6e05\u6670\u7684\u5730\u8c8c\u7ed3\u6784\u63d0\u793a\uff0c\u5c3d\u91cf\u4e0d\u5e72\u6270\u56fd\u5bb6\u5e95\u8272\u3002",
    en: "Political Clean keeps only the clearest landform cues over political fills.",
  },
  "Terrain Rich pushes the atlas and contour layer for the strongest relief read.": {
    zh: "\u5730\u8c8c\u4f18\u5148\u6a21\u5f0f\u4f1a\u5f3a\u5316\u56fe\u96c6\u548c\u7b49\u9ad8\u7ebf\uff0c\u8ba9\u5730\u5f62\u8d77\u4f0f\u6700\u660e\u663e\u3002",
    en: "Terrain Rich pushes the atlas and contour layer for the strongest relief read.",
  },
  "Scenario runtime overlays were degraded. Editing remains available.": {
    zh: "\u573a\u666f\u8fd0\u884c\u65f6 overlay \u5df2\u964d\u7ea7\uff0c\u4f46\u4ecd\u53ef\u4ee5\u7ee7\u7eed\u67e5\u770b\u548c\u7f16\u8f91\u3002",
    en: "Scenario runtime overlays were degraded. Editing remains available.",
  },
  "Scenario overlays degraded": {
    zh: "\u573a\u666f overlay \u5df2\u964d\u7ea7",
    en: "Scenario overlays degraded",
  },
  "Overlay fallback active; editing remains available.": {
    zh: "Overlay \u964d\u7ea7\u56de\u9000\u5df2\u542f\u7528\uff0c\u4f46\u4ecd\u53ef\u4ee5\u7ee7\u7eed\u7f16\u8f91\u3002",
    en: "Overlay fallback active; editing remains available.",
  },
  "High Relief Mountains": { zh: "\u9ad8\u8d77\u4f0f\u5c71\u5730", en: "High Relief Mountains" },
  "Mountain Hills": { zh: "\u5c71\u9e93\u4e18\u9675", en: "Mountain Hills" },
  "Upland Plateaus": { zh: "\u9ad8\u5730\u9ad8\u539f", en: "Upland Plateaus" },
  "Badlands & Canyon": { zh: "\u6076\u5730\u4e0e\u5ce1\u8c37", en: "Badlands & Canyon" },
  "Plains Lowlands": { zh: "\u5e73\u539f\u4f4e\u5730", en: "Plains Lowlands" },
  "Basins & Valleys": { zh: "\u76c6\u5730\u4e0e\u6cb3\u8c37", en: "Basins & Valleys" },
  "Temperate Forest": { zh: "\u6e29\u5e26\u68ee\u6797", en: "Temperate Forest" },
  "Tropical Rainforest": { zh: "\u70ed\u5e26\u96e8\u6797", en: "Tropical Rainforest" },
  "Grassland & Steppe": { zh: "\u8349\u539f\u4e0e\u8349\u539f\u5e26", en: "Grassland & Steppe" },
  "Desert & Bare": { zh: "\u8352\u6f20\u4e0e\u88f8\u5730", en: "Desert & Bare" },
  "Tundra & Ice": { zh: "\u82d4\u539f\u4e0e\u51b0\u96ea", en: "Tundra & Ice" },
  "Adaptive Tint": { zh: "\u81ea\u9002\u5e94\u8272\u5f69\u503e\u5411", en: "Adaptive Tint" },
  "Tint Color": { zh: "\u503e\u5411\u989c\u8272", en: "Tint Color" },
  "Tint Strength": { zh: "\u503e\u5411\u5f3a\u5ea6", en: "Tint Strength" },
});
import { normalizeCountryCodeAlias } from "../core/country_code_aliases.js";
import { getScenarioCountryDisplayName } from "../core/scenario_country_display.js";

const US_LEGACY_ZONE_LABEL_RE = /(?:\bZone\s+\d+\b|第?\s*\d+\s*[区號号])/i;
const STARTUP_SUPPORT_AUDIT_PARAM = "startup_support_audit";
let startupSupportKeyUsageAuditEnabled = null;
let startupSupportKeyUsageAuditState = null;

function shouldCaptureStartupSupportKeyUsage() {
  if (startupSupportKeyUsageAuditEnabled !== null) {
    return startupSupportKeyUsageAuditEnabled;
  }
  try {
    const params = new URLSearchParams(globalThis.location?.search || "");
    const raw = String(params.get(STARTUP_SUPPORT_AUDIT_PARAM) || "").trim().toLowerCase();
    startupSupportKeyUsageAuditEnabled = ["1", "true", "yes", "on"].includes(raw);
  } catch (_error) {
    startupSupportKeyUsageAuditEnabled = false;
  }
  return startupSupportKeyUsageAuditEnabled;
}

function getStartupSupportKeyUsageAuditState() {
  if (!shouldCaptureStartupSupportKeyUsage()) {
    return null;
  }
  if (!startupSupportKeyUsageAuditState) {
    startupSupportKeyUsageAuditState = {
      queryKeys: new Set(),
      directLocaleKeys: new Set(),
      aliasKeys: new Set(),
      aliasTargetKeys: new Set(),
      missKeys: new Set(),
    };
  }
  return startupSupportKeyUsageAuditState;
}

function recordStartupSupportKeyUsage({
  queryKey = "",
  directLocaleKey = "",
  aliasKey = "",
  aliasTargetKey = "",
  miss = false,
} = {}) {
  const auditState = getStartupSupportKeyUsageAuditState();
  if (!auditState) return;
  const normalizedQueryKey = String(queryKey || "").trim();
  if (normalizedQueryKey) {
    auditState.queryKeys.add(normalizedQueryKey);
  }
  const normalizedDirectLocaleKey = String(directLocaleKey || "").trim();
  if (normalizedDirectLocaleKey) {
    auditState.directLocaleKeys.add(normalizedDirectLocaleKey);
  }
  const normalizedAliasKey = String(aliasKey || "").trim();
  if (normalizedAliasKey) {
    auditState.aliasKeys.add(normalizedAliasKey);
  }
  const normalizedAliasTargetKey = String(aliasTargetKey || "").trim();
  if (normalizedAliasTargetKey) {
    auditState.aliasTargetKeys.add(normalizedAliasTargetKey);
  }
  if (miss && normalizedQueryKey) {
    auditState.missKeys.add(normalizedQueryKey);
  }
}

function resolveGeoLocaleEntry(key) {
  const candidate = String(key || "").trim();
  const geoLocales = state.locales?.geo || {};
  if (geoLocales[candidate]) {
    recordStartupSupportKeyUsage({
      queryKey: candidate,
      directLocaleKey: candidate,
    });
    return geoLocales[candidate];
  }

  const stableKey = state.geoAliasToStableKey?.[candidate];
  if (stableKey && geoLocales[stableKey]) {
    recordStartupSupportKeyUsage({
      queryKey: candidate,
      aliasKey: candidate,
      aliasTargetKey: stableKey,
    });
    return geoLocales[stableKey];
  }
  recordStartupSupportKeyUsage({
    queryKey: candidate,
    miss: true,
  });
  return null;
}

function resolveGeoLocaleText(
  key,
  {
    allowCrossLanguageFallback = true,
    includeCandidateFallback = true,
  } = {}
) {
  const candidate = String(key || "").trim();
  if (!candidate) return "";
  const entry = resolveGeoLocaleEntry(candidate);
  if (!entry || typeof entry !== "object") return "";
  const preferred = state.currentLanguage === "zh" ? entry.zh : entry.en;
  const secondary = state.currentLanguage === "zh" ? entry.en : entry.zh;
  return String(
    preferred
      || (allowCrossLanguageFallback ? secondary : "")
      || (includeCandidateFallback ? candidate : "")
  ).trim();
}

function getPreferredGeoLabel(candidates = [], fallback = "", options = {}) {
  const items = Array.isArray(candidates) ? candidates : [candidates];
  for (const rawCandidate of items) {
    const candidate = String(rawCandidate || "").trim();
    if (!candidate) continue;
    const localized = resolveGeoLocaleText(candidate, options);
    if (localized) return localized;
  }
  return String(fallback || "").trim();
}

function getStrictGeoLabel(candidates = [], fallback = "") {
  return getPreferredGeoLabel(candidates, fallback, {
    allowCrossLanguageFallback: false,
    includeCandidateFallback: false,
  });
}

function hasExplicitScenarioGeoLocaleEntry(key) {
  const candidate = String(key || "").trim();
  if (!candidate) return false;
  const scenarioGeo = state.scenarioGeoLocalePatchData?.geo;
  return !!(
    scenarioGeo
    && typeof scenarioGeo === "object"
    && Object.prototype.hasOwnProperty.call(scenarioGeo, candidate)
  );
}

function getSafeRawFeatureLabel(candidates = []) {
  const items = Array.isArray(candidates) ? candidates : [candidates];
  for (const rawCandidate of items) {
    const candidate = String(rawCandidate || "").trim();
    if (!candidate) continue;
    const entry = resolveGeoLocaleEntry(candidate);
    if (!entry || typeof entry !== "object") continue;
    const entryEn = String(entry.en || "").trim();
    const entryZh = String(entry.zh || "").trim();
    const isSafeDirectMatch = (entryEn && entryEn === candidate) || (!entryEn && entryZh === candidate);
    if (!isSafeDirectMatch) continue;
    const localized = resolveGeoLocaleText(candidate, {
      allowCrossLanguageFallback: true,
      includeCandidateFallback: false,
    });
    if (localized) return localized;
  }
  return "";
}

function isUsFeature(feature) {
  const props = feature?.properties || {};
  const featureId = String(props.id || feature?.id || "").trim();
  const countryCode = String(props.cntr_code || "").trim().toUpperCase();
  return countryCode === "US" || featureId.startsWith("US_");
}

function isUsLegacyZoneLabel(text) {
  return US_LEGACY_ZONE_LABEL_RE.test(String(text || "").trim());
}

function getGeoFeatureDisplayLabel(feature, fallback = "") {
  const props = feature?.properties || {};
  const rawNameCandidates = [
    props.label,
    props.name,
    props.name_en,
    props.NAME,
  ];
  const canonicalRawName = String(
    rawNameCandidates.find((value) => String(value || "").trim()) || ""
  ).trim();
  const preferredIdCandidates = [];
  [
    props.__city_host_feature_id,
    props.__city_stable_key,
    props.stable_key,
    props.__city_id,
  ].forEach((rawCandidate) => {
    const candidate = String(rawCandidate || "").trim();
    if (!candidate || preferredIdCandidates.includes(candidate)) return;
    preferredIdCandidates.push(candidate);
  });
  [
    props.id,
    feature?.id,
  ].forEach((rawCandidate) => {
    const candidate = String(rawCandidate || "").trim();
    if (!candidate || preferredIdCandidates.includes(candidate)) return;
    if (hasExplicitScenarioGeoLocaleEntry(candidate)) {
      preferredIdCandidates.push(candidate);
    }
  });
  const explicitLabel = getPreferredGeoLabel(preferredIdCandidates, "", {
    allowCrossLanguageFallback: true,
    includeCandidateFallback: false,
  });
  const shouldBypassUsLegacyZoneLabel = (
    explicitLabel
    && isUsFeature(feature)
    && canonicalRawName
    && !isUsLegacyZoneLabel(canonicalRawName)
    && isUsLegacyZoneLabel(explicitLabel)
  );
  if (explicitLabel && !shouldBypassUsLegacyZoneLabel) {
    return explicitLabel;
  }

  const safeRawLabel = getSafeRawFeatureLabel(rawNameCandidates);
  if (safeRawLabel) {
    return safeRawLabel;
  }

  return String(
    rawNameCandidates.find((value) => String(value || "").trim())
    || props.id
    || feature?.id
    || fallback
  ).trim();
}

function t(key, type = "geo") {
  if (!key) return "";
  const entry = type === "geo" ? resolveGeoLocaleEntry(key) : state.locales?.[type]?.[key];
  const lang = state.currentLanguage === "zh" ? "zh" : "en";
  if (entry?.[lang] || entry?.en) {
    return entry?.[lang] || entry?.en || key;
  }
  if (type !== "geo") {
    const inlineEntry = INLINE_UI_TRANSLATIONS[key];
    if (inlineEntry?.[lang] || inlineEntry?.en) {
      return inlineEntry?.[lang] || inlineEntry?.en || key;
    }
  }
  return key;
}

function applyDeclarativeTranslationToElement(element) {
  if (!element?.getAttribute) return;

  const applyTextValue = (localizedText) => {
    const semanticChild = typeof element.querySelector === "function"
      ? element.querySelector(":scope > .sidebar-anchor-title, :scope > .sidebar-section-title, :scope > .sidebar-support-title, :scope > .sidebar-appendix-title, :scope > .sidebar-tool-title")
      : null;
    if (semanticChild instanceof HTMLElement) {
      semanticChild.textContent = localizedText;
      return;
    }
    element.textContent = localizedText;
  };

  const textKey = String(element.getAttribute("data-i18n") || "").trim();
  if (textKey) {
    applyTextValue(t(textKey, "ui"));
  }

  const placeholderKey = String(element.getAttribute("data-i18n-placeholder") || "").trim();
  if (placeholderKey) {
    element.setAttribute("placeholder", t(placeholderKey, "ui"));
  }

  const titleKey = String(element.getAttribute("data-i18n-title") || "").trim();
  if (titleKey) {
    element.setAttribute("title", t(titleKey, "ui"));
  }

  const ariaLabelKey = String(element.getAttribute("data-i18n-aria-label") || "").trim();
  if (ariaLabelKey) {
    element.setAttribute("aria-label", t(ariaLabelKey, "ui"));
  }
}

function applyDeclarativeTranslations(root = document) {
  if (!root) return;
  const selector = "[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label]";
  const elements = [];
  if (root.nodeType === 1 && root.matches?.(selector)) {
    elements.push(root);
  }
  if (typeof root.querySelectorAll === "function") {
    elements.push(...root.querySelectorAll(selector));
  }
  elements.forEach((element) => {
    applyDeclarativeTranslationToElement(element);
  });
}

function updateUIText() {
  applyDeclarativeTranslations(document);

  const uiMap = [
    ["lblCurrentTool", "Tools"],
    ["lblHistory", "History"],
    ["lblZoom", "Zoom"],
    ["lblSpecialZoneEditor", "Special Zone Editor"],
    ["lblQuickPalette", "Quick Colors"],
    ["lblColorLibrary", "Color Library"],
    ["lblColorLibraryHint", "Browse the full palette library for manual work and palette reference."],
    ["lblPaletteSearch", "Search Colors"],
    ["lblScenario", "Scenario"],
    ["lblAppHint", "Click countries to paint. Use the dock below the map for quick tools and the left panel for deeper controls."],
    ["lblScenarioHint", "Load a bundled historical setup and reset to its baseline."],
    ["lblScenarioSelect", "Scenario"],
    ["optScenarioNone", "None"],
    ["optScenarioOwnership", "Ownership"],
    ["optScenarioFrontline", "Frontline"],
    ["applyScenarioBtn", "Apply"],
    ["resetScenarioBtn", "Reset Changes To Baseline"],
    ["clearScenarioBtn", "Exit Scenario"],
    ["scenarioStatus", "No scenario active"],
    ["scenarioAuditHint", "Coverage report unavailable"],
    ["lblExport", "Export Map"],
    ["lblExportTarget", "Target:"],
    ["optExportTargetComposite", "Composite image"],
    ["optExportTargetPerLayerPng", "Per-layer PNG"],
    ["optExportTargetBakePack", "Bake pack (v1.1)"],
    ["lblExportFormat", "Format"],
    ["lblExportScale", "Export Resolution"],
    ["lblExportWorkbenchMainLayers", "Main Layers"],
    ["exportWorkbenchHint", "Drag to reorder exported layer groups. Visibility only applies to this export session."],
    ["optExportScale1x", "Current preview (1×)"],
    ["optExportScale1_5x", "High (1.5×)"],
    ["optExportScale2x", "Ultra (2×)"],
    ["optExportScale4x", "Maximum detail (4×)"],
    ["exportResolutionHint", "Preview rendering and final export resolution are independent. Final export is capped at 8K (7680 × 4320)."],
    ["exportBtn", "Download Snapshot"],
    ["lblEditingRules", "Editing Rules"],
    ["lblTexture", "Texture"],
    ["lblOverlay", "Overlay"],
    ["optTextureNone", "Clean"],
    ["optTexturePaper", "Old Paper"],
    ["optTextureDraftGrid", "Draft Grid"],
    ["optTextureGraticule", "Graticule"],
    ["lblTextureOpacity", "Opacity"],
    ["lblTexturePaperScale", "Paper Scale"],
    ["lblTexturePaperWarmth", "Warmth"],
    ["lblTexturePaperGrain", "Grain"],
    ["lblTexturePaperWear", "Wear"],
    ["lblTextureGraticuleMajorStep", "Major Step"],
    ["lblTextureGraticuleMinorStep", "Minor Step"],
    ["lblTextureGraticuleLabelStep", "Label Step"],
    ["lblTextureGraticuleColor", "Line Color"],
    ["lblTextureGraticuleLabelColor", "Label Color"],
    ["lblTextureGraticuleLabelSize", "Label Size"],
    ["lblTextureGraticuleMajorWidth", "Major Width"],
    ["lblTextureGraticuleMinorWidth", "Minor Width"],
    ["lblTextureGraticuleMajorOpacity", "Major Opacity"],
    ["lblTextureGraticuleMinorOpacity", "Minor Opacity"],
    ["lblTextureDraftMajorStep", "Major Step"],
    ["lblTextureDraftMinorStep", "Minor Step"],
    ["lblTextureDraftLonOffset", "Longitude Offset"],
    ["lblTextureDraftLatOffset", "Latitude Tilt"],
    ["lblTextureDraftRoll", "Roll"],
    ["lblTextureDraftColor", "Line Color"],
    ["lblTextureDraftWidth", "Line Width"],
    ["lblTextureDraftMajorOpacity", "Major Opacity"],
    ["lblTextureDraftMinorOpacity", "Minor Opacity"],
    ["lblTextureDraftDash", "Dash Style"],
    ["optTextureDraftDashDashed", "Dashed"],
    ["optTextureDraftDashDotted", "Dotted"],
    ["optTextureDraftDashSolid", "Solid"],
    ["lblMapStyle", "Auto-Fill"],
    ["dockHandleLabel", "Collapse"],
    ["labelMapStyle", "Appearance"],
    ["appearanceTabOcean", "Ocean"],
    ["appearanceTabBorders", "Borders"],
    ["lblBordersPanel", "Borders"],
    ["lblInternalBorders", "Internal Borders"],
    ["lblEmpireBorders", "Empire Borders"],
    ["lblCoastlines", "Coastlines"],
    ["appearanceTabLayers", "Context Layers"],
    ["appearanceTabDayNight", "Day / Night"],
    ["appearanceTabTexture", "Texture"],
    ["appearanceSpecialZoneBtn", "Special Zone Tool"],
    ["lblColorMode", "Color Mode"],
    ["optColorModeRegion", "By Region"],
    ["optColorModePolitical", "By Neighbor (Political)"],
    ["lblPaintGranularity", "Paint Granularity"],
    ["dockQuickFillLabel", "Double-Click Quick Fill"],
    ["lblReferenceImage", "Reference Image"],
    ["optPaintSubdivision", "By Subdivision"],
    ["optPaintCountry", "By Country"],
    ["lblPaintMeaning", "Paint Meaning"],
    ["labelActiveSovereign", "Active Owner"],
    ["optPaintMeaningVisual", "Visual Color"],
    ["optPaintMeaningSovereignty", "Political Ownership"],
    ["activeSovereignLabel", "None selected"],
    ["recalculateBordersBtn", "Recalculate Borders"],
    ["dynamicBorderStatus", "Borders up to date"],
    ["lblOcean", "Ocean"],
    ["lblOceanFillColor", "Fill Color"],
    ["lblOceanCoastalAccent", "Coastal Accent"],
    ["oceanCoastalAccentHint", "Available only in the TNO 1962 scenario."],
    ["lblOceanAdvancedStylesToggle", "Experimental Bathymetry"],
    ["oceanAdvancedStylesHint", "Enable data-driven bathymetry presets for testing. May reduce pan and zoom performance."],
    ["lblOceanStyle", "Style"],
    ["optOceanFlat", "Flat Blue"],
    ["optOceanBathymetrySoft", "Bathymetry Soft"],
    ["optOceanBathymetryContours", "Bathymetry Contours"],
    ["oceanStylePresetHint", "Flat Blue keeps the ocean fill clean with no bathymetry overlay."],
    ["lblOceanOpacity", "Opacity"],
    ["lblOceanScale", "Scale"],
    ["lblOceanContourStrength", "Contour Strength"],
    ["lblOceanBathymetryDebug", "Bathymetry Debug"],
    ["oceanBathymetryDebugHint", "Advanced high-zoom tuning for nearshore fill and scenario contour exit thresholds."],
    ["lblOceanBathymetrySource", "Data Source"],
    ["lblOceanBathymetryBands", "Bands"],
    ["lblOceanBathymetryContours", "Contours"],
    ["lblOceanShallowFadeEndZoom", "Nearshore Fill Exit"],
    ["lblOceanMidFadeEndZoom", "Mid-depth Fill Exit"],
    ["lblOceanDeepFadeEndZoom", "Deep Fill Exit"],
    ["lblOceanScenarioSyntheticContourFadeEndZoom", "Synthetic Contour Exit"],
    ["lblOceanScenarioShallowContourFadeEndZoom", "Shallow Scenario Contour Exit"],
    ["labelAutoFillStyle", "Auto-Fill Style"],
    ["lblParentBorders", "Parent Unit Borders"],
    ["lblParentBorderColor", "Color"],
    ["lblParentBorderOpacity", "Opacity"],
    ["lblParentBorderWidth", "Width"],
    ["lblParentBorderCountries", "Show Parent Borders By Country"],
    ["parentBorderEnableAll", "Enable All"],
    ["parentBorderDisableAll", "Clear All"],
    ["parentBorderEmpty", "No supported countries in current dataset."],
    ["lblContextLayers", "Context Layers"],
    ["lblPhysicalPanel", "Physical Regions"],
    ["lblPhysicalLayer", "Physical Regions"],
    ["lblPhysicalPreset", "Visual Preset"],
    ["optPhysicalPresetPoliticalClean", "Political Clean"],
    ["optPhysicalPresetBalanced", "Balanced"],
    ["optPhysicalPresetTerrainRich", "Terrain Rich"],
    ["physicalPresetHint", "Balanced keeps terrain visible while staying cleaner over political fills."],
    ["lblPhysicalMode", "Mode"],
    ["optPhysicalModeAtlasContours", "Atlas + Contours"],
    ["optPhysicalModeAtlasOnly", "Atlas Only"],
    ["optPhysicalModeContoursOnly", "Contours Only"],
    ["lblPhysicalOpacity", "Opacity"],
    ["lblTerrainAtlasPanel", "Terrain Atlas"],
    ["lblPhysicalAtlasIntensity", "Atlas Intensity"],
    ["lblPhysicalRainforestEmphasis", "Rainforest Emphasis"],
    ["lblPhysicalClassMountain", "High Relief Mountains"],
    ["lblPhysicalClassMountainHills", "Mountain Hills"],
    ["lblPhysicalClassPlateau", "Upland Plateaus"],
    ["lblPhysicalClassBadlands", "Badlands & Canyon"],
    ["lblPhysicalClassPlains", "Plains Lowlands"],
    ["lblPhysicalClassBasin", "Basins & Valleys"],
    ["lblPhysicalClassWetlands", "Wetlands & Delta"],
    ["lblPhysicalClassForestTemperate", "Temperate Forest"],
    ["lblPhysicalClassRainforestTropical", "Tropical Rainforest"],
    ["lblPhysicalClassGrassland", "Grassland & Steppe"],
    ["lblPhysicalClassDesert", "Desert & Bare"],
    ["lblPhysicalClassTundra", "Tundra & Ice"],
    ["lblTerrainContoursPanel", "Terrain Contours"],
    ["lblPhysicalMinorContours", "Show Minor Contours"],
    ["lblPhysicalContourColor", "Contour Color"],
    ["lblPhysicalContourOpacity", "Contour Opacity"],
    ["lblPhysicalContourMajorWidth", "Major Width"],
    ["lblPhysicalContourMinorWidth", "Minor Width"],
    ["lblPhysicalContourMajorInterval", "Major Interval (m)"],
    ["lblPhysicalContourMinorInterval", "Minor Interval (m)"],
    ["lblPhysicalContourLowReliefCutoff", "Low-Relief Cutoff (m)"],
    ["lblPhysicalBlendMode", "Blend Mode"],
    ["optPhysicalBlendMultiply", "Multiply"],
    ["optPhysicalBlendSoftLight", "Soft Light"],
    ["optPhysicalBlendOverlay", "Overlay"],
    ["optPhysicalBlendNormal", "Normal"],
    ["lblUrbanPanel", "Urban Areas"],
    ["lblUrbanLayer", "Urban Areas"],
    ["lblUrbanColor", "Color"],
    ["lblUrbanOpacity", "Opacity"],
    ["lblUrbanBlendMode", "Blend Mode"],
    ["optUrbanBlendMultiply", "Multiply"],
    ["optUrbanBlendNormal", "Normal"],
    ["optUrbanBlendOverlay", "Overlay"],
    ["lblUrbanMinArea", "Min Area (px)"],
    ["lblCityPointsPanel", "City Points"],
    ["lblCityPointsLayer", "City Points"],
    ["lblCityPointsPresetDensityGroup", "Preset & Density"],
    ["cityPointsPresetDensityGroupHint", "Choose a restrained map treatment first, then tune how many point markers and labels are allowed to surface."],
    ["lblCityPointsStylePreset", "Style Preset"],
    ["optCityPointsThemeClassicGraphite", "Classic Graphite"],
    ["optCityPointsThemeAtlasInk", "Atlas Ink"],
    ["optCityPointsThemeParchmentSepia", "Parchment Sepia"],
    ["optCityPointsThemeSlateBlue", "Slate Blue"],
    ["optCityPointsThemeIvoryOutline", "Ivory Outline"],
    ["lblCityPointsMarkerScale", "Marker Scale"],
    ["lblCityPointsMarkerDensity", "Point Density"],
    ["lblCityPointsLabelDensity", "Label Density"],
    ["cityPointsMarkerDensityHint", "Controls how many city markers can appear per viewport at mid/high zoom."],
    ["cityPointsLabelDensityHint", "Controls label count only. It does not change point density."],
    ["optCityLabelDensitySparse", "Sparse"],
    ["optCityLabelDensityBalanced", "Balanced"],
    ["optCityLabelDensityDense", "Dense"],
    ["lblCityPointsVisibilityGroup", "Visibility"],
    ["cityPointsVisibilityGroupHint", "Keep the main visibility controls together so opacity, labels, and capital emphasis read as one layer."],
    ["lblCityPointsAdvanced", "Advanced"],
    ["cityPointsAdvancedHint", "Fine-tune colors and label size once the preset and density feel close."],
    ["lblCityPointsColor", "Point Color"],
    ["lblCityPointsCapitalColor", "Capital Highlight Color"],
    ["lblCityPointsOpacity", "Point Opacity"],
    ["lblCityPointLabelsEnabled", "Show City Labels"],
    ["lblCityPointsLabelSize", "Label Size"],
    ["lblCityCapitalOverlayEnabled", "Highlight Capitals"],
    ["lblDayNightPanel", "Day / Night"],
    ["lblDayNightEnabled", "Enable Day / Night Cycle"],
    ["dayNightModeManualBtn", "Manual"],
    ["dayNightModeUtcBtn", "UTC Sync"],
    ["lblDayNightTime", "UTC Time"],
    ["dayNightModeHint", "Live UTC sync updates once per minute."],
    ["lblDayNightCityLights", "City Lights"],
    ["lblDayNightCityLightsStyle", "Style"],
    ["optDayNightCityLightsModern", "Modern"],
    ["optDayNightCityLightsHistorical1930s", "1930s Electrification Proxy"],
    ["lblDayNightCityLightsIntensity", "Intensity"],
    ["lblDayNightAdvanced", "Advanced"],
    ["lblDayNightTextureOpacity", "Texture Opacity (Modern only)"],
    ["lblDayNightCorridorStrength", "Corridor Strength (Modern only)"],
    ["lblDayNightCoreSharpness", "Core Sharpness (Modern only)"],
    ["lblDayNightHistoricalOnly", "Historical only"],
    ["lblDayNightHistoricalCityLightsDensity", "Historical Light Density"],
    ["lblDayNightHistoricalCityLightsSecondaryRetention", "Secondary City Retention"],
    ["lblDayNightShadowOpacity", "Shadow Opacity"],
    ["lblDayNightTwilightWidth", "Twilight Width"],
    ["lblRiversLayer", "Rivers"],
    ["lblRiversColor", "Color"],
    ["lblRiversOpacity", "Opacity"],
    ["lblRiversWidth", "Width"],
    ["lblRiversOutlineColor", "Outline Color"],
    ["lblRiversOutlineWidth", "Outline Width"],
    ["lblRiversDashStyle", "Dash"],
    ["lblRiversPanel", "Rivers"],
    ["optRiversDashSolid", "Solid"],
    ["optRiversDashDashed", "Dashed"],
    ["optRiversDashDotted", "Dotted"],
    ["lblWaterRegions", "Water Regions"],
    ["lblWaterRegionsPanel", "Water Regions"],
    ["lblOpenOceanRegions", "Allow Open-Ocean Interaction"],
    ["labelPresetPolitical", "Auto-Fill Countries"],
    ["presetClear", "Clear Map"],
    ["zoomResetBtn", "Fit"],
    ["lblCountrySearch", "Search Countries"],
    ["lblWaterSearch", "Search Water Regions"],
    ["lblSpecialRegionSearch", "Search Special Regions"],
    ["lblPresetsHierarchy", "Territories & Presets"],
    ["lblCountryInspector", "Country Inspector"],
    ["lblWaterInspector", "Water Regions"],
    ["lblWaterInteraction", "Interaction"],
    ["lblWaterInspectorOpenOceanToggle", "Allow Open-Ocean Interaction"],
    ["lblWaterInspectorOpenOceanSelectToggle", "Allow Open-Ocean Selection"],
    ["waterInspectorOpenOceanSelectHint", "When off, macro ocean regions stay hidden from inspector selection and map picking."],
    ["waterInspectorOpenOceanSelectHintEnabled", "Macro ocean regions are currently available in the inspector and map picking."],
    ["lblWaterInspectorOpenOceanPaintToggle", "Allow Open-Ocean Paint"],
    ["waterInspectorOpenOceanPaintHint", "When off, macro ocean regions can be inspected but ignore paint, eraser, and eyedropper actions."],
    ["waterInspectorOpenOceanPaintHintEnabled", "Macro ocean regions currently accept paint, eraser, and eyedropper actions."],
    ["lblWaterFilters", "Filters"],
    ["lblWaterInspectorOverridesOnlyToggle", "Overrides Only"],
    ["lblWaterFilterType", "Type"],
    ["lblWaterFilterGroup", "Group"],
    ["lblWaterFilterSource", "Source"],
    ["lblWaterSort", "Sort"],
    ["lblWaterInspectorMeta", "Region Details"],
    ["lblWaterInspectorHierarchy", "Family"],
    ["lblWaterInspectorBatch", "Batch Actions"],
    ["lblWaterInspectorScope", "Apply Scope"],
    ["lblSpecialRegionInspector", "Special Regions"],
    ["lblScenarioSpecialRegionVisibility", "Visibility"],
    ["lblScenarioSpecialRegionVisibilityToggle", "Show Scenario Special Regions"],
    ["scenarioSpecialRegionVisibilityHint", "When off, scenario special regions are hidden and ignore hover, click, and paint."],
    ["scenarioSpecialRegionVisibilityHintEnabled", "Scenario special regions are currently visible and interactive."],
    ["lblScenarioReliefOverlayVisibilityToggle", "Show Scenario Relief Overlays"],
    ["scenarioReliefOverlayVisibilityHint", "When off, shoreline, basin contour, and texture overlays are hidden for the active scenario."],
    ["scenarioReliefOverlayVisibilityHintEnabled", "Scenario relief overlays are currently visible. Cached relief stays visible during pan and zoom, then redraws exactly after the view settles."],
    ["lblProjectLegend", "Project & Legend"],
    ["lblDiagnostics", "Diagnostics"],
    ["lblCountryColors", "Country Colors"],
    ["lblWaterLegend", "Water Overrides"],
    ["lblSpecialRegionLegend", "Special Region Overrides"],
    ["countryInspectorOrderingHint", "Key scenario countries first. Releasables appear under parent countries."],
    ["countryInspectorEmptyTitle", "Select a country to inspect"],
    ["countryInspectorEmptyHint", "Choose a country above, then use Active Owner and the Territories & Presets panel."],
    ["waterInspectorEmptyTitle", "Select a water region to inspect"],
    ["waterInspectorEmptyHint", "Click a sea, lake, or strait on the map, or choose one from the list."],
    ["waterInspectorResultCount", "regions"],
    ["specialRegionInspectorEmptyTitle", "Select a special region to inspect"],
    ["specialRegionInspectorEmptyHint", "Click a drained basin or exposure zone on the map, or choose one from the list."],
    ["resetCountryColors", "Reset Country Colors"],
    ["clearWaterRegionColorBtn", "Clear Water Override"],
    ["applyWaterFamilyOverrideBtn", "Apply Current Color To Scope"],
    ["clearWaterFamilyOverrideBtn", "Clear Scope Overrides"],
    ["waterInspectorJumpToParentBtn", "Jump To Parent"],
    ["clearSpecialRegionColorBtn", "Clear Special Region Override"],
    ["lblHistoricalPresets", "Selected Country Actions"],
    ["selectedCountryActionHint", "Choose a country above to inspect territories, presets, and releasables."],
    ["lblSpecialZones", "Special Zones"],
    ["lblSpecialZonesDisputedFill", "Disputed Fill"],
    ["lblSpecialZonesDisputedStroke", "Disputed Stroke"],
    ["lblSpecialZonesWastelandFill", "Wasteland Fill"],
    ["lblSpecialZonesWastelandStroke", "Wasteland Stroke"],
    ["lblSpecialZonesCustomFill", "Custom Fill"],
    ["lblSpecialZonesCustomStroke", "Custom Stroke"],
    ["lblSpecialZonesOpacity", "Opacity"],
    ["lblSpecialZonesStrokeWidth", "Stroke Width"],
    ["lblSpecialZonesDashStyle", "Dash"],
    ["lblSpecialZonesStylePanel", "Special Zones Style"],
    ["optSpecialZonesDashSolid", "Solid"],
    ["optSpecialZonesDashDashed", "Dashed"],
    ["optSpecialZonesDashDotted", "Dotted"],
    ["lblSpecialZoneEditor", "Special Zone Editor"],
    ["lblSpecialZoneType", "Type"],
    ["optSpecialZoneDisputed", "Disputed"],
    ["optSpecialZoneWasteland", "Wasteland"],
    ["optSpecialZoneCustom", "Custom"],
    ["lblSpecialZoneLabel", "Label"],
    ["specialZoneStartBtn", "Start Draw"],
    ["specialZoneUndoBtn", "Undo Vertex"],
    ["specialZoneFinishBtn", "Finish"],
    ["specialZoneCancelBtn", "Cancel"],
    ["lblSpecialZoneList", "Manual Zones"],
    ["specialZoneDeleteBtn", "Delete Selected"],
    ["specialZoneEditorHint", "Click map to add vertices, double-click to finish."],
    ["No manual zones", "No manual zones"],
    ["Drawing in progress: click map to add vertices, double-click to finish.", "Drawing in progress: click map to add vertices, double-click to finish."],
    ["lblProjectManagement", "Project Management"],
    ["lblProjectHint", "Save the current map state as a project file or restore one from disk. Loading a project replaces the current working state, and the app asks before continuing when the saved scenario baseline differs from the current assets."],
    ["downloadProjectBtn", "Download Project"],
    ["uploadProjectBtn", "Load Project"],
    ["lblProjectFile", "Selected File"],
    ["lblUtilities", "Utilities"],
    ["utilitiesGuideBtn", "Guide"],
    ["dockReferenceBtn", "Reference"],
    ["dockExportBtn", "Open workbench"],
    ["scenarioGuideSupportHint", "Open this manual from the scenario bar or the Utilities panel. Both Guide buttons open the same help surface, so you can keep the next editing step visible while you work."],
    ["referenceToolHint", "Upload a local image, align it with opacity / scale / offsets, then keep those alignment values in the project. The image file itself needs to be uploaded again when you restore the project."],
    ["lblExportTarget", "Target"],
    ["optExportTargetComposite", "Composite image"],
    ["optExportTargetPerLayer", "Per-layer PNG"],
    ["optExportTargetBakePack", "Bake pack (v1.1)"],
    ["inspectorSidebarTabInspector", "Inspector"],
    ["inspectorSidebarTabProject", "Project"],
    ["lblReferenceOpacity", "Opacity"],
    ["lblReferenceScale", "Scale"],
    ["lblReferenceOffsetX", "Offset X"],
    ["lblReferenceOffsetY", "Offset Y"],
    ["lblLegendEditor", "Legend Editor"],
    ["lblLegendHint", "Paint the map first, then rename each color entry here. Empty names clear the label, and the current legend list is kept inside this working session."],
    ["debugOptionPROD", "Normal View"],
    ["debugOptionGEOMETRY", "1. Geometry Check (Pink/Green)"],
    ["debugOptionARTIFACTS", "2. Artifact Hunter (Red Giants)"],
    ["debugOptionISLANDS", "3. Island Detector (Orange)"],
    ["debugOptionID_HASH", "4. ID Stability"],
    ["scenarioContextScenarioText", "Scenario: None"],
    ["scenarioContextModeText", "Mode: Visual Color"],
    ["scenarioContextActiveText", "Active: None"],
    ["scenarioContextCollapseBtn", "Collapse"],
    ["scenarioGuideTitle", "Scenario Quick Start"],
    ["scenarioGuideCloseBtn", "Close"],
    ["transportWorkbenchInfoTitle", "Transport guide"],
  ];

  uiMap.forEach(([id, label]) => {
    const el = document.getElementById(id);
    if (el) {
      const localizedText = t(label, "ui");
      const semanticChild = typeof el.querySelector === "function"
        ? el.querySelector(":scope > .sidebar-anchor-title, :scope > .sidebar-section-title, :scope > .sidebar-support-title, :scope > .sidebar-appendix-title, :scope > .sidebar-tool-title")
        : null;
      if (semanticChild instanceof HTMLElement) {
        semanticChild.textContent = localizedText;
      } else {
        el.textContent = localizedText;
      }
    }
  });

  const uiAttributeMap = [
    ["zoomUtilityViewportGroup", "aria-label", "Viewport controls"],
    ["zoomUtilitySystemGroup", "aria-label", "System status"],
    ["zoomUtilityWorkspaceGroup", "aria-label", "Workspace entry"],
  ];

  uiAttributeMap.forEach(([id, attributeName, label]) => {
    const el = document.getElementById(id);
    if (el) {
      el.setAttribute(attributeName, t(label, "ui"));
    }
  });

  if (typeof state.updateToolUIFn === "function") {
    state.updateToolUIFn();
  }
  if (typeof state.updateHistoryUIFn === "function") {
    state.updateHistoryUIFn();
  }
  if (typeof state.updateZoomUIFn === "function") {
    state.updateZoomUIFn();
  }
  if (typeof state.updatePaintModeUIFn === "function") {
    state.updatePaintModeUIFn();
  }
  if (typeof state.updateDevWorkspaceUIFn === "function") {
    state.updateDevWorkspaceUIFn();
  }
  if (typeof state.updateToolbarInputsFn === "function") {
    state.updateToolbarInputsFn();
  }
  if (typeof state.updateTransportAppearanceUIFn === "function") {
    state.updateTransportAppearanceUIFn();
  }
  if (typeof state.updateFacilityInfoCardUiFn === "function") {
    state.updateFacilityInfoCardUiFn();
  }
  if (typeof state.syncDeveloperModeUiFn === "function") {
    state.syncDeveloperModeUiFn();
  }

  const searchInput = document.getElementById("countrySearch");
  if (searchInput) {
    searchInput.setAttribute("placeholder", t("Search country or code...", "ui"));
  }

  const waterSearchInput = document.getElementById("waterRegionSearch");
  if (waterSearchInput) {
    waterSearchInput.setAttribute("placeholder", t("Search sea, lake, or strait...", "ui"));
  }

  const specialRegionSearchInput = document.getElementById("specialRegionSearch");
  if (specialRegionSearchInput) {
    specialRegionSearchInput.setAttribute("placeholder", t("Search basin, shelf, or exposure...", "ui"));
  }

  const paletteLibrarySearch = document.getElementById("paletteLibrarySearch");
  if (paletteLibrarySearch) {
    paletteLibrarySearch.setAttribute(
      "placeholder",
      t("Search country, ISO-2, or source tag...", "ui")
    );
  }

  const paletteLibraryToggle = document.getElementById("paletteLibraryToggle");
  if (paletteLibraryToggle) {
    const paletteLibraryPanel = document.getElementById("paletteLibraryPanel");
    const isOpen = paletteLibraryPanel ? !paletteLibraryPanel.classList.contains("hidden") : false;
    const label = isOpen
      ? t("Hide Color Library", "ui")
      : t("Browse All Colors", "ui");
    paletteLibraryToggle.setAttribute("aria-label", label);
    paletteLibraryToggle.setAttribute("title", label);
    const toggleLabel = document.getElementById("paletteLibraryToggleLabel");
    if (toggleLabel) toggleLabel.textContent = label;
  }

  const iconButtonLabels = [
    ["toolFillBtn", "Fill tool"],
    ["toolEraserBtn", "Eraser tool"],
    ["toolEyedropperBtn", "Eyedropper tool"],
    ["brushModeBtn", "Brush"],
    ["undoBtn", "Undo"],
    ["redoBtn", "Redo"],
    ["zoomInBtn", "Zoom in"],
    ["zoomOutBtn", "Zoom out"],
    ["zoomResetBtn", "Fit"],
    ["dockReferenceBtn", "Reference"],
    ["dockExportBtn", "Open workbench"],
  ];
  iconButtonLabels.forEach(([id, label]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const translated = t(label, "ui");
    el.setAttribute("aria-label", translated);
    el.setAttribute("title", translated);
  });

  const zoomPercentInput = document.getElementById("zoomPercentInput");
  if (zoomPercentInput) {
    zoomPercentInput.setAttribute("aria-label", t("Zoom percentage", "ui"));
    zoomPercentInput.setAttribute("title", t("Zoom percentage", "ui"));
  }

  const projectFileName = document.getElementById("projectFileName");
  if (projectFileName && !projectFileName.textContent.trim()) {
    projectFileName.textContent = t("No file selected", "ui");
  }

  const toolHudChip = document.getElementById("toolHudChip");
  if (toolHudChip && !toolHudChip.classList.contains("hidden")) {
    const currentText = toolHudChip.textContent?.trim();
    if (currentText) {
      toolHudChip.textContent = t(currentText, "ui");
    }
  }

  const onboardingHint = document.getElementById("mapOnboardingHint");
  if (onboardingHint) {
    onboardingHint.textContent = t(
      "Click a region to start painting, or use Auto-Fill to color all countries",
      "ui"
    );
  }

  const referencePopover = document.getElementById("dockReferencePopover");
  if (referencePopover) {
    referencePopover.setAttribute("aria-label", t("Reference tools", "ui"));
  }

  const confirmableButtons = [
    ["resetCountryColors", "Reset Country Colors"],
    ["specialZoneDeleteBtn", "Delete Selected"],
  ];
  confirmableButtons.forEach(([id, idleLabel]) => {
    const button = document.getElementById(id);
    if (!button || button.dataset.confirmState) return;
    button.textContent = t(idleLabel, "ui");
  });

  const leftPanelToggle = document.getElementById("leftPanelToggle");
  if (leftPanelToggle) {
    leftPanelToggle.textContent = t("Panels", "ui");
  }

  const rightPanelToggle = document.getElementById("rightPanelToggle");
  if (rightPanelToggle) {
    rightPanelToggle.textContent = t("Inspector", "ui");
  }

  if (typeof state.updateActiveSovereignUIFn === "function") {
    state.updateActiveSovereignUIFn();
  }
  if (typeof state.updatePaintModeUIFn === "function") {
    state.updatePaintModeUIFn();
  }
  if (typeof state.updateWorkspaceStatusFn === "function") {
    state.updateWorkspaceStatusFn();
  }
  if (typeof state.refreshTransportWorkbenchUiFn === "function") {
    state.refreshTransportWorkbenchUiFn();
  }
  if (typeof state.updatePaletteLibraryUIFn === "function") {
    state.updatePaletteLibraryUIFn();
  }
  if (typeof state.updateScenarioUIFn === "function") {
    state.updateScenarioUIFn();
  }
  if (typeof state.renderScenarioAuditPanelFn === "function") {
    state.renderScenarioAuditPanelFn();
  }
}

async function toggleLanguage() {
  const nextLang = state.currentLanguage === "zh" ? "en" : "zh";
  state.currentLanguage = nextLang;
  try {
    localStorage.setItem("map_lang", nextLang);
  } catch (error) {
    console.warn("Unable to persist language preference:", error);
  }
  if (typeof state.ensureFullLocalizationDataReadyFn === "function") {
    try {
      await state.ensureFullLocalizationDataReadyFn({
        reason: "language-toggle",
        renderNow: false,
      });
    } catch (error) {
      console.warn("Unable to hydrate full localization data before language toggle:", error);
    }
  }
  updateUIText();
  if (typeof state.updateToolbarInputsFn === "function") {
    state.updateToolbarInputsFn();
  }
  if (typeof state.renderCountryListFn === "function") {
    state.renderCountryListFn();
  }
  if (typeof state.renderPresetTreeFn === "function") {
    state.renderPresetTreeFn();
  }
  if (typeof state.updateParentBorderCountryListFn === "function") {
    state.updateParentBorderCountryListFn();
  }
  if (typeof state.updatePaintModeUIFn === "function") {
    state.updatePaintModeUIFn();
  }
  if (typeof state.updateDevWorkspaceUIFn === "function") {
    state.updateDevWorkspaceUIFn();
  }
  if (typeof state.updateSpecialZoneEditorUIFn === "function") {
    state.updateSpecialZoneEditorUIFn();
  }
  try {
    const { ensureScenarioGeoLocalePatchForLanguage } = await import("../core/scenario_resources.js");
    if (typeof ensureScenarioGeoLocalePatchForLanguage === "function") {
      await ensureScenarioGeoLocalePatchForLanguage(nextLang, { renderNow: false });
    }
  } catch (error) {
    console.warn("Unable to refresh scenario geo locale patch for active language:", error);
  }
  if (typeof state.renderNowFn === "function") {
    state.renderNowFn();
  }
}

function initTranslations() {
  updateUIText();
}

function getTooltipFeatureId(feature) {
  const raw =
    feature?.properties?.id ??
    feature?.properties?.NUTS_ID ??
    feature?.id;
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

function normalizeTooltipCountryCode(rawCode) {
  return normalizeCountryCodeAlias(rawCode);
}

function extractTooltipCountryCodeFromId(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";
  const prefix = text.split(/[-_]/)[0];
  if (/^[A-Z]{2,3}$/.test(prefix)) {
    return prefix;
  }
  const alphaPrefix = prefix.match(/^[A-Z]{2,3}/);
  return alphaPrefix ? alphaPrefix[0] : "";
}

function getTooltipFeatureCountryCode(feature) {
  const props = feature?.properties || {};
  const direct = (
    props.cntr_code ||
    props.CNTR_CODE ||
    props.iso_a2 ||
    props.ISO_A2 ||
    props.iso_a2_eh ||
    props.ISO_A2_EH ||
    props.adm0_a2 ||
    props.ADM0_A2 ||
    ""
  );
  const normalizedDirect = normalizeTooltipCountryCode(direct);
  if (/^[A-Z]{2,3}$/.test(normalizedDirect) && normalizedDirect !== "ZZ" && normalizedDirect !== "XX") {
    return normalizedDirect;
  }

  return normalizeTooltipCountryCode(
    extractTooltipCountryCodeFromId(props.id) ||
    extractTooltipCountryCodeFromId(props.NUTS_ID) ||
    extractTooltipCountryCodeFromId(feature?.id)
  );
}

function getTooltipRegionName(feature, fallback) {
  const rawName =
    getGeoFeatureDisplayLabel(feature) ||
    feature?.properties?.label ||
    feature?.properties?.name ||
    feature?.properties?.name_en ||
    feature?.properties?.NAME ||
    fallback;
  return rawName || fallback;
}

function normalizeTooltipComparisonValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getTooltipCountryContext(feature) {
  const featureId = getTooltipFeatureId(feature);
  const scenarioBaselineCode = state.activeScenarioId
    ? normalizeTooltipCountryCode(state.scenarioBaselineOwnersByFeatureId?.[featureId] || "")
    : "";
  const countryCode = scenarioBaselineCode || getTooltipFeatureCountryCode(feature);
  const rawCountryName =
    getScenarioCountryDisplayName(state.scenarioCountriesByTag?.[countryCode]) ||
    state.countryNames?.[countryCode] ||
    countryCode;
  const countryDisplayName = t(rawCountryName, "geo") || rawCountryName || countryCode;
  return {
    countryCode,
    countryDisplayName,
  };
}

function getTooltipAdmin1Name(feature, { regionName = "", countryDisplayName = "" } = {}) {
  const candidates = [
    feature?.properties?.admin1_group,
    feature?.properties?.constituent_country,
  ];
  const regionKey = normalizeTooltipComparisonValue(regionName);
  const countryKey = normalizeTooltipComparisonValue(countryDisplayName);

  for (const candidate of candidates) {
    const rawValue = String(candidate || "").trim();
    if (!rawValue) continue;
    const displayValue = t(rawValue, "geo") || rawValue;
    const comparisonValue = normalizeTooltipComparisonValue(displayValue);
    if (!comparisonValue) continue;
    if (comparisonValue === regionKey || comparisonValue === countryKey) continue;
    return displayValue;
  }

  return "";
}

function buildLegacyTooltipModel(feature, { isWaterRegion = false, isSpecialRegion = false } = {}) {
  const fallback = isWaterRegion ? t("Unknown Water Region", "ui") : t("Unknown Region", "ui");
  const name = getTooltipRegionName(feature, fallback);
  const code = getTooltipFeatureCountryCode(feature);
  const labelKey = isWaterRegion ? "Water Region" : "Region";
  const label = state.currentLanguage === "zh" ? t(labelKey, "ui") : labelKey;
  const waterType = isWaterRegion ? String(feature?.properties?.water_type || "").trim() : "";
  const specialType = isSpecialRegion ? String(feature?.properties?.special_type || "").trim() : "";
  const lines = [];

  if (!name && !code) {
    lines.push(label);
  } else if (waterType) {
    lines.push(`${label}: ${name} (${waterType})`);
  } else if (specialType) {
    lines.push(`${label}: ${name} (${specialType})`);
  } else if (code) {
    lines.push(`${label}: ${name} (${code})`);
  } else {
    lines.push(`${label}: ${name}`);
  }

  return {
    regionName: name,
    admin1Name: "",
    countryCode: code,
    countryDisplayName: "",
    lines,
  };
}

function buildTooltipModel(feature) {
  if (!feature) {
    return {
      regionName: "",
      admin1Name: "",
      countryCode: "",
      countryDisplayName: "",
      lines: [],
    };
  }

  const isWaterRegion = !!feature?.properties?.water_type;
  const isSpecialRegion = !!feature?.properties?.special_type;
  if (isWaterRegion || isSpecialRegion) {
    return buildLegacyTooltipModel(feature, { isWaterRegion, isSpecialRegion });
  }

  const regionName = getTooltipRegionName(feature, t("Unknown Region", "ui"));
  const { countryCode, countryDisplayName } = getTooltipCountryContext(feature);
  const admin1Name = getTooltipAdmin1Name(feature, {
    regionName,
    countryDisplayName,
  });
  const lines = [regionName];
  if (admin1Name) {
    lines.push(admin1Name);
  }
  if (countryDisplayName) {
    lines.push(countryCode ? `${countryDisplayName} (${countryCode})` : countryDisplayName);
  }

  return {
    regionName,
    admin1Name,
    countryCode,
    countryDisplayName,
    lines: lines.filter(Boolean),
  };
}

function renderTooltipText(model) {
  const lines = Array.isArray(model?.lines) ? model.lines.filter(Boolean) : [];
  return lines.join("\n");
}

function getTooltipText(feature) {
  return renderTooltipText(buildTooltipModel(feature));
}

function consumeStartupSupportKeyUsageAuditReport() {
  const auditState = startupSupportKeyUsageAuditState;
  startupSupportKeyUsageAuditState = null;
  if (!auditState) {
    return null;
  }
  return {
    enabled: true,
    language: String(state.currentLanguage || "en").trim() || "en",
    baseLocalizationLevel: String(state.baseLocalizationLevel || "").trim(),
    queryKeys: Array.from(auditState.queryKeys).sort(),
    directLocaleKeys: Array.from(auditState.directLocaleKeys).sort(),
    aliasKeys: Array.from(auditState.aliasKeys).sort(),
    aliasTargetKeys: Array.from(auditState.aliasTargetKeys).sort(),
    missKeys: Array.from(auditState.missKeys).sort(),
  };
}

function getStartupSupportKeyUsageAuditReport() {
  const auditState = startupSupportKeyUsageAuditState;
  if (!auditState) {
    return null;
  }
  return {
    enabled: true,
    language: String(state.currentLanguage || "en").trim() || "en",
    baseLocalizationLevel: String(state.baseLocalizationLevel || "").trim(),
    queryKeys: Array.from(auditState.queryKeys).sort(),
    directLocaleKeys: Array.from(auditState.directLocaleKeys).sort(),
    aliasKeys: Array.from(auditState.aliasKeys).sort(),
    aliasTargetKeys: Array.from(auditState.aliasTargetKeys).sort(),
    missKeys: Array.from(auditState.missKeys).sort(),
  };
}

function clearStartupSupportKeyUsageAuditReport() {
  startupSupportKeyUsageAuditState = null;
}

export {
  clearStartupSupportKeyUsageAuditReport,
  consumeStartupSupportKeyUsageAuditReport,
  getStartupSupportKeyUsageAuditReport,
  t,
  initTranslations,
  toggleLanguage,
  updateUIText,
  applyDeclarativeTranslations,
  getPreferredGeoLabel,
  getStrictGeoLabel,
  getGeoFeatureDisplayLabel,
  getTooltipCountryContext,
  buildTooltipModel,
  renderTooltipText,
  getTooltipText,
};
