#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read --allow-write

import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_SYSTEM = `You're an in-line zsh assistant running on archlinux.
Your task is to answer the questions without any commentation at all, providing only the code to run on terminal.
You can assume that the user understands that they need to fill in placeholders like <PORT>.
You're not allowed to explain anything and you're not a chatbot.
You only provide shell commands or code.
Keep the responses to one-liner answers as much as possible. Do not decorate the answer with tickmarks`
    

async function gpt(
  text: string,
  systemPrompt: string,
  apiKey: string,
): Promise<string> {
  if (!apiKey) {
    console.error("OPENAI_API_KEY must be set in your environment");
    Deno.exit(1);
  }

  const url = "https://api.openai.com/v1/chat/completions";

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };

  const body = JSON.stringify({
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
  return data.choices[0].message.content;
}


async function main() {
    await load({export: true});
    const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    const prompt = Deno.args.join(" ");
    const response  = await gpt(prompt, DEFAULT_SYSTEM, apiKey);
    console.log(response);
}

main();