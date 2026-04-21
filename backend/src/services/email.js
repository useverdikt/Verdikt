"use strict";

/**
 * Transactional email for password reset via Resend (HTTPS API).
 * Set RESEND_API_KEY and PUBLIC_APP_URL (or FRONTEND_URL) for production.
 * @see https://resend.com/docs/api-reference/emails/send-email
 */

function publicAppBase() {
  const raw = (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || "").trim();
  return raw.replace(/\/$/, "");
}

function isPasswordResetEmailConfigured() {
  const key = (process.env.RESEND_API_KEY || "").trim();
  return Boolean(key && publicAppBase());
}

/**
 * @returns {Promise<{ ok: true } | { skipped: true, reason: string } | { ok: false, error: string }>}
 */
async function sendPasswordResetEmail({ to, resetToken }) {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const base = publicAppBase();
  if (!apiKey || !base) {
    return { skipped: true, reason: "missing_resend_or_public_url" };
  }
  const from =
    (process.env.EMAIL_FROM || "").trim() || "Verdikt <onboarding@resend.dev>";
  const resetUrl = `${base}/reset-password?token=${encodeURIComponent(resetToken)}`;
  const subject = "Reset your Verdikt password";
  const text = `We received a request to reset your password.\n\nOpen this link (valid about 1 hour):\n${resetUrl}\n\nIf you didn't ask for this, you can ignore this email.`;
  const html = `<p>We received a request to reset your Verdikt password.</p><p><a href="${resetUrl.replace(/"/g, "&quot;")}">Reset password</a></p><p style="color:#666;font-size:13px">If you didn't ask for this, you can ignore this email.</p>`;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15_000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        html
      }),
      signal: ac.signal
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg =
        typeof body.message === "string"
          ? body.message
          : typeof body.error === "string"
            ? body.error
            : `HTTP ${res.status}`;
      return { ok: false, error: errMsg };
    }
    return { ok: true };
  } catch (e) {
    const msg = e && e.name === "AbortError" ? "email send timeout" : String(e.message || e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Tells an existing account holder that a new registration attempt used their email (anti-enumeration flows).
 * @returns {Promise<{ ok: true } | { skipped: true } | { ok: false, error: string }>}
 */
async function sendAlreadyRegisteredEmail({ to }) {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const base = publicAppBase();
  if (!apiKey || !base) {
    return { skipped: true };
  }
  const from =
    (process.env.EMAIL_FROM || "").trim() || "Verdikt <onboarding@resend.dev>";
  const signInUrl = `${base}/login`;
  const subject = "Verdikt account";
  const text = `Someone tried to create a new Verdikt account with this email address.\n\nIf this was you and you already have an account, sign in here:\n${signInUrl}\n\nIf you did not request this, you can ignore this email.`;
  const html = `<p>Someone tried to create a new Verdikt account with this email address.</p><p><a href="${signInUrl.replace(/"/g, "&quot;")}">Sign in to your existing account</a></p><p style="color:#666;font-size:13px">If you did not request this, you can ignore this email.</p>`;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15_000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        html
      }),
      signal: ac.signal
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg =
        typeof body.message === "string"
          ? body.message
          : typeof body.error === "string"
            ? body.error
            : `HTTP ${res.status}`;
      return { ok: false, error: errMsg };
    }
    return { ok: true };
  } catch (e) {
    const msg = e && e.name === "AbortError" ? "email send timeout" : String(e.message || e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Notify an internal address when someone submits the public waitlist form.
 * Set WAITLIST_NOTIFY_EMAIL (e.g. your inbox) and RESEND_API_KEY (+ EMAIL_FROM).
 * @returns {Promise<{ ok: true } | { skipped: true, reason: string } | { ok: false, error: string }>}
 */
const WL_Q_ROLE = {
  engineering_leadership: "Engineering leadership (VP/Director/Head of Eng)",
  quality_qe: "Quality / QE / Test leadership",
  platform_sre: "Platform / SRE / DevOps leadership",
  ic_solo_other: "IC engineer / solo founder / other"
};
const WL_Q_TEAM = {
  just_me: "Just me",
  "2_5": "2–5",
  "6_20": "6–20",
  "21_plus": "21+"
};
const WL_Q_PROCESS = {
  informal: "Mostly informal (Slack, verbal, little written)",
  ticket_some: "Ticket/issue with some record",
  formal_audit: "Formal approval / change record / audit expectation"
};
const WL_Q_PAIN = {
  reputation: "Reputation / trust",
  revenue: "Revenue / customers",
  compliance: "Security / compliance / audit",
  eng_time: "Engineering time (incidents, firefighting)",
  other: "Other"
};

function formatWaitlistQualification(q) {
  if (!q || typeof q !== "object") return { text: "", html: "" };
  const lines = [];
  const rows = [];
  if (q.q_role) {
    const label = WL_Q_ROLE[q.q_role] || q.q_role;
    lines.push(`Role: ${label}`);
    rows.push(["Role", label]);
  }
  if (q.q_team_size) {
    const label = WL_Q_TEAM[q.q_team_size] || q.q_team_size;
    lines.push(`Team on release: ${label}`);
    rows.push(["Team on release", label]);
  }
  if (q.q_release_process) {
    const label = WL_Q_PROCESS[q.q_release_process] || q.q_release_process;
    lines.push(`Known issues today: ${label}`);
    rows.push(["When issues ship", label]);
  }
  if (Array.isArray(q.q_pain_points) && q.q_pain_points.length) {
    const pl = q.q_pain_points.map((p) => WL_Q_PAIN[p] || p).join("; ");
    lines.push(`What would hurt most: ${pl}`);
    rows.push(["Pain (top)", pl]);
  }
  if ((q.q_goal || "").trim()) {
    lines.push(`Goal: ${q.q_goal.trim()}`);
    rows.push(["One-sentence goal", q.q_goal.trim()]);
  }
  const text = lines.length ? `\nQualification:\n${lines.join("\n")}\n` : "";
  const html =
    rows.length > 0
      ? `<tr><td colspan="2" style="padding-top:12px;font-weight:600">Qualification</td></tr>${rows
          .map(
            ([k, v]) =>
              `<tr><td style="vertical-align:top;padding-right:12px;color:#666">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`
          )
          .join("")}`
      : "";
  return { text, html };
}

async function sendWaitlistLeadEmail({ notifyTo, name, email, company, message, qualification }) {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const to = (notifyTo || "").trim();
  if (!apiKey || !to) {
    return { skipped: true, reason: "missing_resend_or_waitlist_notify" };
  }
  const from =
    (process.env.EMAIL_FROM || "").trim() || "Verdikt <onboarding@resend.dev>";
  const subject = `Waitlist: ${company} — ${name}`;
  const { text: qualText, html: qualHtml } = formatWaitlistQualification(qualification);
  const msgBlock = (message || "").trim()
    ? `\nNotes:\n${message.trim()}\n`
    : "";
  const text = `New waitlist request\n\nName: ${name}\nEmail: ${email}\nCompany: ${company}\n${qualText}${msgBlock}`;
  const html = `<p><strong>New waitlist request</strong></p>
<table style="font-size:14px;line-height:1.5">
<tr><td>Name</td><td>${escapeHtml(name)}</td></tr>
<tr><td>Email</td><td><a href="mailto:${encodeURIComponent(email)}">${escapeHtml(email)}</a></td></tr>
<tr><td>Company</td><td>${escapeHtml(company)}</td></tr>
${qualHtml}
</table>
${(message || "").trim() ? `<p style="margin-top:12px"><strong>Notes</strong></p><pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(message.trim())}</pre>` : ""}`;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15_000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        html
      }),
      signal: ac.signal
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg =
        typeof body.message === "string"
          ? body.message
          : typeof body.error === "string"
            ? body.error
            : `HTTP ${res.status}`;
      return { ok: false, error: errMsg };
    }
    return { ok: true };
  } catch (e) {
    const msg = e && e.name === "AbortError" ? "email send timeout" : String(e.message || e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(t);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = {
  isPasswordResetEmailConfigured,
  sendPasswordResetEmail,
  sendAlreadyRegisteredEmail,
  sendWaitlistLeadEmail
};
