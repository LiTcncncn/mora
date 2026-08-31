"use client";

import { useState } from "react";
import { useProfiles } from "@/components/app-shell/profile-context";
import {
  Collapsible,
  ConfirmButton,
  Notice,
} from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api-client";

export function ProfileManager() {
  const {
    profiles,
    activeProfileId,
    createProfile,
    renameProfile,
    deleteProfile,
    switchProfile,
  } = useProfiles();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const guard = async (task: () => Promise<void>): Promise<void> => {
    try {
      await task();
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <Collapsible title="本地测试档案">
      <div className="space-y-3">
        <Notice>
          档案之间的设置、Persona 人格、对话、Memory 记忆与 run 运行记录完全隔离。删除档案会一并删除它的全部本地数据。
        </Notice>
        {error ? <Notice tone="error">{error}</Notice> : null}

        <ul className="space-y-2">
          {profiles.map((profile) => (
            <li
              key={profile.id}
              className="flex flex-wrap items-center gap-2 border-b pb-2 text-sm last:border-b-0"
            >
              <span className="flex-1">
                {profile.name}
                {profile.id === activeProfileId ? "（当前）" : ""}
              </span>
              {profile.id === activeProfileId ? null : (
                <button
                  type="button"
                  className="btn"
                  onClick={() => void guard(() => switchProfile(profile.id))}
                >
                  切换
                </button>
              )}
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const next = window.prompt("新的档案名称", profile.name);
                  if (next?.trim()) {
                    void guard(() => renameProfile(profile.id, next.trim()));
                  }
                }}
              >
                重命名
              </button>
              {profiles.length > 1 ? (
                <ConfirmButton
                  label="删除"
                  confirmLabel="确认删除全部数据"
                  onConfirm={() => guard(() => deleteProfile(profile.id))}
                />
              ) : null}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <input
            className="field max-w-xs"
            placeholder="新档案名称，例如「上班族 A」"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="button"
            className="btn"
            disabled={!name.trim()}
            onClick={() =>
              void guard(async () => {
                await createProfile(name.trim());
                setName("");
              })
            }
          >
            新建档案
          </button>
        </div>
      </div>
    </Collapsible>
  );
}
