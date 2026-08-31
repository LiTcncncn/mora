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
import type { TestProfile } from "@/domain/profile";
import { api, errorMessage } from "@/lib/api-client";

interface ProfilesPayload {
  activeProfileId: string;
  items: TestProfile[];
}

interface ProviderStatus {
  kimi: { configured: boolean };
  deepseek: { configured: boolean };
}

interface ProfileContextValue {
  profiles: TestProfile[];
  activeProfileId: string | null;
  activeProfile: TestProfile | null;
  providerStatus: ProviderStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  switchProfile: (id: string) => Promise<void>;
  createProfile: (name: string) => Promise<void>;
  renameProfile: (id: string, name: string) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<TestProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<ProfileContextValue>(
    () => ({
      profiles,
      activeProfileId,
      activeProfile:
        profiles.find((profile) => profile.id === activeProfileId) ?? null,
      providerStatus,
      loading,
      error,
      refresh,
      switchProfile: async (id) => {
        await api.put(`/api/profiles/${id}`, { setActive: true });
        await refresh();
      },
      createProfile: async (name) => {
        await api.post("/api/profiles", { name });
        await refresh();
      },
      renameProfile: async (id, name) => {
        await api.put(`/api/profiles/${id}`, { name });
        await refresh();
      },
      deleteProfile: async (id) => {
        await api.delete(`/api/profiles/${id}`);
        await refresh();
      },
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
