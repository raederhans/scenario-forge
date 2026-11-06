export function initCommandPalette({ documentRef = document, t, getCommands }) {
  const make = (tag, className, id = "") => {
    const node = documentRef.createElement(tag);
    node.className = className;
    if (id) node.id = id;
    return node;
  };
  const overlay = make("div", "editor-command-overlay", "editorCommandPalette");
  overlay.hidden = true;
  const dialog = make("div", "editor-command-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  const input = make("input", "editor-command-search", "editorCommandSearch");
  input.type = "text";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", "editorCommandResults");
  input.setAttribute("aria-expanded", "false");
  const results = make("div", "editor-command-results", "editorCommandResults");
  results.setAttribute("role", "listbox");
  const empty = make("p", "editor-command-empty");
  empty.setAttribute("role", "status");
  dialog.append(input, results, empty);
  overlay.append(dialog);
  documentRef.body.append(overlay);
  let previousFocus;
  let commands = [];
  let options = [];
  let active = 0;
  const close = () => {
    overlay.hidden = true;
    input.setAttribute("aria-expanded", "false");
    previousFocus?.focus();
  };
  const execute = (command) => {
    close();
    command.button.click();
  };
  const select = (index) => {
    active = index;
    options.forEach((option, i) => option.setAttribute("aria-selected", String(i === active)));
    if (options[active]) {
      input.setAttribute("aria-activedescendant", options[active].id);
      options[active].scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };
  const render = () => {
    const query = input.value.trim().toLowerCase();
    commands = getCommands().filter(({ button, label, key, shortcut }) =>
      button && !button.disabled && (query === "?" ? shortcut : `${t(label, "ui")} ${key} ${label}`.toLowerCase().includes(query))
    ).slice(0, 50);
    results.replaceChildren();
    options = [];
    for (const group of ["Layers", "Objects", "Tools", "Project"]) {
      const entries = commands.filter((command) => command.group === group);
      if (!entries.length) continue;
      const section = make("div", "editor-command-group");
      section.setAttribute("role", "group");
      section.setAttribute("aria-label", t(group, "ui"));
      const heading = make("div", "editor-command-heading");
      heading.setAttribute("role", "presentation");
      heading.textContent = t(group, "ui");
      section.append(heading);
      for (const command of entries) {
        const option = make("div", "editor-command-option", `editorCommandOption-${options.length}`);
        option.setAttribute("role", "option");
        const label = make("span", "");
        label.textContent = t(command.label, "ui");
        option.append(label);
        if (command.shortcut) {
          const shortcut = make("kbd", "");
          shortcut.textContent = command.shortcut;
          option.append(shortcut);
        }
        option.addEventListener("click", () => execute(command));
        section.append(option);
        options.push(option);
      }
      results.append(section);
    }
    commands = ["Layers", "Objects", "Tools", "Project"].flatMap((group) => commands.filter((command) => command.group === group));
    empty.textContent = t("No matching commands", "ui");
    empty.hidden = commands.length !== 0;
    select(0);
  };
  const open = (query = "") => {
    if (overlay.hidden) previousFocus = documentRef.activeElement;
    overlay.hidden = false;
    dialog.setAttribute("aria-label", t("Command palette", "ui"));
    input.placeholder = t("Search commands", "ui");
    input.setAttribute("aria-label", t("Search commands", "ui"));
    results.setAttribute("aria-label", t("Command palette", "ui"));
    input.setAttribute("aria-expanded", "true");
    input.value = query;
    render();
    input.focus();
  };
  input.addEventListener("input", render);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  documentRef.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      event.stopPropagation();
      open();
      return;
    }
    if (overlay.hidden) return;
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "Tab") { event.preventDefault(); input.focus(); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (commands.length) select((active + (event.key === "ArrowDown" ? 1 : -1) + commands.length) % commands.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (commands[active]) execute(commands[active]);
    }
  }, true);
  return { open, close };
}
