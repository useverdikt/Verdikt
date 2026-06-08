import { useCallback, useState } from "react";

export function useAppToast() {
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, c) => {
    setToast({ msg, c });
    setTimeout(() => setToast(null), 3200);
  }, []);

  return { toast, showToast };
}
