import shared from "../../../shared/config.json";

const SOURCE_MAP = shared.signalSourceMap || {};

/**
 * Filter signal simulator sources to connected integrations with mandatory certification signals.
 * @param {Array<{ id: string, signals: Array<{ id: string }> }>} sources
 * @param {Record<string, { required_for_certification?: boolean }>} thresholdMap
 * @param {Set<string>|string[]} connectedSourceIds
 */
export function filterSimulatorSourcesForMandatory(sources, thresholdMap, connectedSourceIds) {
  const connected = connectedSourceIds instanceof Set ? connectedSourceIds : new Set(connectedSourceIds || []);
  return sources
    .filter((src) => connected.has(src.id))
    .map((src) => {
      const allowed = new Set(SOURCE_MAP[src.id] || []);
      const signals = (src.signals || []).filter((sig) => {
        if (!allowed.has(sig.id)) return false;
        return !!thresholdMap?.[sig.id]?.required_for_certification;
      });
      return { ...src, signals };
    })
    .filter((src) => src.signals.length > 0);
}
