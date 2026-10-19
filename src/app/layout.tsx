import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell/app-shell";
import { AuthProvider } from "@/components/app-shell/auth-context";
import { ProfileProvider } from "@/components/app-shell/profile-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZHAKA Lab",
  description: "ZHAKA 本地多模型陪伴对话实验台",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <AuthProvider>
          <ProfileProvider>
            <AppShell>{children}</AppShell>
          </ProfileProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
