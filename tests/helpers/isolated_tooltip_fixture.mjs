import { getTooltipText as getProductionTooltipText } from "../../js/core/i18n.js";
import { state as runtimeState } from "../../js/core/state.js";

// Call the real production tooltip with the fixture's fields bound onto the
// shared runtime state for the duration of each call, then put every touched
// key back so tests never leak state into each other.
export function createTooltipFixture(fixtureState) {
  return {
    getTooltipText(...args) {
      const keys = Object.keys(fixtureState || {});
      const previous = new Map(keys.map((key) => [key, {
        present: Object.hasOwn(runtimeState, key),
        value: runtimeState[key],
      }]));
      Object.assign(runtimeState, fixtureState);
      try {
        return getProductionTooltipText(...args);
      } finally {
        previous.forEach(({ present, value }, key) => {
          if (present) runtimeState[key] = value;
          else delete runtimeState[key];
        });
      }
    },
  };
}
