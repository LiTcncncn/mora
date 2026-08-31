import { MemoryView } from "@/components/memory/memory-view";
import { PageHeader } from "@/components/ui/primitives";

export default function MemoryPage() {
  return (
    <>
      <PageHeader
        title="Memory 记忆"
        description="记忆只属于当前测试档案。系统抽取后默认直接写入，可在设置中改为需人工确认。"
      />
      <MemoryView />
    </>
  );
}
