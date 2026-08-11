import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function listFocusables(root) {
  if (!root) return [];
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);
}

/** Lock body scroll, Escape to close, focus trap, and focus restore for modal overlays. */
export function useModalLayer(onClose, panelRef, active = true) {
  const closeRef = useRef(onClose);
  const restoreFocusRef = useRef(null);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return undefined;
    restoreFocusRef.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusFirst = () => {
      const root = panelRef?.current;
      const focusables = listFocusables(root);
      if (focusables[0]) {
        focusables[0].focus();
      } else if (root && typeof root.focus === "function") {
        root.setAttribute("tabindex", "-1");
        root.focus();
      }
    };

    const raf = requestAnimationFrame(focusFirst);

    const onKey = (e) => {
      if (e.key === "Escape" && closeRef.current) {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef?.current) return;
      const focusables = listFocusables(panelRef.current);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      const prev = restoreFocusRef.current;
      if (prev && typeof prev.focus === "function") {
        try {
          prev.focus();
        } catch {
          /* ignore stale focus target */
        }
      }
    };
  }, [active, panelRef]);
}
