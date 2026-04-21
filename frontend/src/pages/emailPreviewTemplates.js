/**
 * Email template helpers.
 *
 * Design decisions:
 *  - Header: dark navy #060810 brand strip, Verdict Instrument SVG mark (see verdiktMarkSvg.js), accent border.
 *  - Body: white background (email client compatibility).
 *  - Typography: Georgia/Times serif for headings + body (email-safe serif);
 *    'Courier New' for mono labels (email-safe monospace).
 *  - Body text: navy-tinted #1e3a52 / #2d4a6a instead of pure grey — reads warmer.
 *  - Primary CTA: dark navy #060810 + light text #c4d4e8 (matches landing page CTA language).
 *  - Links: #22c55e (brand green) for all actionable URLs.
 *  - Footer: slightly tinted #f2f5f8 background to lift off white body.
 */

import { verdiktMarkSvgString } from "../brand/verdiktMarkSvg.js";

/* ─── Shared building blocks ─────────────────────────────────────────────── */

export function emailHeader(accentColor) {
  const mark = verdiktMarkSvgString(28, "onDark");
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#060810;border-bottom:3px solid ${accentColor}">
      <tr><td style="padding:18px 32px">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle;line-height:0">${mark}</td>
          <td style="padding-left:10px;vertical-align:middle">
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;font-weight:600;color:#c4d4e8;letter-spacing:0.02em">Verdikt</div>
          </td>
        </tr></table>
      </td></tr>
    </table>`;
}

export function emailFooter() {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5f8;border-top:1px solid #d8e4ee">
      <tr><td style="padding:20px 32px">
        <p style="font-family:'Courier New',monospace;font-size:10px;color:#7a8fa3;line-height:1.7;margin:0 0 6px">
          Verdikt &middot; Release Intelligence System &middot; <a href="/" style="color:#22c55e;text-decoration:none">useverdikt.com</a>
        </p>
        <p style="font-family:'Courier New',monospace;font-size:10px;color:#7a8fa3;line-height:1.7;margin:0">
          You're receiving this because you're a member of <strong style="color:#4e6b84">Verdikt &middot; Discover AI</strong>.
          <a href="/settings" style="color:#7a8fa3;text-decoration:underline">Manage notifications</a> &middot; <a href="#" style="color:#7a8fa3;text-decoration:underline">Unsubscribe</a>
        </p>
      </td></tr>
    </table>`;
}

/* ─── Shared body styles (inline string helpers) ─────────────────────────── */
const B = {
  // Text colours (on white background, navy-tinted)
  heading:  '#0f2135',
  body:     '#2d4a6a',
  muted:    '#6e87a2',
  label:    '#4e6b84',
  // State colours
  green:    '#16a34a',
  amber:    '#d97706',
  red:      '#dc2626',
  blue:     '#2563eb',
  // Surface colours (light for email body)
  surface:  '#f8fafc',
  surfaceB: '#e8f0f7',
  // Semantic tints
  amberBg:  '#fffbeb',
  amberBd:  '#fde68a',
  greenBg:  '#f0fdf4',
  greenBd:  '#bbf7d0',
  redBg:    '#fef2f2',
  redBd:    '#fecaca',
  blueBg:   '#eff6ff',
  blueBd:   '#bfdbfe',
};

function metaRow(label, value, valueColor) {
  return `
    <tr>
      <td style="font-family:'Courier New',monospace;font-size:11px;color:${B.muted};padding:4px 0">${label}</td>
      <td style="font-family:'Courier New',monospace;font-size:11px;color:${valueColor || B.heading};text-align:right;padding:4px 0">${value}</td>
    </tr>`;
}

function sectionLabel(text, color) {
  return `<div style="font-family:'Courier New',monospace;font-size:10px;color:${color};font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:10px">${text}</div>`;
}

function ctaButton(href, label, bg, textColor) {
  return `<a href="${href}" style="display:inline-block;background:${bg};color:${textColor};padding:12px 26px;border-radius:7px;font-family:'Courier New',monospace;font-size:12px;font-weight:700;letter-spacing:0.08em;text-decoration:none">${label}</a>`;
}

