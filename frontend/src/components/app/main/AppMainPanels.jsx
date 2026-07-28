import React from "react";
import { C } from "../../../theme/tokens.js";
import { useModalLayer } from "../../../hooks/useModalLayer.js";
import {
  SIGNAL_CATEGORIES,
  getRegressionRequired,
  evaluateSignal,
  fmtVal,
  signalColor,
  isMobileViewport
} from "../../../app/main/appMainLogic.js";

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
