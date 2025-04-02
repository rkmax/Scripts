#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read --allow-write

import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";
import { copy, paste } from "./wl-clipboard.ts";

type TranslationProvider = "openai" | "ollama";

const DEFAULT_SYSTEM =
  "Translate any user input into English, in an informal and concise way.";
const DEFAULT_MODEL = "gpt-4o-mini";

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

async function translate(
  text: string,
  systemPrompt: string,
  provider: TranslationProvider = "openai",
): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");

  const specificSystem =
    `${systemPrompt}. Do not include any other explanation`;
  const specificUser = `User: ${text}`;

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
      prompt: `${specificSystem}\n${specificUser}`,
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

    const startTime = performance.now();
    const translatedText = await translate(
      sanitizedText,
      systemPrompt,
      provider,
    );

    const cleanTranslatedText = translatedText.replace(/^"/, "").replace(
      /"$/,
      "",
    );

    const endTime = performance.now();
    const duration = endTime - startTime;

    await copy(cleanTranslatedText);
    await notify(
      `Translation copied to clipboard. Done (${duration.toFixed(4)}ms)`,
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
