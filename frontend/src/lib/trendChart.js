export const TREND_CHART_MAX_POINTS = 18;

export const trendChartXLabel = (index, totalPoints) => {
  if (totalPoints <= 1) return "R1";
  const every = Math.max(1, Math.ceil(totalPoints / 7));
  if (index % every !== 0 && index !== totalPoints - 1) return "";
  return `R${index + 1}`;
};
