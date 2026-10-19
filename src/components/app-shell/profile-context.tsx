"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import type { TestProfile } from "@/domain/profile";
import { api, errorMessage } from "@/lib/api-client";

interface ProfilesPayload {
  activeProfileId: string;
  items: TestProfile[];
}

interface ProviderStatus {
  kimi: { configured: boolean };
  deepseek: { configured: boolean };
  minimax?: { configured: boolean };
}

interface ProfileContextValue {
  /** 当前生效配置槽 id（工程内部仍按 profileId 分片存储）。 */
  activeProfileId: string | null;
  activeProfile: TestProfile | null;
  providerStatus: ProviderStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [profiles, setProfiles] = useState<TestProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (pathname === "/login") {
      setLoading(false);
      return;
    }
    try {
      const [payload, status] = await Promise.all([
        api.get<ProfilesPayload>("/api/profiles"),
        api.get<ProviderStatus>("/api/providers/status"),
      ]);
      setProfiles(payload.items);
      setActiveProfileId(payload.activeProfileId);
      setProviderStatus(status);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [pathname]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<ProfileContextValue>(
    () => ({
      activeProfileId,
      activeProfile:
        profiles.find((profile) => profile.id === activeProfileId) ?? null,
      providerStatus,
      loading,
      error,
      refresh,
    }),
    [profiles, activeProfileId, providerStatus, loading, error, refresh],
  );

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
}

export function useProfiles(): ProfileContextValue {
  const context = useContext(ProfileContext);
  if (!context) throw new Error("useProfiles 必须在 ProfileProvider 内使用");
  return context;
}
