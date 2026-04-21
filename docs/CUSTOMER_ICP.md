# Verdikt — target customer & anti-personas

**Purpose:** Single place for who we sell to, who we deprioritise, and language that came from discovery (so marketing, product, and waitlist stay aligned). Update this when interviews change your mind.

**Related implementation**

- Waitlist qualification fields live in `frontend/src/pages/RequestAccessPage.jsx` and `POST /api/waitlist-requests` (`backend/src/routes/index.js`). Stored in SQLite: `waitlist_requests.q_*` columns (see `backend/migrations/013_waitlist_qualification.sql`).

---

## Who Verdikt is for (primary ICP)

- **Roles:** Engineering leadership (VP/Director/Head of Eng), Quality/QE leadership, Platform/SRE/DevOps leadership — teams where **release risk is institutional**, not only individual speed.
- **Situation:** Multiple people touch a production release; **bad releases** hurt reputation, revenue, compliance, or engineering time; there is already some expectation of **record or audit** (even if messy today).
- **Job to be done:** Turn eval/monitoring signals into a **formal verdict** (certify / not / override) and a **durable record** — plus **prediction vs production** over time — without replacing their entire eval stack.

Funding stage is a **weak** filter on its own; **team shape + cost of failure + accountability need** matter more than “Series B+” alone.

---

## Who Verdikt is *not* for (anti-personas)

- **Solo founders / ship-at-all-costs** optimising only for **velocity**, with no second pair of eyes and no appetite for **named accountability** on overrides. (Example archetype: *Tom* — parallel branches, AI-heavy workflow, wants &lt;60s feedback and a Playwright-class silver bullet; **governance feels like pure drag**.)
- Buyers looking primarily for a **faster E2E runner** or **AI that “looks at the screen”** — that is **test execution / tooling**, not Verdikt’s core wedge (decision + record + loop).

**Policy:** Do not optimise the core product for anti-personas. Use discovery quotes from them; do not roadmap around their primary ask unless it clearly serves the ICP.

---

## Discovery insights to reuse (Tom-shaped, industry-wide)

These are **positioning and narrative**, not promises of a specific shipped detector unless the product does it end-to-end.

1. **AI testing paradox** — AI-generated tests for AI-generated code can **agree with the implementation** and still miss **business truth** (e.g. wrong contract with backend). Verdikt’s angle: sit **above** raw pass/fail to surface **risk and inconsistency**, not to replace the test author.
2. **Green-tick blindness** — CI passes the **journey** while logs/UI show errors nobody asserted on. Verdikt’s angle: **CI binary pass is insufficient**; combine **signals + record + post-ship alignment** so “green” is not confused with “safe.”
3. **Silver-bullet seekers** — Some buyers want **one agent to replace Playwright** in under a minute. Verdikt’s answer: **intelligence and governance on top of whatever they run**, not a generic replacement for every execution tool.

---

## Marketing lines (draft — validate with legal/comms)

- *“Your AI tests can pass because your AI wrote them. Verdikt evaluates release risk — not just test authorship.”*
- *“Green in CI isn’t the same as safe in production. Verdikt closes the loop between pre-release verdict and what actually happened.”*

Tie claims to **real product behaviour** before putting them on the public site.

---

## How to use this doc

| Audience | Use |
|----------|-----|
| **You / cofounders** | ICP + anti-persona before roadmap or fundraising story |
| **Waitlist / sales** | Route leads using `q_*` answers; skim SQLite or exports |
| **Cursor / AI** | Point agents at this file + `RequestAccessPage.jsx` for consistent copy |
| **Future hires** | Onboarding for “who we say no to” |

**Out of scope for this file:** detailed interview transcripts (put those in a private notes system); this file should stay **durable summaries** only.

---

## Changelog

| Date | Note |
|------|------|
| 2026-04 | Initial ICP + Tom discovery themes; linked to waitlist `q_*` qualification. |
