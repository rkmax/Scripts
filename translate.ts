#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read --allow-write

import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";
import { copy, paste } from "./wl-clipboard.ts";

type Provider = "openai" | "local";

interface ProviderConfig {
  baseUrl: string;
  model: string;
  apiKeyEnv?: string;
  reasoningEffort?: string;
}

// Both providers speak the OpenAI chat completions protocol.
// `local` is the llama.cpp router (llama-server.service) with Qwen3.5 loaded.
const PROVIDERS: Record<Provider, ProviderConfig> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.4-mini",
    apiKeyEnv: "OPENAI_API_KEY",
    // gpt-5.x reasons by default; a rewrite does not need it and it adds latency.
    reasoningEffort: "none",
  },
  local: {
    baseUrl: "http://127.0.0.1:8080/v1",
    model: "qwen3.5-9b",
  },
};

const DEFAULT_SYSTEM =
  "Translate any user input into English, in an informal and concise way.";

// Named prompts selected with `--mode <name>`. Keeping them here (instead of in
// the StreamDeck command line) keeps them versioned and readable.
export const MODES: Record<string, string> = {
  slack: `You clean up Slack messages I write at work. I am a software engineer writing to teammates and peers; the register is direct, informal, and technical.

The input is one message. It may be in English, in Spanish, or mixed.

Do exactly this:
- If a part is in Spanish, write it the way a native English-speaking engineer would say the same thing in Slack. Match the meaning and the tone, not the literal words. Drop what is natural in Spanish but redundant in English (courtesy padding, repeated subjects, over-explaining).
- If a part is already in English, fix only grammar, spelling, and phrasing that sounds off. Keep my wording wherever it already works.
- In both cases, cut repetition and filler without dropping any information.

Rules:
- Keep my tone and level of directness. Do not make it more formal, softer, or more polite than I wrote it.
- Do not add information, hedging, greetings, sign-offs, or explanations.
- Keep shorthand as shorthand (FYI, wdym, PR, prod, LGTM). Keep @mentions, links, code, emoji, and line breaks or bullets as they are.
- Capitalize people and product names (Dongsam, Slack, GitHub) even if I typed them lowercase.
- If something is ambiguous, keep it as I wrote it instead of guessing.
- Same length as the input or shorter.

Output only the final message. No quotes, no commentary.`,
};

async function notify(message: string, timeout: number = 2000): Promise<void> {
  if (Deno.build.os === "windows") {
    console.log(message);
  } else {
    const args = [
      "-r",
      "417037",
      "-t",
      timeout.toString(),
      "Translate",
      message,
    ];
    const cmd = new Deno.Command("notify-send", { args });
    await cmd.output();
  }
}

export function resolveProvider(): { provider: Provider; config: ProviderConfig } {
  const name = (Deno.env.get("TRANSLATE_PROVIDER") || "openai") as Provider;
  const base = PROVIDERS[name];
  if (!base) {
    throw new Error(
      `Unknown TRANSLATE_PROVIDER "${name}". Use one of: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  const model = Deno.env.get("TRANSLATE_MODEL") || base.model;
  return { provider: name, config: { ...base, model } };
}

export function resolveSystemPrompt(args: string[]): string {
  const modeIndex = args.indexOf("--mode");
  if (modeIndex !== -1) {
    const mode = args[modeIndex + 1];
    const prompt = mode ? MODES[mode] : undefined;
    if (!prompt) {
      throw new Error(
        `Unknown mode "${mode ?? ""}". Available: ${Object.keys(MODES).join(", ")}`,
      );
    }
    return prompt;
  }
  return args.length > 0 ? args.join(" ") : DEFAULT_SYSTEM;
}

export async function translate(
  text: string,
  systemPrompt: string,
  config: ProviderConfig,
): Promise<string> {
  const apiKey = config.apiKeyEnv ? Deno.env.get(config.apiKeyEnv) : undefined;
  if (config.apiKeyEnv && !apiKey) {
    throw new Error(`${config.apiKeyEnv} must be set in your environment`);
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      ...(config.reasoningEffort
        ? { reasoning_effort: config.reasoningEffort }
        : {}),
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const detail = data?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`${config.model}: ${detail}`);
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`${config.model}: empty response`);
  }
  return content;
}

function sanitize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace("\r", "");
}

async function main() {
  const homeDir = Deno.env.get("HOME");
  if (!homeDir) {
    throw new Error("HOME environment variable must be set");
  }
  await load({ export: true, envPath: `${homeDir}/.env` });

  try {
    const systemPrompt = resolveSystemPrompt(Deno.args);
    const { config } = resolveProvider();

    await notify(`Translating clipboard text (${config.model})...`);

    const textFromClipboard = await paste();
    if (!textFromClipboard) {
      throw new Error("No text found in clipboard.");
    }

    const sanitizedText = sanitize(textFromClipboard);

    const startTime = performance.now();
    const translatedText = await translate(sanitizedText, systemPrompt, config);

    const cleanTranslatedText = translatedText.trim().replace(/^"/, "").replace(
      /"$/,
      "",
    );

    const duration = (performance.now() - startTime) / 1000;

    await copy(cleanTranslatedText);
    await notify(
      `Translation copied to clipboard. Done in ${duration.toFixed(1)}s (${config.model})`,
      5000,
    );
  } catch (error) {
    if (error instanceof Error) {
      await notify(`Error: ${error.message}`);
    } else {
      throw error;
    }
  }
}

if (import.meta.main) {
  main();
}
