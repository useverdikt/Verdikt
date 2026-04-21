import React, { useState, useEffect } from "react";
import { C, T } from "../../theme/tokens.js";

export function CategorySignalsSection({
  releaseKey,
  releaseCategories,
  signals,
  thresholds,
  releaseType,
  getCategoryStatus,
  categoryStatusColor,
  onCategoryClick,
  SignalCategoryCard,
  isMobile
}) {
  const [fullCardsOpen, setFullCardsOpen] = useState(false);

  useEffect(() => {
    setFullCardsOpen(false);
  }, [releaseKey]);

  if (!fullCardsOpen) {
    return (
      <section
        style={{
          marginTop: 4,
          borderRadius: 16,
          border: `1px solid ${C.glassBorder}`,
          background: C.glassBg,
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          boxShadow: C.elevShadow,
          overflow: "hidden"
        }}
        aria-label="Signal categories summary"
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 18px"
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 12rem" }}>
            <div
              style={{
                ...T.sectionHeading,
                letterSpacing: "0.06em",
                marginBottom: 8
              }}
            >
              Categories
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center"
              }}
            >
              {releaseCategories.map((cat) => {
                const st = getCategoryStatus(cat.id);
                const sc = categoryStatusColor(st);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => onCategoryClick(cat.id)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: `1px solid ${C.glassBorder}`,
                      background: C.glassBgStrong,
                      color: C.text,
                      cursor: "pointer",
                      fontFamily: C.sans,
                      fontSize: 12,
                      fontWeight: 600,
                      maxWidth: "100%"
                    }}
                  >
                    <span style={{ fontSize: 14, lineHeight: 1, color: cat.color }}>
                      {cat.icon}
                    </span>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "11rem"
                      }}
                    >
                      {cat.label}
                    </span>
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: sc,
                        boxShadow: `0 0 8px ${sc}66`,
                        flexShrink: 0
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            className="sidebar-bulk-btn"
            onClick={() => setFullCardsOpen(true)}
            aria-expanded={false}
            style={{
              flexShrink: 0,
              fontSize: 11,
              fontFamily: C.mono,
              fontWeight: 700,
              padding: "8px 14px",
              borderRadius: 10,
              border: `1px solid ${C.accent}45`,
              background: C.accentDim,
              color: C.accentBright,
              cursor: "pointer"
            }}
          >
            Show full cards
          </button>
        </div>
      </section>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "flex-end",
          marginBottom: 10
        }}
      >
        <button
          type="button"
          className="sidebar-bulk-btn"
          onClick={() => setFullCardsOpen(false)}
          style={{
            fontSize: 10,
            fontFamily: C.mono,
            fontWeight: 700,
            padding: "5px 10px",
            borderRadius: 6,
            border: `1px solid ${C.border}`,
            background: "transparent",
            color: C.muted,
            cursor: "pointer"
          }}
        >
          Compact view
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
          gap: 12
        }}
      >
        {releaseCategories.map((cat) => (
          <SignalCategoryCard
            key={cat.id}
            category={cat}
            signals={signals}
            thresholds={thresholds}
            releaseType={releaseType}
            onClick={() => onCategoryClick(cat.id)}
          />
        ))}
      </div>
    </div>
  );
}
