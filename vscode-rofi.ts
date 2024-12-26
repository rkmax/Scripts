#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read --allow-write

import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

const home = Deno.env.get("HOME") ?? "";
const vscdbPath = `${home}/.config/Code/User/globalStorage/state.vscdb`;

function getRecentEntries(): Entry[] {
  const db = new DB(vscdbPath);
  const query =
    "SELECT value FROM ItemTable WHERE key='history.recentlyOpenedPathsList';";
  const results = db.query<string[]>(query);
  db.close();

  const entries = results.flatMap((row) => JSON.parse(row[0]).entries);
  return entries.map((entry) => {
    if (entry.folderUri) {
      return {
        path: preparePath(entry.folderUri),
        type: "folder",
      };
    } else if (entry.fileUri) {
      return {
        path: preparePath(entry.fileUri),
        type: "file",
      };
    } else if (entry.workspace?.configPath) {
      return {
        type: "workspace",
        path: decodeURIComponent(entry.workspace.configPath),
      };
    }
    return null;
  }).filter(Boolean) as Entry[];
}

function preparePath(path: string): string {
  const withoutPrefix = path.replace(/^file:\/\//, "");
  return decodeURIComponent(withoutPrefix);
}

function executeCode(path: string): void {
  const command = new Deno.Command("code", {
    args: [path],
  });

  command.spawn();
}

type Entry = {
  type: string;
  path: string;
};

type RofiEntry = {
  name: string;
  icon?: string;
  info?: boolean;
  urgent?: boolean;
  active?: boolean;
  markupRows?: boolean;
};

function generateRofiEntry(entry: RofiEntry): string {
  const parts: string[] = [];

  if (entry.icon) {
    parts.push("icon");
    parts.push(entry.icon);
  }

  parts.push("display");
  parts.push(entry.name.replace(home, "~"));

  const line = parts.join("\x1f");
  return `${entry.name}\0${line}\n`;
}

function getRecentEntriesFmt() {
  const entries = getRecentEntries();
  for (const entry of entries) {
    const rofiEntry = generateRofiEntry({
      name: entry.path,
      icon: entry.type === "file" ? "gtk-file" : "folder",
    });
    console.log(`${rofiEntry}\n`);
  }
}

function main() {
  const rofiRev = parseInt(Deno.env.get("ROFI_RETV") ?? "0");
  const args = Deno.args;

  switch (rofiRev) {
    case 0:
      getRecentEntriesFmt();
      break;
    case 1:
      executeCode(args[0]);
      break;
  }
}

main();