function subjectBanner(eyebrow, eyebrowColor, title, meta, bgColor, bdColor) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${bgColor};border-bottom:1px solid ${bdColor}">
      <tr><td style="padding:22px 32px">
        <div style="font-family:'Courier New',monospace;font-size:10px;color:${eyebrowColor};letter-spacing:0.16em;text-transform:uppercase;margin-bottom:7px">${eyebrow}</div>
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;color:${B.heading};letter-spacing:-0.01em;line-height:1.15;font-weight:normal">${title}</div>
        <div style="font-family:'Courier New',monospace;font-size:12px;color:${B.muted};margin-top:9px">${meta}</div>
      </td></tr>
    </table>`;
}

/* ─── workspace slug helper ──────────────────────────────────────────────── */
function workspaceSlug() {
  if (typeof window === "undefined") return "verdikt";
  const slug = String(localStorage.getItem("vdk3_workspace_slug") || "verdikt").trim().toLowerCase();
  return slug || "verdikt";
}

/* ─── Email preview catalogue ────────────────────────────────────────────── */

export const EMAIL_PREVIEWS = [

  /* 1 ── Override approval request ──────────────────────────────────────── */
  {
    id: 'override-request',
    label: 'Override approval request',
    desc: 'To VP Engineering / CTO',
    dot: '#f59e0b',
    to: 'alex.baird@useverdikt.com',
    from: 'verdikt@useverdikt.com',
    subject: '[Action required] Override approval requested — v2.12.0 · Discover AI',
    body: () => {
      const recordUrl = `/cert/${workspaceSlug()}/v2.12.0`;
      return `
      ${emailHeader("#f59e0b")}
      ${subjectBanner(
        'Action required',
        B.amber,
        'Override approval requested',
        'v2.12.0 &middot; Discover AI &middot; Model / Prompt Update',
        B.amberBg, B.amberBd
      )}
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff">
        <tr><td style="padding:28px 32px">
          <p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:${B.body};line-height:1.75;margin-bottom:24px">
            Hi Marcus,<br/><br/>
            <strong style="color:${B.heading}">Jordan Blake</strong> has submitted an override request for release <strong style="color:${B.heading}">v2.12.0</strong>. Two signals are below threshold. Your sign-off is required before this release can ship.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:${B.amberBg};border:1px solid ${B.amberBd};border-radius:8px;margin-bottom:24px">
            <tr><td style="padding:16px 20px">
              ${sectionLabel('Signals below threshold', B.amber)}
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family:'Courier New',monospace;font-size:12px;color:${B.heading};padding:5px 0;font-weight:600">accuracy</td>
                  <td style="font-family:'Courier New',monospace;font-size:12px;color:${B.red};text-align:right;padding:5px 0">79% <span style="color:${B.muted}">vs &ge;85% threshold</span></td>
                </tr>
                <tr>
                  <td style="font-family:'Courier New',monospace;font-size:12px;color:${B.heading};padding:5px 0;font-weight:600">relevance</td>
                  <td style="font-family:'Courier New',monospace;font-size:12px;color:${B.red};text-align:right;padding:5px 0">74% <span style="color:${B.muted}">vs &ge;82% threshold</span></td>
                </tr>
              </table>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:${B.surface};border:1px solid ${B.surfaceB};border-radius:8px;margin-bottom:24px">
            <tr><td style="padding:16px 20px">
              <div style="font-family:'Courier New',monospace;font-size:10px;color:${B.muted};letter-spacing:0.1em;margin-bottom:10px;text-transform:uppercase">Justification &middot; Jordan Blake &middot; AI Product Lead</div>
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:14px;color:${B.body};line-height:1.75;font-style:italic">&ldquo;Accuracy regression isolated to edge case in legacy profile format. Affects &lt;0.3% of users. Model patch scheduled within 48 hrs. Risk accepted at AI Product Lead level &mdash; requesting VP sign-off per governance policy.&rdquo;</div>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:${B.surface};border:1px solid ${B.surfaceB};border-radius:8px;margin-bottom:28px">
            <tr><td style="padding:14px 20px">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${metaRow('Release type',    'Model / Prompt Update')}
                ${metaRow('Submitted by',    'Jordan Blake, AI Product Lead')}
                ${metaRow('Submitted',       '2026-01-31 16:42 UTC')}
                ${metaRow('E2E regression',  'Waived (model-only change)', B.amber)}
              </table>
            </td></tr>
          </table>

          <p style="font-family:Georgia,'Times New Roman',serif;font-size:14px;color:${B.muted};line-height:1.75;margin-bottom:24px">
            By approving, your name and title will be permanently recorded as the override owner on the public certification record. This decision cannot be edited or deleted.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
            <tr>
              <td style="padding-right:8px">
                ${ctaButton(recordUrl, 'APPROVE OVERRIDE', '#f59e0b', '#ffffff')}
              </td>
              <td>
                <a href="#" style="display:inline-block;background:#ffffff;color:${B.muted};padding:12px 24px;border-radius:7px;font-family:'Courier New',monospace;font-size:12px;font-weight:600;letter-spacing:0.06em;text-decoration:none;border:1px solid ${B.surfaceB}">Decline</a>
              </td>
            </tr>
          </table>

          <p style="font-family:'Courier New',monospace;font-size:11px;color:${B.muted};line-height:1.6">
            Or review the full record: <a href="${recordUrl}" style="color:#22c55e;text-decoration:none">useverdikt.com${recordUrl}</a>
          </p>
        </td></tr>
      </table>
      ${emailFooter()}`;
    }
  },

  /* 2 ── Override approved ────────────────────────────────────────────────── */
  {
    id: 'override-approved',
    label: 'Override approved',
    desc: 'To submitter (AI Product Lead)',
    dot: '#f59e0b',
    to: 'jordan.blake@useverdikt.com',
    from: 'verdikt@useverdikt.com',
    subject: 'Override approved — v2.12.0 · Discover AI · CERTIFIED WITH OVERRIDE',
    body: () => `
      ${emailHeader('#f59e0b')}
      ${subjectBanner(
        'Override approved',
        B.amber,
        'v2.12.0 is <em>certified with override.</em>',
        'Discover AI &middot; Model / Prompt Update &middot; 2026-01-31 16:55 UTC',
        B.amberBg, B.amberBd
      )}
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff">
        <tr><td style="padding:28px 32px">
          <p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:${B.body};line-height:1.75;margin-bottom:24px">
            Hi Sarah,<br/><br/>
            Alex Baird has approved your override request. Release <strong style="color:${B.heading}">v2.12.0</strong> is now <strong style="color:${B.amber}">CERTIFIED WITH OVERRIDE</strong> and cleared to ship.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:${B.amberBg};border:1px solid ${B.amberBd};border-radius:8px;margin-bottom:24px">
            <tr><td style="padding:16px 20px">
              ${sectionLabel('Override record &mdash; permanent', B.amber)}
              <table width="100%" cellpadding="0" cellspacing="0">
                ${metaRow('Override owner',         'Alex Baird, VP Engineering')}
                ${metaRow('Approved',               '2026-01-31 16:55 UTC')}
                ${metaRow('Signals below threshold','accuracy 79%, relevance 74%', B.red)}
              </table>
            </td></tr>
          </table>

          <p style="font-family:Georgia,'Times New Roman',serif;font-size:14px;color:${B.muted};line-height:1.75;margin-bottom:24px">
            This override is permanently on record and cannot be edited or deleted. The certification record is publicly accessible at the link below.
          </p>

          ${ctaButton(`/cert/${workspaceSlug()}/v2.12.0`, 'VIEW CERTIFICATION RECORD →', '#060810', '#c4d4e8')}
        </td></tr>
      </table>
      ${emailFooter()}`
  },

  /* 3 ── UNCERTIFIED shipped ──────────────────────────────────────────────── */
  {
    id: 'uncertified-shipped',
    label: 'UNCERTIFIED release shipped',
    desc: 'Alert to team / admins',
    dot: '#ef4444',
    to: 'team@useverdikt.com',
    from: 'verdikt@useverdikt.com',
    subject: '[Alert] UNCERTIFIED release shipped — v2.10.0 · Discover AI',
    body: () => `
      ${emailHeader('#ef4444')}
      ${subjectBanner(
        'Alert &mdash; uncertified release shipped',
        B.red,
        'v2.10.0 shipped <em>below threshold.</em>',
        'Discover AI &middot; Prompt / UX Update &middot; 2026-01-03 10:15 UTC',
        B.redBg, B.redBd
      )}
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff">
        <tr><td style="padding:28px 32px">
          <p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:${B.body};line-height:1.75;margin-bottom:24px">
            Release <strong style="color:${B.heading}">v2.10.0</strong> was shipped while marked <strong style="color:${B.red}">UNCERTIFIED</strong>. No override was submitted. <strong style="color:${B.heading}">This release is on record as uncertified.</strong>
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:${B.redBg};border:1px solid ${B.redBd};border-radius:8px;margin-bottom:24px">
            <tr><td style="padding:16px 20px">
              ${sectionLabel('Failing signals at ship time', B.red)}
              <table width="100%" cellpadding="0" cellspacing="0">
                ${[
                  ['Smoke tests',    'FAIL',   'PASS required',    '&#8862; HARD GATE'],
                  ['E2E regression', 'FAIL',   'PASS required',    ''],
                  ['Cold startup',   '4.2s',   '&le;3.0s threshold', ''],
                  ['Crash rate',     '0.18%',  '&le;0.1% threshold', ''],
                  ['accuracy',       '71%',    '&ge;85% threshold',  ''],
                ].map(([name,val,thresh,tag]) => `
                  <tr>
                    <td style="font-family:'Courier New',monospace;font-size:12px;color:${B.heading};padding:5px 0;font-weight:600">${name}${tag ? ` <span style="font-size:9px;background:${B.redBd};color:${B.red};padding:1px 5px;border-radius:3px;font-weight:700">${tag}</span>` : ''}</td>
                    <td style="font-family:'Courier New',monospace;font-size:12px;color:${B.red};text-align:right;padding:5px 0">${val} <span style="color:${B.muted}">vs ${thresh}</span></td>
                  </tr>`).join('')}
              </table>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:${B.surface};border:1px solid ${B.surfaceB};border-radius:8px;margin-bottom:24px">
            <tr><td style="padding:14px 20px">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${metaRow('Shipped by',          'Tom Hale, Engineer')}
                ${metaRow('Override submitted',   'No',          B.red)}
                ${metaRow('Certification state',  'UNCERTIFIED &mdash; on permanent record', B.red)}
              </table>
            </td></tr>
          </table>

          <p style="font-family:Georgia,'Times New Roman',serif;font-size:14px;color:${B.body};line-height:1.75;margin-bottom:24px">
            No action is required to unship &mdash; this is an alert. The certification record for v2.10.0 is permanent. If a retrospective override is needed, it can be submitted from the dashboard and will be recorded with the current timestamp.
          </p>

          ${ctaButton(`/cert/${workspaceSlug()}/v2.10.0`, 'VIEW CERTIFICATION RECORD →', '#060810', '#c4d4e8')}
        </td></tr>
      </table>
      ${emailFooter()}`
  },

  /* 4 ── Certified ────────────────────────────────────────────────────────── */
  {
    id: 'certified',
    label: 'Release certified',
    desc: 'To AI Product Lead / team',
    dot: '#22c55e',
    to: 'jordan.blake@useverdikt.com',
    from: 'verdikt@useverdikt.com',
    subject: 'v2.14.0 certified — Discover AI · All thresholds met',
    body: () => `
      ${emailHeader('#22c55e')}
      ${subjectBanner(
        'Certified',
        B.green,
        'v2.14.0 is <em>certified.</em>',
        'Discover AI &middot; Prompt / UX Update &middot; 2026-02-28 09:14 UTC',
        B.greenBg, B.greenBd
      )}
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff">
        <tr><td style="padding:28px 32px">
          <p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:${B.body};line-height:1.75;margin-bottom:24px">
            Hi Sarah,<br/><br/>
            All 19 signals &mdash; including AI eval (accuracy, safety, tone, hallucination, relevance) &mdash; passed against your defined thresholds. Release <strong style="color:${B.heading}">v2.14.0</strong> is <strong style="color:${B.green}">CERTIFIED</strong> and cleared to ship.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:${B.greenBg};border:1px solid ${B.greenBd};border-radius:8px;margin-bottom:24px">
            <tr><td style="padding:16px 20px">
              ${sectionLabel('All signals passing', B.green)}
              <table width="100%" cellpadding="0" cellspacing="0">
                ${[
                  ['Delivery Reliability Checks', 'Smoke ✓ &middot; E2E regression ✓'],
                  ['Delivery Performance',        'Startup 2.4s &middot; FPS 61 &middot; p95 218ms'],
                  ['Delivery Reliability',        'Crash 0.08% &middot; ANR 0.03% &middot; OOM 0.1%'],
                  ['AI Eval Quality',             'Accuracy 91% &middot; Safety 94% &middot; Relevance 85%'],
                ].map(([cat,detail]) => `
                  <tr>
                    <td style="font-family:'Courier New',monospace;font-size:11px;color:${B.green};padding:5px 0;font-weight:600;white-space:nowrap;padding-right:16px">${cat}</td>
                    <td style="font-family:'Courier New',monospace;font-size:11px;color:${B.body};padding:5px 0">${detail}</td>
                  </tr>`).join('')}
              </table>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:${B.surface};border:1px solid ${B.surfaceB};border-radius:8px;margin-bottom:28px">
            <tr><td style="padding:14px 20px">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${metaRow('Certified by',      'Jordan Blake, AI Product Lead')}
                ${metaRow('Signals evaluated', '19 of 19 passed', B.green)}
                ${metaRow('Override required', 'No', B.green)}
              </table>
            </td></tr>
          </table>

          ${ctaButton(`/cert/${workspaceSlug()}/v2.14.0`, 'VIEW CERTIFICATION RECORD →', '#060810', '#c4d4e8')}
        </td></tr>
      </table>
      ${emailFooter()}`
  },

  /* 5 ── Weekly quality digest ────────────────────────────────────────────── */
  {
    id: 'weekly-digest',
    label: 'Weekly quality digest',
    desc: 'To admins / leadership',
    dot: '#3b82f6',
    to: 'alex.baird@useverdikt.com',
    from: 'verdikt@useverdikt.com',
    subject: 'Weekly quality digest — Discover AI · w/c 24 Feb 2026',
    body: () => `
      ${emailHeader('#3b82f6')}
      ${subjectBanner(
        'Weekly quality digest',
        B.blue,
        'Discover AI &middot; w/c 24 Feb 2026',
        '4 releases evaluated &middot; 3 certified &middot; 1 certified with override &middot; 0 uncertified',
        B.blueBg, B.blueBd
      )}
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff">
        <tr><td style="padding:28px 32px">

          <table width="100%" cellpadding="0" cellspacing="0" style="background:${B.surface};border:1px solid ${B.surfaceB};border-radius:8px;margin-bottom:24px">
            <tr style="background:#edf2f7">
              <td style="font-family:'Courier New',monospace;font-size:10px;color:${B.muted};padding:10px 14px;font-weight:700;letter-spacing:0.08em">RELEASE</td>
              <td style="font-family:'Courier New',monospace;font-size:10px;color:${B.muted};padding:10px 14px;font-weight:700;letter-spacing:0.08em">TYPE</td>
              <td style="font-family:'Courier New',monospace;font-size:10px;color:${B.muted};padding:10px 14px;font-weight:700;letter-spacing:0.08em;text-align:right">STATUS</td>
            </tr>
            ${[
              ['v2.14.0', 'Prompt / UX Update',   'CERTIFIED',         B.green],
              ['v2.13.2', 'Model Patch',           'CERTIFIED',         B.green],
              ['v2.13.1', 'Safety Hotfix',         'CERTIFIED',         B.green],
              ['v2.12.0', 'Model Update',          'CERT. W/ OVERRIDE', B.amber],
            ].map(([v,t,s,c],i) => `
              <tr style="background:${i%2===0?'#ffffff':B.surface}">
                <td style="font-family:'Courier New',monospace;font-size:12px;color:${B.heading};padding:10px 14px;font-weight:600">${v}</td>
                <td style="font-family:'Courier New',monospace;font-size:11px;color:${B.muted};padding:10px 14px">${t}</td>
                <td style="font-family:'Courier New',monospace;font-size:11px;color:${c};padding:10px 14px;text-align:right;font-weight:600">${s}</td>
              </tr>`).join('')}
          </table>

          <div style="font-family:'Courier New',monospace;font-size:10px;color:${B.muted};letter-spacing:0.12em;text-transform:uppercase;margin-bottom:14px;margin-top:24px">Signal category summary</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
            ${[
              ['Delivery Reliability Checks', '4/4 releases passed', B.green, '100%'],
              ['Delivery Performance',        '4/4 releases passed', B.green, '100%'],
              ['Delivery Reliability',        '4/4 releases passed', B.green, '100%'],
              ['AI Eval Quality',             '3/4 releases passed &mdash; 1 override on record', B.amber, '75%'],
            ].map(([cat,detail,c,w]) => `
              <tr>
                <td style="padding:6px 0;vertical-align:top">
                  <table cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                      <td style="font-family:'Courier New',monospace;font-size:12px;color:${B.heading};font-weight:600;padding-right:12px;white-space:nowrap;vertical-align:middle">${cat}</td>
                      <td width="100%" style="padding-top:2px;vertical-align:middle">
                        <div style="height:4px;background:${B.surfaceB};border-radius:2px;overflow:hidden">
                          <div style="height:100%;background:${c};border-radius:2px;width:${w}"></div>
                        </div>
                      </td>
                      <td style="font-family:'Courier New',monospace;font-size:11px;color:${c};padding-left:12px;white-space:nowrap;vertical-align:middle">${detail}</td>
                    </tr>
                  </table>
                </td>
              </tr>`).join('')}
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:${B.amberBg};border:1px solid ${B.amberBd};border-radius:8px;margin-bottom:16px">
            <tr><td style="padding:14px 18px">
              <div style="font-family:'Courier New',monospace;font-size:10px;color:${B.amber};font-weight:700;letter-spacing:0.1em;margin-bottom:8px">OVERRIDE THIS WEEK</div>
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:13px;color:${B.body};line-height:1.7">v2.12.0 shipped with accuracy at 79% (threshold &ge;85%) and relevance at 74% (threshold &ge;82%). Override approved by Alex Baird, VP Engineering. Model patch v2.12.1 planned within 48 hrs.</div>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:${B.blueBg};border:1px solid ${B.blueBd};border-radius:8px;margin-bottom:28px">
            <tr><td style="padding:14px 18px">
              <div style="font-family:'Courier New',monospace;font-size:10px;color:${B.blue};font-weight:700;letter-spacing:0.1em;margin-bottom:8px">TREND NOTE</div>
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:13px;color:${B.body};line-height:1.7">AI Eval Quality has been the only category with failures in the last 4 weeks. Accuracy and Relevance are the recurring signals. Consider reviewing the threshold or the model eval pipeline coverage.</div>
            </td></tr>
          </table>

          ${ctaButton('#', 'VIEW FULL TREND REPORT →', '#060810', '#c4d4e8')}
        </td></tr>
      </table>
      ${emailFooter()}`
  },

  /* 6 ── Workspace invite ─────────────────────────────────────────────────── */
  {
    id: 'invite',
    label: 'Workspace invite',
    desc: 'To new team member',
    dot: '#22d3ee',
    to: 'aisha.patel@useverdikt.com',
    from: 'jordan.blake@useverdikt.com',
    subject: "You've been invited to Verdikt — Verdikt · Discover AI",
    body: () => `
      ${emailHeader('#22d3ee')}
      ${subjectBanner(
        'Workspace invite',
        '#0e7490',
        "You've been invited to <em>Verdikt.</em>",
        'Verdikt &middot; Discover AI &middot; Role: AI Product Lead',
        '#ecfeff', '#a5f3fc'
      )}
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff">
        <tr><td style="padding:28px 32px">
          <p style="font-family:Georgia,'Times New Roman',serif;font-size:15px;color:${B.body};line-height:1.75;margin-bottom:24px">
            Hi Aisha,<br/><br/>
            <strong style="color:${B.heading}">Jordan Blake</strong> has invited you to join the <strong style="color:${B.heading}">Verdikt &middot; Discover AI</strong> workspace as <strong style="color:${B.heading}">AI Product Lead</strong>.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:${B.surface};border:1px solid ${B.surfaceB};border-radius:8px;margin-bottom:24px">
            <tr><td style="padding:18px 20px">
              <div style="font-family:'Courier New',monospace;font-size:10px;color:${B.muted};letter-spacing:0.1em;margin-bottom:12px;text-transform:uppercase">What is Verdikt?</div>
              <p style="font-family:Georgia,'Times New Roman',serif;font-size:14px;color:${B.body};line-height:1.75;margin-bottom:12px">
                Verdikt is a release intelligence system. Every model update, prompt change, and AI feature is evaluated against defined quality thresholds and receives a certification state: <strong style="color:${B.green}">CERTIFIED</strong>, <strong style="color:${B.red}">UNCERTIFIED</strong>, or <strong style="color:${B.amber}">CERTIFIED WITH OVERRIDE</strong>.
              </p>
              <p style="font-family:Georgia,'Times New Roman',serif;font-size:14px;color:${B.body};line-height:1.75;margin:0">
                As AI Product Lead, you define the thresholds, own the certification verdict, and sign off on every AI release that clears the bar. Every below-threshold ship requires a named override &mdash; on permanent record.
              </p>
            </td></tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:${B.surface};border:1px solid ${B.surfaceB};border-radius:8px;margin-bottom:28px">
            <tr><td style="padding:14px 20px">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${metaRow('Invited by', 'Jordan Blake, AI Product Lead')}
                ${metaRow('Workspace',  'Verdikt &middot; Discover AI')}
                ${metaRow('Your role',  'AI Product Lead', '#0e7490')}
                ${metaRow('Invite expires', '7 days')}
              </table>
            </td></tr>
          </table>

          ${ctaButton('#', 'ACCEPT INVITE →', '#060810', '#c4d4e8')}
        </td></tr>
      </table>
      ${emailFooter()}`
  },
];
