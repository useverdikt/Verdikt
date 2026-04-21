import React from "react";
import { C } from "../../../theme/tokens.js";
import { useModalLayer } from "../../../hooks/useModalLayer.js";
import {
  SIGNAL_CATEGORIES,
  getRegressionRequired,
  calcCategoryStatus,
  evaluateSignal,
  fmtVal,
  signalColor,
  catStatusColor,
  isMobileViewport
} from "../../../app/main/appMainLogic.js";

export const StatusBadge = ({
  status
}) => {
  const M = {
    pending: {
      c: C.accent,
      l: "PENDING"
    },
    shipped: {
      c: C.green,
      l: "CERTIFIED"
    },
    overridden: {
      c: C.amber,
      l: "CERT. W/ OVERRIDE"
    },
    blocked: {
      c: C.red,
      l: "UNCERTIFIED"
    }
  };
  const {
    c,
    l
  } = M[status] || M.pending;
  return /* @__PURE__ */ React.createElement("span", {
    style: {
      background: c + "15",
      color: c,
      border: `1px solid ${c}40`,
      borderRadius: 4,
      padding: "2px 8px",
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.1em",
      fontFamily: C.mono
    }
  }, l);
};
export const SignalCategoryCard = ({
  category,
  signals,
  thresholds,
  releaseType,
  onClick
}) => {
  const status = calcCategoryStatus(category.id, signals, thresholds, releaseType);
  const sc = catStatusColor(status);
  const cat = SIGNAL_CATEGORIES.find((c) => c.id === category.id);
  const reqd = getRegressionRequired(releaseType);
  const failCount = cat.signals.filter((sig) => {
    if (sig.conditional && (signals[sig.id] === null || signals[sig.id] === void 0 || reqd === false)) return false;
    const val = signals[sig.id];
    if (val === void 0 || val === null) return false;
    return !evaluateSignal(sig, val, thresholds[sig.id]).pass;
  }).length;
  const categoryHasAnySignal = cat.signals.some((sig) => {
    const val = signals[sig.id];
    const isWaived = sig.conditional && (val === null || val === void 0 || reqd === false);
    return isWaived || val !== void 0 && val !== null;
  });
  const cardStyle = {
    background: C.glassBg,
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: `1px solid ${status === "fail" ? C.red + "35" : C.glassBorder}`,
    borderRadius: 16,
    padding: "24px 26px",
    cursor: "pointer",
    boxShadow: C.elevShadow,
    position: "relative",
    overflow: "hidden"
  };
  return /* @__PURE__ */ React.createElement("div", {
    onClick,
    className: "signal-category-card-wrap",
    style: cardStyle
  }, /* @__PURE__ */ React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      borderRadius: 16,
      pointerEvents: "none",
      boxShadow: `inset 0 0 0 1px ${sc}20, inset 5px 0 28px -6px ${sc}24`
    }
  }), /* @__PURE__ */ React.createElement("div", {
    style: {
      paddingLeft: 8
    }
  }, /* @__PURE__ */ React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 10
    }
  }, /* @__PURE__ */ React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /* @__PURE__ */ React.createElement("span", {
    style: {
      fontSize: 22,
      lineHeight: 1,
      color: category.color
    }
  }, category.icon), /* @__PURE__ */ React.createElement("span", {
    style: {
      fontSize: 15,
      fontWeight: 600,
      letterSpacing: "-0.02em",
      color: C.text
    }
  }, category.label)), /* @__PURE__ */ React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, failCount > 0 && /* @__PURE__ */ React.createElement("span", {
    style: {
      fontSize: 11,
      color: C.red,
      fontFamily: C.mono
    }
  }, failCount, " failing"), status === "waived" && /* @__PURE__ */ React.createElement("span", {
    style: {
      fontSize: 10,
      color: C.amber,
      fontFamily: C.sans,
      fontWeight: 600,
      letterSpacing: "0.04em",
      padding: "3px 10px",
      borderRadius: 999,
      background: `${C.amber}18`,
      border: `1px solid ${C.amber}35`
    }
  }, "Waived"), /* @__PURE__ */ React.createElement("div", {
    style: {
      width: 10,
      height: 10,
      borderRadius: "50%",
      background: sc,
      boxShadow: status === "fail" ? `0 0 0 2px ${C.glassBg}, 0 0 14px ${C.red}88` : status === "pass" ? `0 0 0 2px ${C.glassBg}, 0 0 14px ${C.green}77` : status === "waived" ? `0 0 0 2px ${C.glassBg}, 0 0 14px ${C.amber}66` : `0 0 0 2px ${C.glassBg}`
    }
  }))), !categoryHasAnySignal ? /* @__PURE__ */ React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.muted,
      lineHeight: 1.55,
      fontFamily: C.sans,
      paddingTop: 4
    }
  }, "No signals reported for this category yet. Connect sources, ingest from CI, or open this category to add values.") : /* @__PURE__ */ React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 5
    }
  }, cat.signals.slice(0, 4).map((sig) => {
    const val = signals[sig.id];
    const isWaived = sig.conditional && (val === null || val === void 0 || reqd === false);
    if (val === void 0 && !isWaived) return /* @__PURE__ */ React.createElement("div", {
      key: sig.id,
      style: {
        fontSize: 11,
        color: C.dim,
        fontFamily: C.mono
      }
    }, sig.label, ": —");
    const color = isWaived ? C.amber : signalColor(sig, val, thresholds[sig.id]);
    return /* @__PURE__ */ React.createElement("div", {
      key: sig.id,
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8
      }
    }, /* @__PURE__ */ React.createElement("span", {
      style: {
        fontSize: 12,
        color: C.muted,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, sig.label), /* @__PURE__ */ React.createElement("span", {
      style: {
        fontSize: isWaived ? 11 : 14,
        fontFamily: C.mono,
        fontWeight: 700,
        letterSpacing: "-0.03em",
        color,
        flexShrink: 0
      }
    }, isWaived ? /* @__PURE__ */ React.createElement("span", {
      style: {
        fontFamily: C.sans,
        fontWeight: 600,
        fontSize: 10,
        padding: "2px 8px",
        borderRadius: 999,
        background: `${C.amber}16`,
        border: `1px solid ${C.amber}30`,
        color: C.amber
      }
    }, "Waived") : fmtVal(sig, val)));
  }), cat.signals.length > 4 && /* @__PURE__ */ React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.dim,
      gridColumn: "span 2"
    }
  }, "+", cat.signals.length - 4, " more"))));
};
export const SignalDetailPanel = ({
  catId,
  release,
  thresholds,
  releaseType,
  onClose
}) => {
  const titleId = React.useId();
  useModalLayer(onClose);
  const isMobile = isMobileViewport();
  const cat = SIGNAL_CATEGORIES.find((c) => c.id === catId);
  if (!cat) return null;
  const signals = release.signals;
  const reqd = getRegressionRequired(releaseType);
  return /* @__PURE__ */ React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      background: "#000000d8",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 100,
      padding: isMobile ? 10 : 20,
      backdropFilter: "blur(4px)"
    },
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": titleId
  }, /* @__PURE__ */ React.createElement("div", {
    className: "scale-in",
    style: {
      background: C.raise,
      border: `1px solid ${C.borderL}`,
      borderRadius: isMobile ? 12 : 18,
      padding: isMobile ? 16 : 28,
      maxWidth: 560,
      width: "100%",
      boxShadow: "0 32px 100px #00000090",
      maxHeight: isMobile ? "96vh" : "90vh",
      overflowY: "auto"
    }
  }, /* @__PURE__ */ React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 20
    }
  }, /* @__PURE__ */ React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /* @__PURE__ */ React.createElement("span", {
    style: {
      fontSize: 20,
      color: cat.color
    },
    "aria-hidden": "true"
  }, cat.icon), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", {
    id: titleId,
    style: {
      fontSize: 17,
      fontWeight: 800,
      color: C.text
    }
  }, cat.label), /* @__PURE__ */ React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.muted
    }
  }, cat.description))), /* @__PURE__ */ React.createElement("button", {
    onClick: onClose,
    style: {
      background: "transparent",
      border: "none",
      color: C.muted,
      fontSize: 20,
      cursor: "pointer"
    }
  }, "✕")), /* @__PURE__ */ React.createElement("div", {
    style: {
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      overflow: "hidden"
    }
  }, cat.signals.map((sig, i) => {
    const val = signals[sig.id];
    const isWaived = sig.conditional && (val === null || val === void 0 || reqd === false);
    const borderStyle = i < cat.signals.length - 1 ? `1px solid ${C.border}` : "none";
    if (isWaived) return /* @__PURE__ */ React.createElement("div", {
      key: sig.id,
      style: {
        padding: "14px 18px",
        borderBottom: borderStyle,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }
    }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", {
      style: {
        color: C.text,
        fontSize: 13,
        fontWeight: 600
      }
    }, sig.label), /* @__PURE__ */ React.createElement("div", {
      style: {
        color: C.muted,
        fontSize: 11,
        marginTop: 2
      }
    }, sig.description)), /* @__PURE__ */ React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6
      }
    }, /* @__PURE__ */ React.createElement("div", {
      style: {
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: C.amber
      }
    }), /* @__PURE__ */ React.createElement("span", {
      style: {
        fontFamily: C.mono,
        fontSize: 12,
        color: C.amber,
        fontWeight: 700
      }
    }, "WAIVED")));
    if (val === void 0 || val === null) return /* @__PURE__ */ React.createElement("div", {
      key: sig.id,
      style: {
        padding: "14px 18px",
        borderBottom: borderStyle,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }
    }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", {
      style: {
        color: C.muted,
        fontSize: 13,
        fontWeight: 600
      }
    }, sig.label), /* @__PURE__ */ React.createElement("div", {
      style: {
        color: C.dim,
        fontSize: 11,
        marginTop: 2
      }
    }, sig.description)), /* @__PURE__ */ React.createElement("span", {
      style: {
        color: C.dim,
        fontFamily: C.mono,
        fontSize: 12
      }
    }, "No data"));
    const {
      pass
    } = evaluateSignal(sig, val, thresholds[sig.id]);
    const color = signalColor(sig, val, thresholds[sig.id]);
    return /* @__PURE__ */ React.createElement("div", {
      key: sig.id,
      style: {
        padding: "14px 18px",
        borderBottom: borderStyle
      }
    }, /* @__PURE__ */ React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 6
      }
    }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8
      }
    }, /* @__PURE__ */ React.createElement("span", {
      style: {
        color: C.text,
        fontSize: 13,
        fontWeight: 600
      }
    }, sig.label), sig.hardGate && /* @__PURE__ */ React.createElement("span", {
      title: "Failure renders release permanently UNCERTIFIED — no override available",
      style: {
        fontSize: 9,
        fontFamily: C.mono,
        color: C.red,
        background: C.redDim,
        padding: "1px 5px",
        borderRadius: 3,
        fontWeight: 700,
        cursor: "help"
      }
    }, "HARD GATE — NO OVERRIDE")), /* @__PURE__ */ React.createElement("div", {
      style: {
        color: C.muted,
        fontSize: 11,
        marginTop: 2
      }
    }, sig.description)), /* @__PURE__ */ React.createElement("div", {
      style: {
        textAlign: "right",
        flexShrink: 0,
        marginLeft: 16
      }
    }, /* @__PURE__ */ React.createElement("div", {
      style: {
        fontFamily: C.mono,
        fontSize: 16,
        fontWeight: 700,
        color
      }
    }, fmtVal(sig, val)), sig.direction !== "pass" && /* @__PURE__ */ React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.dim,
        fontFamily: C.mono,
        marginTop: 2
      }
    }, sig.direction === "above" ? "≥" : "≤", thresholds[sig.id], sig.unit, " threshold"))), sig.direction !== "pass" && /* @__PURE__ */ React.createElement("div", {
      style: {
        height: 4,
        background: C.border,
        borderRadius: 2,
        overflow: "hidden",
        marginTop: 6
      }
    }, /* @__PURE__ */ React.createElement("div", {
      style: {
        height: "100%",
        background: color,
        borderRadius: 2,
        width: sig.direction === "above" ? `${Math.min(100, Number(val))}%` : `${Math.max(0, 100 - Number(val) / Number(thresholds[sig.id]) * 50)}%`,
        transition: "width 0.5s"
      }
    })), /* @__PURE__ */ React.createElement("div", {
      style: {
        marginTop: 6,
        display: "flex",
        alignItems: "center",
        gap: 6
      }
    }, /* @__PURE__ */ React.createElement("div", {
      style: {
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: pass ? C.green : C.red
      }
    }), /* @__PURE__ */ React.createElement("span", {
      style: {
        fontSize: 11,
        color: pass ? C.green : C.red,
        fontWeight: 600
      }
    }, pass ? "Passing threshold" : "Below threshold")));
  }))));
};
