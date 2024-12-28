#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read --allow-write

import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

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

async function translate(text: string, systemPrompt: string): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY must be set in your environment");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
    }),
  });

  const data = await response.json();
  return data.choices[0].message.content;
}

function sanitize(text: string): string {
  return text.replace(/\r\n/g, '\n').replace('\r', '');
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

    const sanitizedText = sanitize(textFromClipboard);

    const translatedText = await translate(sanitizedText, systemPrompt);

    await copy(translatedText);
    await notify("Translation copied to clipboard.", 5000);
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
