import { useEffect, useState } from "react";
import type { ActivePlan } from "../store/novaStore";
import { TaskPlanPanel } from "./TaskPlanPanel";

type TaskDialogMessage =
  | { type: "plan:update"; plan: ActivePlan }
  | { type: "plan:clear" };

const TASK_DIALOG_STORAGE_KEY = "nova-task-dialog-plan";

export function TaskDialogWindow() {
  const [activePlan, setActivePlan] = useState<ActivePlan | null>(() => {
    const raw = window.localStorage.getItem(TASK_DIALOG_STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ActivePlan;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const channel = new BroadcastChannel("nova-task-dialog");
    channel.onmessage = (event: MessageEvent<TaskDialogMessage>) => {
      const message = event.data;
      if (message.type === "plan:update") {
        window.localStorage.setItem(TASK_DIALOG_STORAGE_KEY, JSON.stringify(message.plan));
        setActivePlan(message.plan);
      } else if (message.type === "plan:clear") {
        window.localStorage.removeItem(TASK_DIALOG_STORAGE_KEY);
        setActivePlan(null);
      }
    };

    return () => {
      channel.close();
    };
  }, []);

  return <TaskPlanPanel activePlan={activePlan} />;
}
