#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run

import { load } from "jsr:@std/dotenv";
import { copy, paste } from "./wl-clipboard.ts";

async function makeRawRequest(
  apiKey: string,
  requestPayload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = "https://api.openai.com/v1/chat/completions";

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(requestPayload),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

async function main() {
  await load({ export: true });
  const apiKey = Deno.env.get("OPENAI_API_KEY") || "";

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set.");
  }

  try {
    // Read request payload from clipboard
    const clipboardContent = await paste();
    
    if (!clipboardContent.trim()) {
      throw new Error("No content found in clipboard.");
    }

    // Parse the JSON payload from clipboard
    let requestPayload: Record<string, unknown>;
    try {
      requestPayload = JSON.parse(clipboardContent);
    } catch {
      throw new Error("Invalid JSON in clipboard. Please copy a valid OpenAI API request payload.");
    }

    // Make the raw request
    const response = await makeRawRequest(apiKey, requestPayload);
    
    // Copy the raw response back to clipboard
    await copy(JSON.stringify(response, null, 2));
    
    console.log("✓ Request sent and response copied to clipboard");
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    } else {
      console.error("Unknown error occurred");
    }
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}