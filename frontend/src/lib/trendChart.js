export const TREND_CHART_MAX_POINTS = 18;

/** Newest-first release list → chronological window used by TrendView (oldest→newest, last N). */
export function trendChartWindowReleases(releases, maxPoints = TREND_CHART_MAX_POINTS) {
  if (!Array.isArray(releases) || !releases.length) return [];
  return [...releases].reverse().slice(-maxPoints);
}

export const trendChartXLabel = (index, totalPoints) => {
  if (totalPoints <= 1) return "R1";
  const every = Math.max(1, Math.ceil(totalPoints / 7));
  if (index % every !== 0 && index !== totalPoints - 1) return "";
  return `R${index + 1}`;
};
