import { FewShotView } from "@/components/fewshot/fewshot-view";
import { PageHeader } from "@/components/ui/primitives";

export default function FewShotPage() {
  return (
    <>
      <PageHeader
        title="Few-shot 示例语料"
        description="示例只属于当前测试档案，随配置文件一起导出导入。核心 Prompt 管不跑偏，这里管口气和节奏。"
      />
      <FewShotView />
    </>
  );
}
