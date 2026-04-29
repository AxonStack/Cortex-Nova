import { useMemo } from "react";
import type { ActivePlan, PlanStep } from "../store/novaStore";

function PlanStepRow({ step }: { step: PlanStep }) {
  const icon =
    step.status === "done" ? "✓" :
    step.status === "error" ? "✗" :
    step.status === "active" ? "●" : "○";

  const color =
    step.status === "done" ? "text-green-500" :
    step.status === "error" ? "text-red-500" :
    step.status === "active" ? "text-blue-500 animate-pulse" :
    "text-black/30 dark:text-white/25";

  return (
    <div className={`flex items-start gap-2.5 py-2 border-b border-black/8 dark:border-white/8 last:border-0 transition-all duration-300 ${step.status === "active" ? "opacity-100" : step.status === "pending" ? "opacity-50" : "opacity-90"}`}>
      <span className={`text-[14px] font-bold mt-0.5 shrink-0 ${color}`}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[12px] text-black dark:text-[#e8e8e8] font-medium">{step.label}</div>
        {step.detail && (
          <div className="text-[10px] text-black/45 dark:text-white/35 mt-0.5 break-words">{step.detail}</div>
        )}
      </div>
    </div>
  );
}

export function TaskPlanPanel({
  activePlan,
  emptyLabel = "This window appears when Nova takes control of a desktop task.",
  compact = false,
}: {
  activePlan: ActivePlan | null;
  emptyLabel?: string;
  compact?: boolean;
}) {
  const doneCount = useMemo(
    () => activePlan?.steps.filter((step) => step.status === "done").length ?? 0,
    [activePlan],
  );
  const total = activePlan?.steps.length ?? 0;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className={`${compact ? "rounded-[24px]" : "h-screen"} bg-[#d8d8d8] dark:bg-[#0f0f0f] ${compact ? "p-0" : "p-4"} font-mono transition-colors duration-200 overflow-hidden`}>
      <div className={`${compact ? "rounded-[24px]" : "h-full rounded-[28px]"} border-2 border-black dark:border-[#3a3a3a] bg-[#dfdfdf] dark:bg-[#171717] shadow-[0_10px_0_#000] dark:shadow-[0_10px_0_#2a2a2a] p-2`}>
        <div className={`${compact ? "rounded-[18px]" : "h-full rounded-[20px]"} border border-black dark:border-[#3a3a3a] bg-[#e8e8e8] dark:bg-[#1f1f1f] overflow-hidden flex flex-col`}>
          <div className="px-5 pt-5 pb-3 border-b border-black/15 dark:border-white/10">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[9px] tracking-[0.3em] uppercase text-black/40 dark:text-white/30">
                Nova Task
              </span>
              {activePlan && (
                <span className="ml-auto text-[9px] tracking-wide text-black/40 dark:text-white/30 tabular-nums">
                  {doneCount}/{total}
                </span>
              )}
            </div>
            <div className="text-[14px] font-bold text-black dark:text-[#e8e8e8] tracking-wide">
              {activePlan ? activePlan.title : "Waiting for a task"}
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-black dark:bg-white transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <div className={`${compact ? "max-h-[300px]" : "flex-1"} px-5 py-3 overflow-y-auto`}>
            {!activePlan ? (
              <div className="h-full flex items-center justify-center text-center text-[11px] tracking-[0.15em] uppercase text-black/35 dark:text-white/30">
                {emptyLabel}
              </div>
            ) : (
              activePlan.steps.map((step) => (
                <PlanStepRow key={step.id} step={step} />
              ))
            )}
          </div>

          {activePlan && doneCount === total && (
            <div className="px-5 pb-4 text-[11px] tracking-[0.15em] uppercase text-green-600 dark:text-green-400 font-bold">
              {activePlan.type === "research"
                ? "✓ Research sources opened"
                : "✓ Desktop task complete"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
