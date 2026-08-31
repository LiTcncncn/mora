"use client";

import { useEffect, useRef, useState } from "react";
import { CALL_FAILED_TEXT } from "@/domain/common";
import {
  FINISH_REASON_TEXT,
  formatLatency,
  formatTokens,
  shortHash,
} from "@/lib/format";
import { labelOf, PROVIDER_LABELS } from "@/lib/labels";
import type { LaneCell } from "./turns";

const PREVIEW_CHARS = 600;

export function ModelCell({
  lane,
  onOpenRun,
}: {
  lane: LaneCell;
  onOpenRun: (runId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);
  const { slot, message, run } = lane;

  const failed = message === null;
  const fullText = message?.content ?? "";
  const chars = [...fullText];
  const needsFold = chars.length > PREVIEW_CHARS;
  const shownText =
    needsFold && !expanded ? `${chars.slice(0, PREVIEW_CHARS).join("")}…` : fullText;

  useEffect(() => {
    if (!infoOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!infoRef.current?.contains(event.target as Node)) {
        setInfoOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [infoOpen]);

  return (
    <div className="card flex min-w-0 flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-3 py-2">
        <span className="text-sm font-medium">{slot.label}</span>
        <span className="mono text-[var(--color-muted)]">
          {labelOf(PROVIDER_LABELS, slot.provider)} · {slot.modelId}
        </span>
      </div>

      <div className="flex min-w-0 flex-1">
        <div className="min-w-0 flex-1 px-3 py-3">
          {failed ? (
            <p className="text-sm text-[var(--color-danger)]">{CALL_FAILED_TEXT}</p>
          ) : (
            <>
              <p className="text-[15px] whitespace-pre-wrap break-words">
                {shownText}
              </p>
              {needsFold ? (
                <button
                  type="button"
                  className="mt-2 text-xs underline"
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? "收起" : "展开全文"}
                </button>
              ) : null}
              {run?.finishReason && run.finishReason !== "completed" ? (
                <p className="mt-2 text-xs text-[var(--color-danger)]">
                  {FINISH_REASON_TEXT[run.finishReason]}
                </p>
              ) : null}
            </>
          )}
        </div>

        <div ref={infoRef} className="relative shrink-0 border-l">
          <button
            type="button"
            className={`h-full px-2 text-xs ${infoOpen ? "bg-[var(--color-bg)]" : "text-[var(--color-muted)]"}`}
            aria-expanded={infoOpen}
            onClick={() => setInfoOpen((open) => !open)}
          >
            信息
          </button>
          {infoOpen ? (
            <div className="absolute top-0 right-full z-20 mr-0 w-56 border bg-white p-3 text-xs shadow-md">
              {run ? (
                <div className="space-y-2 text-[var(--color-muted)]">
                  <p>{formatLatency(run.latencyMs)}</p>
                  <p>{formatTokens(run.usage)}</p>
                  <p className="mono break-all">
                    context 上下文指纹 {shortHash(run.contextHash)}
                  </p>
                  {!failed && fullText ? (
                    <button
                      type="button"
                      className="block underline"
                      onClick={() => void navigator.clipboard?.writeText(fullText)}
                    >
                      复制全文
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="block underline"
                    onClick={() => {
                      setInfoOpen(false);
                      onOpenRun(run.id);
                    }}
                  >
                    查看 Run 运行记录
                  </button>
                </div>
              ) : (
                <p className="text-[var(--color-muted)]">无运行记录</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
