import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isAuthenticated } from "../auth/session.js";
import OnboardingWizard from "./onboarding/OnboardingWizard.jsx";
import "./onboarding/OnboardingPage.css";

export default function OnboardingPage() {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Verdikt — Setup";
    return () => {
      document.title = "Verdikt — Release Intelligence System";
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated()) navigate("/releases", { replace: true });
  }, [navigate]);

  return (
    <div className="vdk-onb">
      <OnboardingWizard />
    </div>
  );
}
