import { ProviderTestView } from "@/components/providers/provider-test-view";
import { PageHeader } from "@/components/ui/primitives";

export default function ProviderTestPage() {
  return (
    <>
      <PageHeader
        title="大模型测试"
        description="检查本机能否连上供应商，并区分网络超时与 API Key 无效。"
      />
      <ProviderTestView />
    </>
  );
}
