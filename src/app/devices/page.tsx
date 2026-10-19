import { DevicesView } from "@/components/devices/devices-view";
import { PageHeader } from "@/components/ui/primitives";

export default function DevicesPage() {
  return (
    <>
      <PageHeader
        title="硬件设备"
        description="设备首次连上网关会自动登记；人设、模型、音色统一在这里指定，每台设备的对话和记忆各自独立。"
      />
      <DevicesView />
    </>
  );
}
