#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read --allow-write

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
export async function convertToValidJSON(): Promise<void> {
  try {
    const clipboardText = await paste();
    const jsonString = JSON.stringify(clipboardText);
    await copy(jsonString);

  } catch (error) {
    console.error("Error:", error);
  }
}

convertToValidJSON();
