import type { CommandResult } from "./commandRouter";

type DesktopActionLike =
  | { type: "desktop_open_app"; app: string; label: string }
  | { type: "desktop_close_app"; app: string; label: string }
  | { type: "browser_navigate"; url: string; label: string }
  | { type: "desktop_focus_window"; name: string; label: string }
  | { type: "desktop_press_key"; keys: string; label: string }
  | { type: "desktop_type_text"; text: string; label: string }
  | { type: "desktop_mouse_click"; x: number; y: number; label: string };

export interface AdapterExecutionText {
  startMessage?: string;
  successMessage?: string;
  failureMessage?: string;
}

export interface AdapterVerificationHints {
  appAliases?: Record<string, string[]>;
  focusTargets?: string[];
}

export interface AdapterCapabilities {
  executionText?: AdapterExecutionText;
  verificationHints?: AdapterVerificationHints;
  approvalPreview?: ApprovalPreview;
}

export interface ApprovalPreview {
  app: string;
  appIcon: string;
  recipient?: string;
  messageSummary?: string;
  riskTier: "medium" | "high";
  plannedSteps: string[];
}

export interface TelegramSendIntent {
  kind: "telegram_send_message";
  contact: string;
  message: string;
}

export interface GmailComposeIntent {
  kind: "gmail_compose_email";
  to?: string;
  subject?: string;
  body?: string;
}

export interface GmailSendIntent {
  kind: "gmail_send_email";
}

export interface ChatAppSendIntent {
  kind: "chat_app_send_message";
  app: "slack" | "discord";
  contact: string;
  message: string;
}

export type AppAdapterIntent = TelegramSendIntent | GmailComposeIntent | GmailSendIntent | ChatAppSendIntent;

