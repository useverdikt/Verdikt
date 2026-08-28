import shared from "@shared/config.json";

/** First-run AI pack — same ids as shared default required signals. */
export const RECOMMENDED_FIRST_RUN_SIGNAL_IDS = [...(shared.defaultRequiredSignalIds || [])];

/**
 * Library signal ids from the recommended pack that are not yet adopted.
 * @param {string[]} recommendedIds
 * @param {{ signal_id?: string }[]} definitions
 * @param {{ signal_id?: string }[]} library
 */
export function missingRecommendedPackIds(
  recommendedIds = RECOMMENDED_FIRST_RUN_SIGNAL_IDS,
  definitions = [],
  library = []
) {
  const adopted = new Set((definitions || []).map((d) => d.signal_id).filter(Boolean));
  const inLibrary = new Set((library || []).map((e) => e.signal_id).filter(Boolean));
  return (recommendedIds || []).filter((id) => !adopted.has(id) && inLibrary.has(id));
}

/**
 * Adopt missing recommended-pack signals sequentially via the existing one-at-a-time API.
 * @param {(signalId: string) => Promise<unknown>} adoptOne
 */
export async function adoptMissingLibrarySignals(ids, adoptOne) {
  const adopted = [];
  for (const id of ids || []) {
    await adoptOne(id);
    adopted.push(id);
  }
  return adopted;
}
