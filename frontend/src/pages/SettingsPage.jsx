import React from "react";
import SettingsWorkspace from "./settings/SettingsWorkspace.jsx";
import "./settings/SettingsPage.css";

export default function SettingsPage() {
  return (
    <div className="settings-root" style={{ position: "fixed", inset: 0, zIndex: 100 }}>
      <SettingsWorkspace />
    </div>
  );
}
