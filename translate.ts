#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read --allow-write

import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

type TranslationProvider = "openai" | "ollama";

export async function copy(text: string): Promise<void> {
  const cmd = new Deno.Command("wl-copy", {
    stdin: "piped",
  });
  const process = cmd.spawn();
  const writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(text));
  await writer.close();
  const status = await process.status;
  if (!status.success) {
    throw new Error("Failed to copy to clipboard");
  }
}

export async function paste(): Promise<string> {
  const cmd = new Deno.Command("wl-paste", {
    args: ["-n"],
    stdout: "piped",
  });
  const process = cmd.spawn();
  const output = await process.output();
  const status = await process.status;
  if (!status.success) {
    throw new Error("Failed to paste from clipboard");
  }
  return new TextDecoder().decode(output.stdout);
}

const DEFAULT_SYSTEM =
  "Translate any user input into English, in an informal and concise way.";
const DEFAULT_MODEL = "gpt-4o-mini";

async function notify(message: string, timeout: number = 2000): Promise<void> {
  if (Deno.build.os === "windows") {
    console.log(message);
  } else {
    const args = ["-t", timeout.toString(), "Translate", message];
    const cmd = new Deno.Command("notify-send", { args });
    await cmd.output();
  }
}

async function translate(
  text: string,
  systemPrompt: string,
  provider: TranslationProvider = "openai",
): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");

  const specificSystem = `${systemPrompt}. Do not include any other explanation`;

  if (provider === "openai" && !apiKey) {
    throw new Error("OPENAI_API_KEY must be set in your environment");
  }

  const url = provider === "ollama"
    ? "http://localhost:11434/api/generate"
    : "https://api.openai.com/v1/chat/completions";

  const headers = {
    "Content-Type": "application/json",
    ...(provider === "ollama" ? {} : {
      "Authorization": `Bearer ${apiKey}`,
    }),
  };

  const body = provider === "ollama"
    ? JSON.stringify({
      prompt: `${specificSystem}\n${text}`,
      model: "llama3.1:8b",
      stream: false,
    })
    : JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
    });

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
  });

  const data = await response.json();
  if (provider === "ollama") {
    return data.response;
  }
  return data.choices[0].message.content;
}

function sanitize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace("\r", "");
}

async function main() {
  await load({ export: true });

  try {
    const systemPrompt = Deno.args.length > 0
      ? Deno.args.join(" ")
      : DEFAULT_SYSTEM;

    await notify("Translating clipboard text...");

    const textFromClipboard = await paste();
    if (!textFromClipboard) {
      throw new Error("No text found in clipboard.");
    }

    const provider: TranslationProvider =
      Deno.env.get("TRANSLATE_PROVIDER") as TranslationProvider || "openai";
    const sanitizedText = sanitize(textFromClipboard);

    const translatedText = await translate(
      sanitizedText,
      systemPrompt,
      provider,
    );

    await copy(translatedText);
    await notify("Translation copied to clipboard.", 5000);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.stack || error.message);
      await notify(`Error: ${error.message}`);
    } else {
      throw error;
    }
  }
}

if (import.meta.main) {
  main();
}
