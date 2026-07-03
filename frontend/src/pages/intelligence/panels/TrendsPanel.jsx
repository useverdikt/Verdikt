import React from "react";
import TrendView from "../../../components/app/views/TrendView.jsx";
import { useTrendChartReleases } from "../../../hooks/useTrendChartReleases.js";
import {
  SIGNAL_CATEGORIES,
  calcCategoryStatus,
  catStatusColor,
  evaluateSignal,
  formatReleaseDisplayName,
  getRegressionRequired
} from "../../../app/main/appMainLogic.js";
import { TREND_CHART_MAX_POINTS, trendChartXLabel } from "../../../lib/trendChart.js";

export function TrendsPanel() {
  const { releases, wsReady, thresholds } = useTrendChartReleases();

  return (
    <TrendView
      releases={releases}
      wsReady={wsReady}
      trendChartMaxPoints={TREND_CHART_MAX_POINTS}
      signalCategories={SIGNAL_CATEGORIES}
      thresholds={thresholds}
      getRegressionRequired={getRegressionRequired}
      evaluateSignal={evaluateSignal}
      calcCategoryStatus={calcCategoryStatus}
      catStatusColor={catStatusColor}
      trendChartXLabel={trendChartXLabel}
      formatReleaseDisplayName={formatReleaseDisplayName}
    />
  );
}
