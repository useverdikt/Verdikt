/** Intelligence Hub sub-route labels and navigation structure. */

export const INTELLIGENCE_ROUTE_TITLES = {
  "": "Intelligence Overview",
  readiness: "Loop Readiness",
  alignment: "Production Alignment",
  vcs: "VCS Production Monitor",
  correlations: "Signal Correlations",
  reliability: "Signal Reliability",
  overrides: "Override Analytics",
  simulator: "Threshold Simulator"
};

export const PROD_OBS_ROUTES = new Set(["readiness", "alignment"]);

export function intelligenceRouteSegment(pathname) {
  return pathname.replace(/^\/intelligence\/?/, "").split("/")[0] || "";
}

export const INTELLIGENCE_NAV_GROUPS = [
  {
    items: [{ to: "/intelligence", label: "Overview", end: true }]
  },
  {
    header: "Loop & alignment",
    items: [
      { to: "/intelligence/readiness", label: "Loop Readiness" },
      { to: "/intelligence/alignment", label: "Production Alignment" },
      { to: "/intelligence/vcs", label: "VCS Production Monitor" }
    ]
  },
  {
    header: "Signal health",
    items: [
      { to: "/intelligence/correlations", label: "Correlations & failure modes" },
      { to: "/intelligence/reliability", label: "Signal reliability" }
    ]
  },
  {
    header: "Governance",
    items: [{ to: "/intelligence/overrides", label: "Override analytics" }]
  },
  {
    header: "Calibration",
    items: [{ to: "/intelligence/simulator", label: "Threshold simulator" }]
  }
];

export const OVERVIEW_QUICK_LINKS = [
  {
    to: "/intelligence/alignment",
    title: "Production Alignment",
    desc: "Compare pre-release predictions to post-deploy outcomes."
  },
  {
    to: "/intelligence/vcs",
    title: "VCS Production Monitor",
    desc: "Live 2-hour windows on merged commits and incident signals."
  },
  {
    to: "/intelligence/correlations",
    title: "Signal Correlations",
    desc: "Discover which signal failures co-occur across releases."
  },
  {
    to: "/intelligence/overrides",
    title: "Override Analytics",
    desc: "Audit how often humans bypass certification gates."
  }
];
