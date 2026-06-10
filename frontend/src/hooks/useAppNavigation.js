import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { NAV_TO_PATH } from "../app/main/appMainLogic.js";

/** Route tab from pathname + legacy ?tab= redirects. */
export function useAppNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const tab = new URLSearchParams(location.search).get("tab");
    if (!tab) return;
    const dest = NAV_TO_PATH[tab];
    if (!dest) return;
    navigate(dest, { replace: true });
  }, [location.search, navigate]);

  useEffect(() => {
    const p = location.pathname.replace(/\/$/, "") || "/";
    const known = new Set(["/releases", "/trends", "/thresholds", "/audit", "/escalations"]);
    if (!known.has(p)) navigate("/releases", { replace: true });
  }, [location.pathname, navigate]);

  const nav = useMemo(() => {
    const p = location.pathname.replace(/\/$/, "") || "/";
    const map = {
      "/releases": "release",
      "/trends": "trend",
      "/thresholds": "thresholds",
      "/audit": "audit",
      "/escalations": "escalations"
    };
    return map[p] || "release";
  }, [location.pathname]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return {
    navigate,
    location,
    nav,
    isMobile: viewportWidth <= 900
  };
}
