import React from "react";
import { Link } from "react-router-dom";

export default function BillingSettingsSection({ section }) {
  return (
    <div className={`section${section === "billing" ? " active" : ""}`} id="panel-billing">
      <div className="section-header">
        <div className="section-eyebrow">Account</div>
        <h1 className="section-h1">
          Plan &amp; <em>Billing</em>
        </h1>
        <p className="section-desc">
          You are on the Starter plan. Upgrade to Team to unlock multiple projects, advanced intelligence features, and priority support.
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
              <div className="plan-detail">Free forever · 1 workspace · Core release certification</div>
            </div>
            <Link to="/pricing" className="btn-upgrade">
              Upgrade to Team →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
