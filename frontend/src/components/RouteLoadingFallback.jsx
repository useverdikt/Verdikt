import React from "react";

/** Lightweight placeholder while lazy route chunks load. */
export default function RouteLoadingFallback() {
  return (
    <div
      style={{
        minHeight: "40vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        color: "#6e87a2",
        background: "#060810"
      }}
    >
      Loading…
    </div>
  );
}
