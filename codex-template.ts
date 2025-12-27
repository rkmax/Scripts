#!/usr/bin/env -S deno run --allow-read --allow-env --allow-run=wl-paste,wl-copy,codex,notify-send

import { copy, paste } from "./wl-clipboard.ts";

const NOTIFY_TITLE = "Codex Template";
const DEFAULT_MODEL = "gpt-5.1";
const MODEL_ENV_VAR = "CODEX_TEMPLATE_MODEL";
const DEFAULT_REASONING = "high";
const REASONING_ENV_VAR = "CODEX_TEMPLATE_REASONING";

async function notify(message: string, timeout: number = 3000): Promise<void> {
  if (Deno.build.os === "windows") {
    console.log(`${NOTIFY_TITLE}: ${message}`);
    return;
  }

  const args = [
    "-r",
    "417039",
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
    throw new Error("Usage: codex-template.ts <template-file>");
  }
  return templatePath;
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

function extractPlaceholders(template: string): string[] {
  const regex = /\{\{([^{}]+)\}\}/g;
  const placeholders = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    const name = match[1].trim();
    if (name.length > 0) {
      placeholders.add(name);
    }
  }

  return Array.from(placeholders);
}

function buildPrompt(template: string, task: string): string {
  const placeholders = extractPlaceholders(template);
  const placeholdersSection = placeholders.length > 0
    ? `Placeholders to fill (write concise English for each):\n- ${placeholders.join("\n- ")}`
    : "No explicit placeholders detected; still cover any implicit gaps using the user input.";

  return [
    "You are an assistant that outputs a completed template in English using the user input provided below.",
    "Strict output rules:",
    "- Do not create a plan, checklist, or commentary.",
    "- Keep only the structure and headings from the template; do not add new sections.",
    "- Replace every placeholder with concrete content and remove all {{...}} tokens.",
    "- If the input lacks details for a placeholder, make a brief, reasonable fill based on context.",
    "- Return only the filled template text and nothing else.",
    "",
    "Template:",
    "'''",
    template,
    "'''",
    "",
    placeholdersSection,
    "",
    "User input:",
    task,
  ].join("\n");
}

function resolveModel(): string {
  const envModel = Deno.env.get(MODEL_ENV_VAR);
  if (envModel !== undefined) {
    const trimmed = envModel.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return DEFAULT_MODEL;
}

function resolveReasoningEffort(): string {
  const envReasoning = Deno.env.get(REASONING_ENV_VAR);
  if (envReasoning !== undefined) {
    const trimmed = envReasoning.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return DEFAULT_REASONING;
}

async function runCodex(prompt: string, model: string): Promise<string> {
  const reasoningEffort = resolveReasoningEffort();
  const command = new Deno.Command("codex", {
    args: [
      "exec",
      "--model",
      model,
      "-c",
      `model_reasoning_effort="${reasoningEffort}"`,
      "--skip-git-repo-check",
      "--color",
      "never",
      "-",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });

  let process: Deno.ChildProcess;
  try {
    process = command.spawn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to start codex command: ${message}`);
  }
  const writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(prompt));
  await writer.close();

  const { success, stdout, stderr } = await process.output();

  if (!success) {
    const errorMessage = new TextDecoder().decode(stderr).trim();
    const detail = errorMessage ? `: ${errorMessage}` : "";
    throw new Error(`codex exec failed${detail}`);
  }

  return new TextDecoder().decode(stdout).trim();
}

async function main() {
  const templatePath = requireTemplatePath();

  const [template, task] = await Promise.all([
    loadTemplate(templatePath),
    readTask(),
  ]);

  const prompt = buildPrompt(template, task);
  const model = resolveModel();
  const response = await runCodex(prompt, model);

  await copy(response);
  console.log(response);
  await notify("OK");
}

if (import.meta.main) {
  main().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await notify(`Error: ${message}`, 5000);
    console.error(message);
    Deno.exit(1);
  });
}
