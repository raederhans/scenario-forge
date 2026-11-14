// Transport workbench lens owner.
// Owns left-column lens DOM models and skips repeated rebuilds when the rendered lens output is unchanged.

export function buildTransportWorkbenchLensModel({
  family = null,
  previewSnapshot = {},
  dataContract = null,
  rightDeckLabel = "",
  translate = (label) => label,
  pickUiCopy = (_zh, en) => en,
  buildLensSummaryRows = () => [],
} = {}) {
  if (family?.id === "layers") {
    return {
      cards: [
        {
          type: "empty",
          title: translate("Future draw stack"),
          body: pickUiCopy(
            "拖动行以调整绘制顺序。",
            "Drag rows to change the drawing order.",
          ),
        },
      ],
    };
  }
  const summaryRows = buildLensSummaryRows({
    family,
    previewSnapshot,
    dataContract,
    rightDeckLabel,
  });
  return {
    cards: [
      {
        type: "summary",
        tone: "soft",
        title: translate("Current context"),
        rows: summaryRows,
      },
    ],
  };
}

export function buildTransportWorkbenchLensRenderSignature(model = {}) {
  return JSON.stringify({
    cards: (model.cards || []).map((card) => ({
      type: card.type,
      tone: card.tone || "",
      title: card.title || "",
      body: card.body || "",
      rows: (card.rows || []).map(([label, value]) => [String(label ?? ""), String(value ?? "")]),
    })),
  });
}

export function createTransportWorkbenchLensOwner({
  mount = null,
  closeSectionHelpPopover = () => {},
  translate = (label) => label,
  pickUiCopy = (_zh, en) => en,
  createRow = null,
  buildLensSummaryRows = () => [],
} = {}) {
  let lastRender = null;

  const appendTitle = (card, titleText) => {
    const title = document.createElement("div");
    title.className = "transport-workbench-note-title";
    title.textContent = titleText;
    card.appendChild(title);
  };

  const appendTextBlock = (card, titleText, bodyText, className) => {
    appendTitle(card, titleText);
    const body = document.createElement("p");
    body.className = className;
    body.textContent = bodyText;
    card.appendChild(body);
  };

  const createCardNode = (cardModel) => {
    const card = document.createElement("div");
    if (cardModel.type === "empty") {
      card.className = "transport-workbench-empty-card";
      const title = document.createElement("div");
      title.className = "transport-workbench-empty-title";
      title.textContent = cardModel.title;
      const body = document.createElement("p");
      body.className = "transport-workbench-empty-text";
      body.textContent = cardModel.body;
      card.append(title, body);
      return card;
    }
    const toneClass = cardModel.tone === "emphasis"
      ? "transport-workbench-note-card-emphasis"
      : "transport-workbench-note-card-soft";
    card.className = `transport-workbench-note-card ${toneClass}`;
    if (cardModel.type === "summary") {
      card.classList.add("transport-workbench-lens-summary");
      appendTitle(card, cardModel.title);
      (cardModel.rows || []).forEach(([label, value]) => {
        const row = createRow
          ? createRow(label, value)
          : document.createTextNode(`${label}: ${value}`);
        card.appendChild(row);
      });
      return card;
    }
    appendTextBlock(card, cardModel.title, cardModel.body || "", "transport-workbench-note-text");
    return card;
  };

  const render = ({
    family = null,
    previewSnapshot = {},
    dataContract = null,
    rightDeckLabel = "",
  } = {}) => {
    if (!mount) return { reused: false, cardCount: 0 };
    closeSectionHelpPopover({ restoreFocus: false });
    const model = buildTransportWorkbenchLensModel({
      family,
      previewSnapshot,
      dataContract,
      rightDeckLabel,
      translate,
      pickUiCopy,
      buildLensSummaryRows,
    });
    const signature = buildTransportWorkbenchLensRenderSignature(model);
    if (
      lastRender?.mount === mount
      && lastRender.signature === signature
      && lastRender.childElementCount === mount.childElementCount
    ) {
      return { reused: true, cardCount: model.cards.length };
    }
    mount.replaceChildren(...model.cards.map(createCardNode));
    lastRender = {
      mount,
      signature,
      childElementCount: mount.childElementCount,
    };
    return { reused: false, cardCount: model.cards.length };
  };

  return {
    buildModel: (input = {}) => buildTransportWorkbenchLensModel({
      ...input,
      translate,
      pickUiCopy,
      buildLensSummaryRows,
    }),
    render,
  };
}
