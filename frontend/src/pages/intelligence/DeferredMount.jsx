import React, { useEffect, useRef, useState } from "react";
import { Spinner } from "./ui.jsx";

/**
 * Mount children only when near the viewport — avoids firing every intelligence panel API on first paint.
 */
export default function DeferredMount({ children, rootMargin = "240px", minHeight = 120 }) {
  const hostRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || visible) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin, visible]);

  return (
    <div ref={hostRef} style={{ minHeight: visible ? undefined : minHeight }}>
      {visible ? children : <Spinner />}
    </div>
  );
}
