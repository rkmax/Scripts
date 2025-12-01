#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run=wl-paste,firefox,notify-send

import { paste } from "./wl-clipboard.ts";

const NOTIFY_TITLE = "ChatGPT Template";
const DEFAULT_PROFILE = "julian";

async function notify(message: string, timeout: number = 3000): Promise<void> {
  if (Deno.build.os === "windows") {
    console.log(`${NOTIFY_TITLE}: ${message}`);
    return;
  }

  const args = [
    "-r",
    "417038",
    "-t",
    timeout.toString(),
    NOTIFY_TITLE,
    message,
  ];

  try {
    const cmd = new Deno.Command("notify-send", { args });
    await cmd.output();
  } catch {
    // Notification failures should not break main flow
  }
}

function requireTemplatePath(): string {
  const templatePath = Deno.args[0];
  if (!templatePath) {
    throw new Error("Usage: chatgpt-template.ts <template-file>");
  }
  return templatePath;
}

function getFirefoxProfile(): string | null {
  const envProfile = Deno.env.get("CHATGPT_TEMPLATE_PROFILE");

  if (envProfile !== undefined) {
    const trimmed = envProfile.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return DEFAULT_PROFILE;
}

async function loadTemplate(templatePath: string): Promise<string> {
  const content = await Deno.readTextFile(templatePath);
  const sanitized = content.trim();

  if (!sanitized) {
    throw new Error("Template file is empty.");
  }

  return sanitized;
}

async function readTask(): Promise<string> {
  const clipboardText = (await paste()).trim();

  if (!clipboardText) {
    throw new Error("Clipboard does not contain text.");
  }

  return clipboardText;
}

function buildPrompt(template: string, task: string): string {
  return `Dado el template: ${template} ---\n Llena el template con ${task}`;
}

async function openChatGPT(prompt: string, profile: string | null): Promise<void> {
  const url = new URL("https://chatgpt.com/");
  url.searchParams.set("prompt", prompt);

  const args = profile
    ? ["-P", profile, url.toString()]
    : [url.toString()];

  const command = new Deno.Command("firefox", {
    args,
  });

  const result = await command.output();
  if (!result.success) {
    const errorMessage = new TextDecoder().decode(result.stderr).trim();
    const profileInfo = profile ? ` profile "${profile}"` : "";
    throw new Error(
      `Failed to open Firefox${profileInfo}: ${errorMessage || "unknown error"}`,
    );
  }
}

async function main() {
  const templatePath = requireTemplatePath();

  const [template, task] = await Promise.all([
    loadTemplate(templatePath),
    readTask(),
  ]);

  const prompt = buildPrompt(template, task);
  const profile = getFirefoxProfile();

  await openChatGPT(prompt, profile);

  const profileLabel = profile
    ? `perfil "${profile}"`
    : "perfil predeterminado";
  await notify(`Prompt abierto en Firefox (${profileLabel}).`);
}

if (import.meta.main) {
  main().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await notify(`Error: ${message}`, 5000);
    console.error(message);
    Deno.exit(1);
  });
}
