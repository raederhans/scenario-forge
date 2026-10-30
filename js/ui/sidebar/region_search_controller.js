export function createRegionSearchController({
  documentRef, state, t, getFeatureOwnerCode, getFeatureLabel,
  selectLandFeatureById, maxResults = 30,
}) {
  const tr = (key) => t(key, "ui");
  let country = "";
  let block, input, results, status;
  let matches = [];
  let activeIndex = -1;
  const normalizeCode = (code) => String(code || "").trim().toUpperCase();

  function setActive(index) {
    activeIndex = index;
    Array.from(results.children).forEach((option, i) => {
      if (i < matches.length) option.setAttribute("aria-selected", String(i === index));
    });
    if (index < 0) input.removeAttribute("aria-activedescendant");
    else input.setAttribute("aria-activedescendant", `regionSearchOption-${index}`);
  }

  function close() {
    results.classList.add("hidden");
    input.setAttribute("aria-expanded", "false");
    setActive(-1);
  }

  function clear() {
    input.value = "";
    matches = [];
    results.replaceChildren();
    status.textContent = "";
    close();
  }

  function select(index) {
    const { id, label } = matches[index];
    if (selectLandFeatureById(id)) {
      status.textContent = tr("Selected {name}").replace("{name}", `${label} (${id})`);
      input.value = label;
      close();
    } else {
      status.textContent = tr("Region is not loaded yet.");
    }
    input.focus();
  }

  function search() {
    const query = input.value.trim().toLowerCase();
    matches = [];
    results.replaceChildren();
    close();
    status.textContent = "";
    if (!query || !country) return;
    for (const [id, feature] of state.landIndex) {
      if (normalizeCode(getFeatureOwnerCode(id)) !== country) continue;
      const label = getFeatureLabel(feature, id);
      // The source name stays searchable when the UI shows a translated label.
      const sourceName = String(feature?.properties?.name || "").trim();
      const keys = [label, sourceName, id].map((value) => value.toLowerCase());
      if (keys.some((value) => value.includes(query))) {
        matches.push({
          id,
          label,
          sourceName: sourceName && sourceName !== label ? sourceName : "",
          prefix: keys.some((value) => value.startsWith(query)),
        });
      }
    }
    matches.sort((a, b) => Number(b.prefix) - Number(a.prefix) || a.label.localeCompare(b.label));
    const count = matches.length;
    matches = matches.slice(0, maxResults);
    matches.forEach(({ id, label, sourceName }, index) => {
      const option = documentRef.createElement("li");
      option.id = `regionSearchOption-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.setAttribute("data-feature-id", id);
      const name = documentRef.createElement("span");
      name.textContent = label;
      const detail = documentRef.createElement("span");
      detail.className = "region-search-id";
      detail.textContent = sourceName ? `${id} · ${sourceName}` : id;
      option.append(name, detail);
      option.addEventListener("click", () => select(index));
      results.appendChild(option);
    });
    if (count > maxResults) {
      const note = documentRef.createElement("li");
      note.setAttribute("role", "option");
      note.setAttribute("aria-disabled", "true");
      note.className = "region-search-limit";
      note.textContent = tr("Showing first {count} matches. Refine the search.").replace("{count}", maxResults);
      results.appendChild(note);
    }
    status.textContent = count === 1
      ? tr("1 matching region")
      : count
        ? tr("{count} matching regions").replace("{count}", count)
        : tr("No matching regions");
    if (matches.length) {
      results.classList.remove("hidden");
      input.setAttribute("aria-expanded", "true");
    }
  }

  function onKeyDown(event) {
    // Enter/arrows/Escape belong to the IME while a composition is active.
    if (event.isComposing || event.keyCode === 229) return;
    const open = input.getAttribute("aria-expanded") === "true";
    if (event.key === "Escape") {
      if (!open && !input.value) return;
      event.preventDefault();
      event.stopPropagation();
      if (open) close();
      else clear();
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && matches.length) {
      event.preventDefault();
      results.classList.remove("hidden");
      input.setAttribute("aria-expanded", "true");
      const next = activeIndex < 0
        ? (event.key === "ArrowDown" ? 0 : matches.length - 1)
        : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      setActive(next);
      results.children[next].scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && open && (activeIndex >= 0 || matches.length === 1)) {
      event.preventDefault();
      select(activeIndex >= 0 ? activeIndex : 0);
    }
  }

  function mount(container) {
    block = documentRef.createElement("div");
    block.className = "card-flat inspector-search-block region-search-block";
    block.classList.toggle("hidden", !country);
    const label = documentRef.createElement("label");
    label.className = "visually-hidden";
    label.setAttribute("for", "regionSearchInput");
    label.setAttribute("data-i18n", "Find region");
    label.textContent = tr("Find region");
    const row = documentRef.createElement("div");
    row.className = "inspector-search-input-row";
    row.innerHTML = '<svg class="inspector-search-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.6"></circle><path d="M16 16 20 20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>';
    input = documentRef.createElement("input");
    input.id = "regionSearchInput";
    input.className = "input inspector-search-input";
    for (const [key, value] of Object.entries({
      type: "search", role: "combobox", "aria-autocomplete": "list",
      "aria-expanded": "false", "aria-controls": "regionSearchResults",
      placeholder: tr("Search region name or ID…"),
      "data-i18n-placeholder": "Search region name or ID…", autocomplete: "off", spellcheck: "false",
    })) input.setAttribute(key, value);
    row.appendChild(input);
    results = documentRef.createElement("ul");
    results.id = "regionSearchResults";
    results.className = "region-search-results hidden";
    results.setAttribute("role", "listbox");
    results.setAttribute("aria-label", tr("Matching regions"));
    results.setAttribute("data-i18n-aria-label", "Matching regions");
    status = documentRef.createElement("p");
    status.id = "regionSearchStatus";
    status.className = "visually-hidden";
    status.setAttribute("aria-live", "polite");
    block.append(label, row, results, status);
    container.appendChild(block);
    input.addEventListener("input", search);
    input.addEventListener("keydown", onKeyDown);
  }

  function setCountry(code) {
    const next = normalizeCode(code);
    if (next === country) return;
    country = next;
    clear();
    block.classList.toggle("hidden", !country);
  }

  function destroy() {
    input.removeEventListener("input", search);
    input.removeEventListener("keydown", onKeyDown);
    block.remove();
  }

  return { mount, setCountry, destroy };
}
