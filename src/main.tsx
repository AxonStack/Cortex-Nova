import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { TaskDialogWindow } from "./components/TaskDialogWindow";
import "./tailwind.css";

const params = new URLSearchParams(window.location.search);
const isTaskDialogWindow = params.get("dialog") === "task";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isTaskDialogWindow ? <TaskDialogWindow /> : <App />}
  </React.StrictMode>,
);
