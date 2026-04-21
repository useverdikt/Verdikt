import React from "react";
import { EmailsPreviewPanel } from "../../../EmailsPage.jsx";

export default function EmailPreviewsSection({ section }) {
  return (
    <div className={`section${section === "emails" ? " active" : ""}`} id="panel-emails">
      <div className="section-header">
        <div className="section-eyebrow">Integration</div>
        <h1 className="section-h1">Email Previews</h1>
        <p className="section-desc">Preview notification templates in place while staying inside Settings.</p>
      </div>
      <div className="sblock">
        <div className="sblock-body" style={{ padding: 0 }}>
          <EmailsPreviewPanel embedded />
        </div>
      </div>
    </div>
  );
}
