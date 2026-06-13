import { useEffect, useState } from "react";
import { apiGet } from "../lib/apiClient.js";
import { persistAuthSession } from "../auth/persistSession.js";
import { hasBackend } from "../lib/hasBackend.js";
import { S } from "../app/main/appMainLogic.js";

/** Current user session and /api/auth/me bootstrap. */
export function useWorkspaceAuth(navigate) {
  const [currentUser, setCurrentUser] = useState(() => {
    if (hasBackend()) return null;
    const u = S.get("currentUser", null);
    if (u && u.role === "viewer") return { ...u, role: "engineer" };
    return u;
  });

  useEffect(() => {
    if (currentUser) S.set("currentUser", currentUser);
  }, [currentUser]);

  useEffect(() => {
    if (!hasBackend()) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiGet("/api/auth/me", { navigate });
        if (cancelled || !data?.user) return;
        persistAuthSession({ user: data.user });
        setCurrentUser({
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role
        });
      } catch {
        /* ProtectedRoute handles unauthenticated redirects */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return { currentUser, setCurrentUser };
}
