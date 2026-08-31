import { CompareView } from "@/components/compare/compare-view";
import { PageHeader } from "@/components/ui/primitives";

export default function ComparePage() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0">
      <PageHeader
        title="多模型对话"
        description="同一句输入并行调用全部启用的模型槽位，每个槽位维护自己的对话历史。"
      />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <CompareView />
      </div>
    </div>
  );
}
