import { RunsView } from "@/components/runs/runs-view";
import { PageHeader } from "@/components/ui/primitives";

export default function RunsPage() {
  return (
    <>
      <PageHeader
        title="运行记录"
        description="每次模型调用的完整快照。"
      />
      <RunsView />
    </>
  );
}
