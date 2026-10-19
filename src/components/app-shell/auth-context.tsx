"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { PublicSessionUser } from "@/domain/accounts";
import { api, ApiRequestError } from "@/lib/api-client";

type AuthState = {
  user: PublicSessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicSessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const router = useRouter();

  const refresh = useCallback(async () => {
    if (pathname === "/login") {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api.get<{ user: PublicSessionUser }>("/api/auth/me");
      setUser(data.user);
    } catch (caught) {
      setUser(null);
      if (caught instanceof ApiRequestError && caught.code === "UNAUTHORIZED") {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      }
    } finally {
      setLoading(false);
    }
  }, [pathname, router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.post("/api/auth/logout", {});
    setUser(null);
    router.replace("/login");
    router.refresh();
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
