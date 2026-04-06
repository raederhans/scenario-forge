const { test, expect } = require("@playwright/test");
const { gotoApp } = require("./support/playwright-app");

test("ui contract foundation exposes shared rules and focus helpers", async ({ page }) => {
  await gotoApp(page, "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#toastViewport", { state: "attached", timeout: 15_000 });

  const snapshot = await page.evaluate(async () => {
    const {
      createFocusReturnRegistry,
      focusSurface,
      getUiContractSnapshot,
      rememberSurfaceTrigger,
      restoreSurfaceTriggerFocus,
    } = await import("/js/ui/ui_contract.js");

    const host = document.createElement("div");
    host.innerHTML = `
      <button type="button" id="uiContractTrigger">trigger</button>
      <div id="uiContractSurface"></div>
    `;
    document.body.appendChild(host);

    const trigger = host.querySelector("#uiContractTrigger");
    const surface = host.querySelector("#uiContractSurface");
    surface.innerHTML = `<button type="button" id="uiContractAction">action</button>`;

    const registry = createFocusReturnRegistry();
    trigger.focus();
    rememberSurfaceTrigger(registry, surface, trigger);
    focusSurface(surface);
    const focusedInsideSurface = document.activeElement?.id || "";
    restoreSurfaceTriggerFocus(registry, surface);
    const restoredFocus = document.activeElement?.id || "";

    host.remove();

    return {
      snapshot: getUiContractSnapshot(),
      focusedInsideSurface,
      restoredFocus,
    };
  });

  expect(snapshot.snapshot.text.shellAnchors).toEqual(["scope-project", "scope-inspector"]);
  expect(snapshot.snapshot.text.primaryAnchors).toEqual(["project-legend-anchor"]);
  expect(snapshot.snapshot.text.supportHeads).toEqual(["utilities-support"]);
  expect(snapshot.snapshot.text.appendixHeads).toEqual(["diagnostics-appendix"]);
  expect(snapshot.snapshot.scope.categories).toEqual(["current-object", "current-layer", "current-project"]);
  expect(snapshot.snapshot.scope.defaultCategory).toBe("current-project");
  expect(snapshot.snapshot.classes.surface.sectionShell).toBe("sidebar-section-shell");
  expect(snapshot.snapshot.classes.copy.emptyCopy).toBe("sidebar-empty-copy");
  expect(snapshot.snapshot.classes.action.supportEntry).toBe("sidebar-support-entry-btn");
  expect(snapshot.snapshot.classes.legacyBridge).toBeUndefined();
  expect(snapshot.snapshot.interaction.defaultButtonLanguage).toBe("text-first");
  expect(snapshot.snapshot.interaction.singlePrimaryActionPerSurface).toBe(true);
  expect(snapshot.snapshot.interaction.iconOnlyBlocklist).toContain("language-toggle");
  expect(snapshot.snapshot.interaction.overlayKinds.dialog.allowsFocusTrap).toBe(true);
  expect(snapshot.snapshot.interaction.overlayKinds.popover.allowsFocusTrap).toBe(false);
  expect(snapshot.snapshot.urlState.required).toEqual(["scope", "tab", "section", "query", "page", "view"]);
  expect(snapshot.snapshot.urlState.localOnly).toEqual(["hover", "tooltip", "transient"]);
  expect(snapshot.snapshot.density.loose).toContain("map-canvas");
  expect(snapshot.focusedInsideSurface).toBe("uiContractAction");
  expect(snapshot.restoredFocus).toBe("uiContractTrigger");
});
