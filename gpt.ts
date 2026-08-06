#!/usr/bin/env -S deno run --allow-run --allow-env --allow-read --allow-write --allow-net

const home = Deno.env.get("HOME") || "";
const targetScript = `${home}/Development/Personal/shell-command-lab/src/command_assistant.ts`;

async function main() {
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(targetScript);
  } catch {
    throw new Error(
      `Missing command assistant script at ${targetScript}.`,
    );
  }

  if (!stat.isFile) {
    throw new Error(`Target path is not a file: ${targetScript}`);
  }

  const proc = new Deno.Command(targetScript, {
    args: Deno.args,
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();

  const status = await proc.status;
  if (!status.success) {
    Deno.exit(status.code);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    Deno.exit(1);
  }
}
