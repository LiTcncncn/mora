import { MemoryView } from "@/components/memory/memory-view";
import { PageHeader } from "@/components/ui/primitives";

export default function MemoryPage() {
  return (
    <>
      <PageHeader
        title="Memory 记忆"
        description="系统抽取后默认直接写入。管理员可在此管理记忆与事发日；体验账号记忆保存在各自浏览器。说「聊聊上周的事」时，会按事发日时间窗筛选。"
      />
      <MemoryView />
    </>
  );
}
