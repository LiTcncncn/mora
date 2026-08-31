import { SettingsView } from "@/components/settings/settings-view";
import { PageHeader } from "@/components/ui/primitives";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="设置"
        description="所有影响模型行为的设置都在这里，按测试档案独立保存在本机。"
      />
      <SettingsView />
    </>
  );
}
