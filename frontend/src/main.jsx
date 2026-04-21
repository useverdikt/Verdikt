import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage.jsx";
import PricingPage from "./pages/PricingPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import ForgotPasswordPage from "./pages/ForgotPasswordPage.jsx";
import ResetPasswordPage from "./pages/ResetPasswordPage.jsx";
import RequestAccessPage from "./pages/RequestAccessPage.jsx";
import ProtectedRoute from "./auth/ProtectedRoute.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import RouteLoadingFallback from "./components/RouteLoadingFallback.jsx";
import "./index.css";

const App = lazy(() => import("./App.jsx"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage.jsx"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.jsx"));
const EmailsPage = lazy(() => import("./pages/EmailsPage.jsx"));
const IntelligencePage = lazy(() => import("./pages/IntelligencePage.jsx"));
const BadgePage = lazy(() => import("./pages/BadgePage.jsx"));

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
              />
              <Route path="/badge" element={<BadgePage />} />
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
