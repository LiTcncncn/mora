"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, errorMessage } from "@/lib/api-client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const data = await api.post<{
        user: { role: string };
      }>("/api/auth/login", { username, password });
      const next = searchParams.get("next");
      if (data.user.role === "guest") {
        router.replace(next && next.startsWith("/") ? next : "/compare");
      } else {
        router.replace(next && next.startsWith("/") ? next : "/");
      }
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-sm space-y-4">
      <div>
        <h1 className="text-xl font-medium">登录 ZHAKA Lab</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          无注册。账号由服务器配置文件维护。
        </p>
      </div>
      {error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <label className="block text-sm">
        <span className="text-[var(--color-muted)]">用户名</span>
        <input
          className="mt-1 w-full rounded border px-3 py-2"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />
      </label>
      <label className="block text-sm">
        <span className="text-[var(--color-muted)]">密码</span>
        <input
          type="password"
          className="mt-1 w-full rounded border px-3 py-2"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "登录中…" : "登录"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--color-canvas)] px-4">
      <Suspense fallback={<p className="text-sm">加载中…</p>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
