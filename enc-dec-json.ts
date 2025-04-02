#!/usr/bin/env -S deno run --allow-env --allow-run --allow-read --allow-write

import { parseArgs } from "jsr:@std/cli/parse-args";
import { copy, paste } from "./wl-clipboard.ts";

export async function encodeJSONAsString(): Promise<void> {
  try {
    const clipboardText = await paste();
    const jsonString = JSON.stringify(clipboardText);
    await copy(jsonString);
  } catch (error) {
    console.error("Error:", error);
  }
}

export async function decodeStringAsJSON(): Promise<void> {
  try {
    const clipboardText = await paste();
    const jsonString = JSON.parse(clipboardText);
    await copy(jsonString);
  } catch (error) {
    console.error("Error:", error);
  }
}

async function main() {
  const flags = parseArgs(Deno.args, {
    string: ["action"],
  });

  switch (flags.action) {
    case "decode":
      await decodeStringAsJSON();
      break;
    case "encode":
      await encodeJSONAsString();
      break;
    default:
      throw new Error("Not implemented");
  }
}

if (import.meta.main) {
  main()
    .catch((e) => {
      console.error(e);
    });
}
