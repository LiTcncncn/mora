import { StudioView } from "@/components/studio/studio-view";
import { PageHeader } from "@/components/ui/primitives";

export default function StudioPage() {
  return (
    <>
      <PageHeader
        title="Prompt Studio 提示词工坊"
        description="调试 Persona 人格与 Context 上下文分区模板。安全底线只读，永远排在最前。"
      />
      <StudioView />
    </>
  );
}
