import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { ActivePlan } from "../store/novaStore";

type TaskDialogMessage =
  | { type: "plan:update"; plan: ActivePlan }
  | { type: "plan:clear" };

const TASK_DIALOG_LABEL = "task-dialog";
const TASK_DIALOG_STORAGE_KEY = "nova-task-dialog-plan";

function postMessage(message: TaskDialogMessage) {
  const channel = new BroadcastChannel("nova-task-dialog");
  channel.postMessage(message);
  channel.close();
}

async function getOrCreateTaskDialogWindow() {
  const existing = await WebviewWindow.getByLabel(TASK_DIALOG_LABEL);
  if (existing) {
    return existing;
  }

  const url = `${window.location.pathname}?dialog=task`;
  return new WebviewWindow(TASK_DIALOG_LABEL, {
    url,
    title: "Cortex Nova Task Dialog",
    width: 420,
    height: 560,
    minWidth: 360,
    minHeight: 420,
    decorations: true,
    resizable: true,
    alwaysOnTop: true,
    center: true,
    focus: true,
  });
}

export async function showTaskDialog(plan: ActivePlan): Promise<void> {
  window.localStorage.setItem(TASK_DIALOG_STORAGE_KEY, JSON.stringify(plan));
  const dialogWindow = await getOrCreateTaskDialogWindow();
  await dialogWindow.show();
  await dialogWindow.setFocus();
  postMessage({ type: "plan:update", plan });
}

export async function closeTaskDialog(): Promise<void> {
  window.localStorage.removeItem(TASK_DIALOG_STORAGE_KEY);
  postMessage({ type: "plan:clear" });
  const dialogWindow = await WebviewWindow.getByLabel(TASK_DIALOG_LABEL);
  if (dialogWindow) {
    await dialogWindow.close();
  }
}
