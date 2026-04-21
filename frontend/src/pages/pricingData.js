/**
 * Marketing copy for /pricing (ported from verdikt-pricing.html).
 */

export const PLANS = [
  {
    id: "starter",
    tier: "Starter",
    tierColor: "#6b7280",
    name: "Starter",
    desc: "One team. One product. Prove the value before you scale.",
    monthlyPrice: 0,
    annualPrice: 0,
    priceSuffix: "per workspace / month",
    billedNote: "Free forever",
    ctaLabel: "Join waitlist",
    ctaVariant: "outline",
    ctaTo: "/request-access",
    featured: false,
    features: [
      {
        group: "Workspaces & projects",
        items: [
          { label: "1 workspace", included: true },
          { label: "Up to 3 projects", included: true },
          { label: "Unlimited team members", included: true },
          { label: "Unlimited releases", included: true }
        ]
      },
      {
        group: "Certification engine",
        items: [
          { label: "CERTIFIED / UNCERTIFIED verdict", included: true },
          { label: "CERTIFIED WITH OVERRIDE", included: true },
          { label: "Unlimited overrides", included: true },
          { label: "4 signal categories", included: true },
          { label: "Custom signal thresholds", included: true },
          { label: "Hard gate enforcement", included: true }
        ]
      },
      {
        group: "Integrations",
        items: [
          { label: "Braintrust, LangSmith (AI eval)", included: true },
          { label: "Sentry, Datadog, BrowserStack", included: true },
          { label: "CSV upload", included: true },
          { label: "Manual entry", included: true },
          { label: "Slack notifications", included: false }
        ]
      },
      {
        group: "Records & audit",
        items: [
          { label: "Public certification records", included: true },
          { label: "Audit trail", included: true, note: "90 days" },
          { label: "Embeddable badge", included: true },
          { label: "Audit trail export", included: false }
        ]
      }
    ]
  },
  {
    id: "team",
    tier: "Team",
    tierColor: "#22c55e",
    name: "Team",
    desc: "The full product. Built for teams shipping AI now, with governance that scales as AI becomes core to every product.",
    monthlyPrice: 149,
    annualPrice: 119,
    priceSuffix: "per workspace / month",
    billedNote: null,
    ctaLabel: "Join waitlist",
    ctaVariant: "primary",
    ctaTo: "/request-access",
    featured: true,
    features: [
      {
        group: "Workspaces & projects",
        items: [
          { label: "Unlimited workspaces", included: true },
          { label: "Unlimited projects", included: true },
          { label: "Unlimited team members", included: true },
          { label: "Unlimited releases", included: true }
        ]
      },
      {
        group: "Certification engine",
        items: [
          { label: "All certification states", included: true },
          { label: "Unlimited overrides", included: true },
          { label: "4 signal categories + custom", included: true },
          { label: "Custom signal thresholds", included: true },
          { label: "Override governance config", included: true },
          { label: "Regression waiver logic", included: true }
        ]
      },
      {
        group: "Integrations",
        items: [
          { label: "Braintrust, LangSmith (AI eval)", included: true },
          { label: "Sentry, Datadog, BrowserStack", included: true },
          { label: "CSV upload + manual entry", included: true },
          { label: "Slack notifications", included: true },
          { label: "Email notifications", included: true },
          { label: "Custom eval source connectors", included: true }
        ]
      },
      {
        group: "Records & audit",
        items: [
          { label: "Public certification records", included: true },
          { label: "Audit trail", included: true, note: "Unlimited" },
          { label: "Embeddable badge", included: true },
          { label: "Audit trail export (JSON)", included: true },
          { label: "Weekly quality digest", included: true }
        ]
      }
    ]
  },
  {
    id: "enterprise",
    tier: "Enterprise",
    tierColor: "#f59e0b",
    name: "Enterprise",
    desc: "For AI product organisations with compliance requirements, security standards, and scale. Your AI governance is auditable and defensible.",
    monthlyPrice: null,
    annualPrice: null,
    ctaLabel: "Talk to us",
    ctaVariant: "contact",
    ctaHref: "mailto:hello@useverdikt.com",
    featured: false,
    features: [
      {
        group: "Everything in Team, plus",
        items: [
          { label: "SAML / SSO", included: true },
          { label: "Custom data retention policy", included: true },
          { label: "Private certification records", included: true },
          { label: "Audit log export API", included: true }
        ]
      },
      {
        group: "Support & SLA",
        items: [
          { label: "Dedicated support engineer", included: true },
          { label: "99.9% uptime SLA", included: true },
          { label: "Custom onboarding", included: true }
        ]
      },
      {
        group: "Custom integrations",
        items: [
          { label: "Custom signal source connectors", included: true },
          { label: "Custom notification destinations", included: true },
          { label: "API rate limit increase", included: true },
          { label: "Custom contract & billing", included: true }
        ]
      }
    ]
  }
];

