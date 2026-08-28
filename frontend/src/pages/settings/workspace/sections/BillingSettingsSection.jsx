import React from "react";

export default function BillingSettingsSection({ section }) {
  return (
    <div className={`section${section === "billing" ? " active" : ""}`} id="panel-billing">
      <div className="section-header">
        <div className="section-eyebrow">Account</div>
        <h1 className="section-h1">
          Plan &amp; <em>Billing</em>
        </h1>
        <p className="section-desc">
          You are on the Starter plan. Email us if you need another workspace or a Team plan.
        </p>
      </div>
      <div className="sblock">
        <div className="sblock-head">
          <div className="sblock-title">Current plan</div>
        </div>
        <div className="sblock-body">
          <div className="plan-card">
            <div>
              <div className="plan-name">Starter</div>
              <div className="plan-detail">1 workspace · Core release certification</div>
            </div>
            <a href="mailto:hello@useverdikt.com" className="btn-upgrade">
              Talk to us →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
