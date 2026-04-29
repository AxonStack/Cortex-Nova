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
  if (existing) return existing;

  const win = new WebviewWindow(TASK_DIALOG_LABEL, {
    url: "/?dialog=task",
    title: "Cortex Nova Task",
    width: 420,
    height: 520,
    minWidth: 360,
    minHeight: 360,
    decorations: false,
    resizable: false,
    alwaysOnTop: true,
    center: true,
    focus: false,
    skipTaskbar: true,
  });

  // Surface creation errors to the console so silent failures are visible.
  win.once("tauri://error", (e) => {
    // eslint-disable-next-line no-console
    console.error("[task-dialog] failed to create window:", e);
  });

  return win;
}

export async function showTaskDialog(plan: ActivePlan): Promise<void> {
  window.localStorage.setItem(TASK_DIALOG_STORAGE_KEY, JSON.stringify(plan));
  try {
    const dialogWindow = await getOrCreateTaskDialogWindow();
    await dialogWindow.show().catch(() => {});
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[task-dialog] showTaskDialog error:", err);
  }
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