function cleanField(text: string): string {
  return text.trim().replace(/^["']|["']$/g, "").trim();
}

function gmailComposeUrl(intent: GmailComposeIntent): string {
  const params = new URLSearchParams();
  params.set("view", "cm");
  params.set("fs", "1");
  if (intent.to) params.set("to", intent.to);
  if (intent.subject) params.set("su", intent.subject);
  if (intent.body) params.set("body", intent.body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function planTelegramSendIntent(intent: TelegramSendIntent): CommandResult {
  const contact = cleanField(intent.contact);
  const message = cleanField(intent.message);
  if (!contact || !message) {
    return { type: "os_action", message: "I need both a Telegram contact and a message." };
  }
  return {
    type: "command_chain",
    steps: [
      { type: "desktop_open_app", app: "telegram", label: "Open Telegram" },
      { type: "desktop_focus_window", name: "telegram", label: "Bring Telegram to front" },
      { type: "desktop_press_key", keys: "ctrl+k", label: "Open chat search" },
      { type: "desktop_type_text", text: contact, label: `Find contact: ${contact}` },
      { type: "desktop_press_key", keys: "Return", label: "Open contact chat" },
      { type: "desktop_type_text", text: message, label: `Type message to ${contact}` },
      { type: "desktop_press_key", keys: "Return", label: "Send message in Telegram" },
    ],
  };
}

export function planGmailComposeIntent(intent: GmailComposeIntent): CommandResult {
  const to = intent.to?.trim();
  const subject = intent.subject?.trim();
  const body = intent.body?.trim();
  const url = gmailComposeUrl({ ...intent, to, subject, body });
  const recipient = to ? ` to ${to}` : "";
  return {
    type: "command_chain",
    steps: [
      { type: "desktop_open_app", app: "google chrome", label: "Open Chrome for Gmail" },
      { type: "browser_navigate", url, label: `Open Gmail compose${recipient}` },
      { type: "desktop_focus_window", name: "chrome", label: "Bring Gmail compose to front" },
    ],
  };
}

export function planGmailSendIntent(): CommandResult {
  return {
    type: "command_chain",
    steps: [
      { type: "desktop_focus_window", name: "chrome", label: "Bring Gmail draft to front" },
      { type: "desktop_press_key", keys: "ctrl+Return", label: "Send email in Gmail" },
    ],
  };
}

export function planChatAppSendIntent(intent: ChatAppSendIntent): CommandResult {
  const app = cleanField(intent.app).toLowerCase() as "slack" | "discord";
  const contact = cleanField(intent.contact);
  const message = cleanField(intent.message);
  if (!contact || !message) {
    return { type: "os_action", message: `I need both a ${app} contact and a message.` };
  }
  const appLabel = app === "slack" ? "Slack" : "Discord";
  return {
    type: "command_chain",
    steps: [
      { type: "desktop_open_app", app, label: `Open ${appLabel}` },
      { type: "desktop_focus_window", name: app, label: `Bring ${appLabel} to front` },
      { type: "desktop_press_key", keys: "ctrl+k", label: `Open ${appLabel} quick switcher` },
      { type: "desktop_type_text", text: contact, label: `Find contact in ${appLabel}: ${contact}` },
      { type: "desktop_press_key", keys: "Return", label: `Open ${appLabel} conversation` },
      { type: "desktop_type_text", text: message, label: `Type message in ${appLabel} to ${contact}` },
      { type: "desktop_press_key", keys: "Return", label: `Send message in ${appLabel}` },
    ],
  };
}

export function planAppAdapterIntent(intent: AppAdapterIntent): CommandResult {
  switch (intent.kind) {
    case "telegram_send_message":
      return planTelegramSendIntent(intent);
    case "gmail_compose_email":
      return planGmailComposeIntent(intent);
    case "gmail_send_email":
      return planGmailSendIntent();
    case "chat_app_send_message":
      return planChatAppSendIntent(intent);
  }
}

export function getAdapterCapabilities(actions: DesktopActionLike[]): AdapterCapabilities | null {
  const telegramOpen = actions.some((action) => action.type === "desktop_open_app" && action.app.toLowerCase().includes("telegram"));
  const telegramContact = actions.find(
    (action): action is Extract<DesktopActionLike, { type: "desktop_type_text" }> =>
      action.type === "desktop_type_text" && /find contact:/i.test(action.label)
  );
  const telegramMessage = actions.find(
    (action): action is Extract<DesktopActionLike, { type: "desktop_type_text" }> =>
      action.type === "desktop_type_text" && /type message to /i.test(action.label)
  );
  const telegramSend = actions.some((action) => action.type === "desktop_press_key" && /send message in telegram/i.test(action.label));
  if (telegramOpen && telegramContact && telegramMessage && telegramSend) {
    return {
      executionText: {
        startMessage: `Telegram flow started. Looking for ${telegramContact.text} and preparing the message "${telegramMessage.text}".`,
        successMessage: "Telegram steps completed. If the contact was matched, the message has been sent.",
        failureMessage: "I could not finish the Telegram send flow. Check that Telegram is open, the contact exists exactly by that name, and the chat is selected.",
      },
      verificationHints: {
        appAliases: {
          telegram: ["telegram", "telegram-desktop", "Telegram"],
        },
        focusTargets: ["telegram", "Telegram"],
      },
      approvalPreview: {
        app: "Telegram",
        appIcon: "✈",
        recipient: telegramContact.text,
        messageSummary: telegramMessage.text.length > 100 ? telegramMessage.text.slice(0, 100) + "…" : telegramMessage.text,
        riskTier: "high",
        plannedSteps: actions.map((a) => a.label),
      },
    };
  }

  const gmailCompose = actions.some((action) => action.type === "browser_navigate" && /mail\.google\.com\/mail\/\?/i.test(action.url));
  const gmailSend = actions.some((action) => action.type === "desktop_press_key" && /send email in gmail/i.test(action.label));
  if (gmailCompose && !gmailSend) {
    return {
      executionText: {
        startMessage: "Gmail compose flow started. Opening a draft in Gmail.",
        successMessage: "Gmail draft opened and brought to the front.",
        failureMessage: "I could not finish the Gmail compose flow. Check that Chrome can open Gmail and that you are signed in.",
      },
      verificationHints: {
        appAliases: {
          "google chrome": ["chrome", "google chrome", "google-chrome"],
          chrome: ["chrome", "google chrome", "google-chrome"],
        },
        focusTargets: ["chrome", "gmail", "Google Chrome"],
      },
    };
  }
  if (gmailSend) {
    return {
      executionText: {
        startMessage: "Gmail send flow started. Bringing the draft to the front.",
        successMessage: "Gmail send shortcut executed. Confirm the draft was active before sending.",
        failureMessage: "I could not finish the Gmail send flow. Check that the Gmail draft window is focused before retrying.",
      },
      verificationHints: {
        appAliases: {
          chrome: ["chrome", "google chrome", "google-chrome"],
        },
        focusTargets: ["chrome", "gmail", "Google Chrome"],
      },
      approvalPreview: {
        app: "Gmail",
        appIcon: "✉",
        messageSummary: "Send the currently focused Gmail draft",
        riskTier: "high",
        plannedSteps: actions.map((a) => a.label),
      },
    };
  }

  const slackOpen = actions.some((action) => action.type === "desktop_open_app" && action.app.toLowerCase().includes("slack"));
  const discordOpen = actions.some((action) => action.type === "desktop_open_app" && action.app.toLowerCase().includes("discord"));
  const chatContact = actions.find(
    (action): action is Extract<DesktopActionLike, { type: "desktop_type_text" }> =>
      action.type === "desktop_type_text" && /find contact in (slack|discord):/i.test(action.label)
  );
  const chatMessage = actions.find(
    (action): action is Extract<DesktopActionLike, { type: "desktop_type_text" }> =>
      action.type === "desktop_type_text" && /type message in (slack|discord) to /i.test(action.label)
  );
  const slackSend = actions.some((action) => action.type === "desktop_press_key" && /send message in slack/i.test(action.label));
  const discordSend = actions.some((action) => action.type === "desktop_press_key" && /send message in discord/i.test(action.label));
  if ((slackOpen || discordOpen) && chatContact && chatMessage && (slackSend || discordSend)) {
    const app = slackOpen ? "Slack" : "Discord";
    const appLower = app.toLowerCase();
    return {
      executionText: {
        startMessage: `${app} message flow started. Looking for ${chatContact.text} and preparing your message.`,
        successMessage: `${app} steps completed. If the conversation opened correctly, the message has been sent.`,
        failureMessage: `I could not finish the ${appLower} message flow. Check that ${app} is open, the conversation exists, and the correct chat is focused.`,
      },
      verificationHints: {
        appAliases: {
          [appLower]: app === "Slack" ? ["slack", "Slack"] : ["discord", "Discord"],
        },
        focusTargets: app === "Slack" ? ["slack", "Slack"] : ["discord", "Discord"],
      },
      approvalPreview: {
        app,
        appIcon: app === "Slack" ? "#" : "◈",
        recipient: chatContact.text,
        messageSummary: chatMessage.text.length > 100 ? chatMessage.text.slice(0, 100) + "…" : chatMessage.text,
        riskTier: "high",
        plannedSteps: actions.map((a) => a.label),
      },
    };
  }

  return null;
}
