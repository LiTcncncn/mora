import Link from "next/link";
import { PageHeader } from "@/components/ui/primitives";
import { Overview } from "@/components/overview/overview";

export default function HomePage() {
  return (
    <>
      <PageHeader
        title="总览"
        description="ZHAKA Lab 在本机运行，所有数据保存在项目的 data 数据目录中。"
      />
      <Overview />
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/compare" className="btn btn-primary">
          开始多模型对话
        </Link>
        <Link href="/models" className="btn">
          大模型测试
        </Link>
        <Link href="/settings" className="btn">
          检查设置
        </Link>
      </div>
    </>
  );
}
