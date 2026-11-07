import { state } from "../core/state.js";
import { getLocalizedScenarioCountryName } from "../core/scenario_country_display.js";
import { t, getDirectGeoLabel } from "./i18n.js";

export function createScenarioIntroCard(container) {
  const document = container.ownerDocument;
  const card = document.createElement("section");
  card.className = "scenario-intro-card";
  card.hidden = true;
  card.setAttribute("aria-labelledby", "scenarioIntroTitle");
  container.appendChild(card);

  const hide = () => { card.hidden = true; };
  card.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      hide();
    }
  });

  const show = (presentation) => {
    card.replaceChildren();
    const element = (tag, className, text) => {
      const node = document.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const close = element("button", "scenario-intro-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", t("Close scenario introduction", "ui"));
    close.addEventListener("click", hide);
    const title = element("h2", "scenario-intro-title", t(presentation.title, "ui"));
    title.id = "scenarioIntroTitle";
    card.append(close, title,
      element("p", "scenario-intro-tagline", t(presentation.tagline, "ui")),
      element("p", "scenario-intro-description", t(presentation.intro, "ui")));
    if (presentation.powers.length) {
      const powers = element("div", "scenario-intro-powers");
      powers.appendChild(element("h3", "scenario-intro-heading", t("Major powers", "ui")));
      presentation.powers.forEach((code) => {
        const country = state.scenarioCountriesByTag?.[code];
        const power = element("span", "scenario-intro-power");
        const swatch = element("span", "scenario-intro-swatch");
        swatch.style.backgroundColor = state.sovereignBaseColors?.[code] || country?.color_hex || "";
        swatch.setAttribute("aria-hidden", "true");
        power.append(swatch, element("span", "", getLocalizedScenarioCountryName(country, code, getDirectGeoLabel)));
        powers.appendChild(power);
      });
      card.appendChild(powers);
    }
    if (presentation.layers.length) {
      const section = element("div", "scenario-intro-layers");
      section.appendChild(element("h3", "scenario-intro-heading", t("Featured in this scenario", "ui")));
      const list = element("ul", "");
      presentation.layers.forEach((layer) => list.appendChild(element("li", "", t(layer, "ui"))));
      section.appendChild(list);
      card.appendChild(section);
    }
    card.hidden = false;
  };

  return { show, hide, get visible() { return !card.hidden; }, dispose: () => card.remove() };
}
