"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "./auth-context";
import { useProfiles } from "./profile-context";

const ADMIN_NAV = [
  { href: "/", label: "总览" },
  { href: "/compare", label: "聊天" },
  { href: "/studio", label: "Prompt Studio 提示词工坊" },
  { href: "/memory", label: "Memory 记忆" },
  { href: "/runs", label: "运行记录" },
  { href: "/devices", label: "硬件设备" },
  { href: "/settings", label: "设置" },
  { href: "/models", label: "大模型测试" },
];

const GUEST_NAV = [{ href: "/compare", label: "聊天" }];

const GUEST_BLOCKED = [
  "/studio",
  "/memory",
  "/runs",
  "/devices",
  "/settings",
  "/models",
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const { user, loading, logout } = useAuth();
  const { providerStatus } = useProfiles();

  const isLogin = pathname === "/login";
  const isGuest = user?.role === "guest";
  const navItems = useMemo(
    () => (isGuest ? GUEST_NAV : ADMIN_NAV),
    [isGuest],
  );

  useEffect(() => {
    if (loading || !user || user.role !== "guest") return;
    if (pathname === "/" || GUEST_BLOCKED.some((path) => pathname.startsWith(path))) {
      router.replace("/compare");
    }
  }, [loading, user, pathname, router]);

  const isActive = (href: string): boolean =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  if (isLogin) {
    return <>{children}</>;
  }

  if (loading && !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-[var(--color-muted)]">
        正在验证登录…
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <header className="shrink-0 border-b bg-white md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-medium">ZHAKA Lab</span>
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
            {navItems.map((item) => (
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
          <div className="font-medium">ZHAKA Lab</div>
          <div className="text-xs text-[var(--color-muted)]">
            {isGuest ? "体验台" : "管理与实验台"}
          </div>
        </div>
        <nav className="p-2">
          {navItems.map((item) => (
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
          {isGuest
            ? "聊天与记忆保存在本机浏览器。"
            : "配置保存在服务器；聊天可在本机浏览器。"}
        </p>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-white px-4 py-2 text-xs">
          {user ? (
            <span className="text-[var(--color-muted)]">
              {user.displayName}（{user.role === "admin" ? "管理员" : "体验"}）
            </span>
          ) : null}

          <span className="text-[var(--color-muted)]">
            Kimi：
            {providerStatus?.kimi.configured ? "已配置" : "未配置"}
          </span>
          <span className="text-[var(--color-muted)]">
            DeepSeek：
            {providerStatus?.deepseek.configured ? "已配置" : "未配置"}
          </span>
          <span className="text-[var(--color-muted)]">
            MiniMax 语音：
            {providerStatus?.minimax?.configured ? "已配置" : "未配置"}
          </span>

          <button
            type="button"
            className="ml-auto text-[var(--color-muted)] underline"
            onClick={() => void logout()}
          >
            退出
          </button>
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