export const COMPARISON_ROWS = [
  { section: "Core" },
  { label: "Workspaces", starter: "1", team: "Unlimited", enterprise: "Unlimited" },
  { label: "Projects", starter: "3", team: "Unlimited", enterprise: "Unlimited" },
  { label: "Team members", starter: "Unlimited", team: "Unlimited", enterprise: "Unlimited" },
  { label: "Releases evaluated", starter: "Unlimited", team: "Unlimited", enterprise: "Unlimited" },
  { section: "Certification" },
  { label: "Certification states", starter: true, team: true, enterprise: true },
  { label: "Overrides", starter: "Unlimited", team: "Unlimited", enterprise: "Unlimited" },
  { label: "Override governance", starter: false, team: true, enterprise: true },
  { label: "Custom signal thresholds", starter: true, team: true, enterprise: true },
  { label: "Custom signal sources", starter: false, team: false, enterprise: true },
  { section: "Integrations" },
  {
    label: "Braintrust / LangSmith / Sentry / Datadog",
    starter: true,
    team: true,
    enterprise: true
  },
  { label: "Custom connectors", starter: false, team: false, enterprise: true },
  { label: "Slack notifications", starter: false, team: true, enterprise: true },
  { section: "Records & audit" },
  { label: "Public cert. records", starter: true, team: true, enterprise: "Private option" },
  { label: "Audit trail", starter: "90 days", team: "Unlimited", enterprise: "Custom" },
  { label: "Audit trail export", starter: false, team: "JSON", enterprise: "JSON + API" },
  { label: "Weekly digest", starter: false, team: true, enterprise: true },
  { section: "Security & compliance" },
  { label: "SSO / SAML", starter: false, team: false, enterprise: true },
  { label: "Custom data retention", starter: false, team: false, enterprise: true },
  { label: "SLA", starter: false, team: false, enterprise: "99.9%" }
];

/** Plain text with optional **bold** segments (rendered safely — no HTML). */
export const FAQS = [
  {
    q: "Why is pricing per workspace rather than per seat?",
    aText:
      "The value Verdikt delivers is institutional — the certification record, the audit trail, the governance chain. That accrues at the team level, not the individual level. Seat-based pricing creates friction for exactly the behaviour we want to encourage: adding the VP Engineering or CTO as read-only members so they can see the certification state before a release ships. Every person who can see the record makes the governance stronger. We don't want to penalise that."
  },
  {
    q: "What counts as a workspace?",
    aText:
      "A workspace corresponds to a team. One AI product team working on one or more AI features is one workspace. If you have multiple independent teams — say, an AI product team and a core platform team — each would be a separate workspace. Projects within a workspace share threshold configuration (including AI eval), team members, and billing."
  },
  {
    q: "What happens to our certification records if we downgrade or cancel?",
    aText:
      "**Certification records and audit trail entries are never deleted when you downgrade or cancel.** You will always be able to export your full history. The permanence of the record is fundamental to what Verdikt is — we'd be undermining the entire product if we held records hostage to a billing relationship."
  },
  {
    q: "Can I trial Team before committing?",
    aText:
      "Yes. Team comes with a 14-day free trial, no credit card required. You'll have access to the full product including Slack notifications, unlimited audit trail, and override governance configuration. At the end of the trial you can choose to subscribe or continue on Starter."
  },
  {
    q: "Why are overrides unlimited on every plan?",
    aText:
      "The value of an override is the permanent record it creates — who approved it, what they wrote as justification, when they signed off. Limiting overrides would incentivise teams to find ways around the governance rather than through it. The override record is the accountability mechanism. That needs to be unconditional."
  },
  {
    q: "Do you offer discounts for early-stage companies or open source?",
    aText:
      "Yes. If you're a seed-stage company or an open source project maintaining a public release record, get in touch at **hello@useverdikt.com**. We'd rather have you using Verdikt and building the habit than watching pricing be the blocker."
  },
  {
    q: "When should we consider Enterprise?",
    aText:
      "Move to Enterprise when you need SSO, private certification records, custom retention, and custom integrations. Most teams start on Starter/Team, then upgrade when procurement or compliance requirements appear."
  }
];
