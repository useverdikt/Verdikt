import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LandingPage from "./pages/LandingPage.jsx";
import PricingPage from "./pages/PricingPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import ForgotPasswordPage from "./pages/ForgotPasswordPage.jsx";
import ResetPasswordPage from "./pages/ResetPasswordPage.jsx";
import RequestAccessPage from "./pages/RequestAccessPage.jsx";
import AcceptInvitePage from "./pages/AcceptInvitePage.jsx";
import ProtectedRoute from "./auth/ProtectedRoute.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import RouteLoadingFallback from "./components/RouteLoadingFallback.jsx";
import "./index.css";

const App = lazy(() => import("./App.jsx"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage.jsx"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.jsx"));
const EmailsPage = lazy(() => import("./pages/EmailsPage.jsx"));
const IntelligencePage = lazy(() => import("./pages/IntelligencePage.jsx"));
const IntelligenceOverview = lazy(() => import("./pages/intelligence/IntelligenceOverview.jsx"));
const PanelWrapper = lazy(() => import("./pages/intelligence/PanelWrapper.jsx"));
const LoopReadinessPanel = lazy(() =>
  import("./pages/intelligence/panels/LoopReadinessPanel.jsx").then((m) => ({ default: m.LoopReadinessPanel }))
);
const CorrelationPanel = lazy(() =>
  import("./pages/intelligence/panels/CorrelationPanel.jsx").then((m) => ({ default: m.CorrelationPanel }))
);
const SignalReliabilityPanel = lazy(() =>
  import("./pages/intelligence/panels/SignalReliabilityPanel.jsx").then((m) => ({ default: m.SignalReliabilityPanel }))
);
const OverrideAnalyticsPanel = lazy(() =>
  import("./pages/intelligence/panels/OverrideAnalyticsPanel.jsx").then((m) => ({ default: m.OverrideAnalyticsPanel }))
);
const VcsMonitorPanel = lazy(() =>
  import("./pages/intelligence/panels/VcsMonitorPanel.jsx").then((m) => ({ default: m.VcsMonitorPanel }))
);
const ProductionHealthPanel = lazy(() =>
  import("./pages/intelligence/panels/ProductionHealthPanel.jsx").then((m) => ({ default: m.ProductionHealthPanel }))
);
const ThresholdSimulatorPanel = lazy(() =>
  import("./pages/intelligence/panels/ThresholdSimulatorPanel.jsx").then((m) => ({ default: m.ThresholdSimulatorPanel }))
);
const BadgePage = lazy(() => import("./pages/BadgePage.jsx"));
const SignalSimulatorPage = lazy(() => import("./pages/SignalSimulatorPage.jsx"));

const rootEl = document.getElementById("root");
if (rootEl) {
  try {
    createRoot(rootEl).render(
      <ErrorBoundary>
        <BrowserRouter>
          <Suspense fallback={<RouteLoadingFallback />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/request-access" element={<RequestAccessPage />} />
              <Route path="/accept-invite" element={<AcceptInvitePage />} />
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/emails"
                element={
                  <ProtectedRoute>
                    <EmailsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/intelligence"
                element={
                  <ProtectedRoute>
                    <IntelligencePage />
                  </ProtectedRoute>
                }
              >
                <Route
                  index
                  element={
                    <Suspense fallback={<RouteLoadingFallback />}>
                      <IntelligenceOverview />
                    </Suspense>
                  }
                />
                <Route
                  path="readiness"
                  element={
                    <Suspense fallback={<RouteLoadingFallback />}>
                      <PanelWrapper Component={LoopReadinessPanel} passProdObs />
                    </Suspense>
                  }
                />
                <Route
                  path="alignment"
                  element={
                    <Suspense fallback={<RouteLoadingFallback />}>
                      <PanelWrapper Component={ProductionHealthPanel} passProdObs />
                    </Suspense>
                  }
                />
                <Route
                  path="vcs"
                  element={
                    <Suspense fallback={<RouteLoadingFallback />}>
                      <PanelWrapper Component={VcsMonitorPanel} />
                    </Suspense>
                  }
                />
                <Route
                  path="correlations"
                  element={
                    <Suspense fallback={<RouteLoadingFallback />}>
                      <PanelWrapper Component={CorrelationPanel} />
                    </Suspense>
                  }
                />
                <Route
                  path="reliability"
                  element={
                    <Suspense fallback={<RouteLoadingFallback />}>
                      <PanelWrapper Component={SignalReliabilityPanel} />
                    </Suspense>
                  }
                />
                <Route
                  path="overrides"
                  element={
                    <Suspense fallback={<RouteLoadingFallback />}>
                      <PanelWrapper Component={OverrideAnalyticsPanel} />
                    </Suspense>
                  }
                />
                <Route
                  path="simulator"
                  element={
                    <Suspense fallback={<RouteLoadingFallback />}>
                      <PanelWrapper Component={ThresholdSimulatorPanel} />
                    </Suspense>
                  }
                />
                <Route path="*" element={<Navigate to="/intelligence" replace />} />
              </Route>
              <Route
                path="/signal-sim"
                element={
                  <ProtectedRoute>
                    <SignalSimulatorPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/badge" element={<BadgePage />} />
              <Route path="/badge/:workspaceSlug/:version" element={<BadgePage />} />
              <Route path="/cert/:workspaceSlug/:version" element={<BadgePage />} />
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <App />
                  </ProtectedRoute>
                }
              />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ErrorBoundary>
    );
  } catch (err) {
    const pre = document.createElement("pre");
    pre.style.color = "#f87171";
    pre.style.background = "#0c0d10";
    pre.style.padding = "24px";
    pre.style.fontFamily = "monospace";
    pre.style.fontSize = "13px";
    pre.style.whiteSpace = "pre-wrap";
    pre.textContent = String(err?.message || err || "") + "\n\n" + String(err?.stack || "");
    rootEl.innerHTML = "";
    rootEl.appendChild(pre);
  }
}
