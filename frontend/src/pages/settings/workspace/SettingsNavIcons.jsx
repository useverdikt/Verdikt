import React from "react";

/** Sidebar nav icons — paths match `verdikt-settings.html` (Email uses matching 14×14 stroke style). */
export const SettingsNavIcons = {
  general: (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.1" />
      <rect x="8.5" y="1.5" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.1" />
      <rect x="1.5" y="8.5" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.1" />
      <rect x="8.5" y="8.5" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  ),
  team: (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="5" cy="4" r="2.2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M1 11c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="11" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.1" />
      <path d="M10 11c0-1.1.45-2.1 1.18-2.82" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  ),
  thresholds: (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.1" />
      <path d="M7 4v3l2 1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  api: (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 4h10M2 10h10M5 1l-2 12M9 1l-2 12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  ),
  trigger: (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M7 1L8.8 5.5H13.5L9.6 8.3L11 13L7 10.5L3 13L4.4 8.3L.5 5.5H5.2L7 1Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  ),
  notifications: (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M7 1.5a4.5 4.5 0 0 0-4.5 4.5v3L1 11h12l-1.5-2V6A4.5 4.5 0 0 0 7 1.5zM5.5 11a1.5 1.5 0 0 0 3 0"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  ),
  governance: (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M7 1l1 3h3l-2.5 1.8.9 3L7 7 4.6 8.8l.9-3L3 4h3L7 1Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M2 13h10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  ),
  emails: (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="3" width="12" height="8" rx="1" stroke="currentColor" strokeWidth="1.1" />
      <path d="M1 4.5l6 4 6-4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  billing: (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="3" width="12" height="9" rx="1" stroke="currentColor" strokeWidth="1.1" />
      <path d="M1 6.5h12" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  ),
  danger: (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ color: "var(--uncertified)" }}>
      <circle cx="7" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.1" />
      <path d="M7 5v3M7 10.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
};
