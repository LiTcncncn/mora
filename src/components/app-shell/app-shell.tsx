"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useProfiles } from "./profile-context";

const NAV_ITEMS = [
  { href: "/", label: "总览" },
  { href: "/compare", label: "多模型对话" },
  { href: "/studio", label: "Prompt Studio 提示词工坊" },
  { href: "/fewshot", label: "Few-shot 示例语料" },
  { href: "/memory", label: "Memory 记忆" },
  { href: "/runs", label: "运行记录" },
  { href: "/settings", label: "设置" },
  { href: "/models", label: "大模型测试" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const {
    profiles,
    activeProfileId,
    activeProfile,
    providerStatus,
    switchProfile,
  } = useProfiles();

  const isActive = (href: string): boolean =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <header className="shrink-0 border-b bg-white md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-medium">MORA Lab</span>
          <button
            type="button"
            className="btn"
            onClick={() => setNavOpen((open) => !open)}
            aria-expanded={navOpen}
          >
            {navOpen ? "收起菜单" : "菜单"}
          </button>
        </div>
        {navOpen ? (
          <nav className="border-t px-2 pb-3">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setNavOpen(false)}
                className={`block rounded px-3 py-2 text-sm ${
                  isActive(item.href) ? "bg-[var(--color-canvas)] font-medium" : ""
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>

      <aside className="hidden w-60 shrink-0 border-r bg-white md:flex md:h-full md:flex-col md:overflow-y-auto">
        <div className="border-b px-4 py-4">
          <div className="font-medium">MORA Lab</div>
          <div className="text-xs text-[var(--color-muted)]">本地实验台</div>
        </div>
        <nav className="p-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded px-3 py-2 text-sm ${
                isActive(item.href) ? "bg-[var(--color-canvas)] font-medium" : ""
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="mt-auto border-t px-4 py-3 text-xs text-[var(--color-muted)]">
          数据仅保存在本机项目目录。
        </p>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-white px-4 py-2 text-xs">
          <label className="flex items-center gap-2">
            <span className="text-[var(--color-muted)]">测试档案</span>
            <select
              className="rounded border px-2 py-1"
              value={activeProfileId ?? ""}
              onChange={(event) => void switchProfile(event.target.value)}
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>

          <span className="text-[var(--color-muted)]">
            Kimi：
            {providerStatus?.kimi.configured ? "已配置" : "未配置"}
          </span>
          <span className="text-[var(--color-muted)]">
            DeepSeek：
            {providerStatus?.deepseek.configured ? "已配置" : "未配置"}
          </span>
          {activeProfile ? (
            <span className="text-[var(--color-muted)]">
              当前档案数据相互隔离
            </span>
          ) : null}
        </div>

        <main
          className={
            pathname === "/compare"
              ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4 md:p-6"
              : "min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6"
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}
