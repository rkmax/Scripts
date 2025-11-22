#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read --allow-write

import { EditorRofi, EditorProvider, Entry } from "./editor-rofi.ts";
import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

class VSCodeProvider implements EditorProvider {
  name = "VSCode";
  private home: string;
  private vscdbPath: string;

  constructor() {
    this.home = Deno.env.get("HOME") ?? "";
    this.vscdbPath = `${this.home}/.config/Code/User/globalStorage/state.vscdb`;
  }

  getExecutableCommand(): string {
    return "code";
  }

  getRecentEntries(): Entry[] {
    const db = new DB(this.vscdbPath);
    const query = "SELECT value FROM ItemTable WHERE key='history.recentlyOpenedPathsList';";
    const results = db.query<string[]>(query);
    db.close();

    const entries = results.flatMap((row) => JSON.parse(row[0]).entries);
    return entries.map((entry) => {
      if (entry.folderUri) {
        return {
          path: this.preparePath(entry.folderUri),
          type: "folder",
        };
      } else if (entry.fileUri) {
        return {
          path: this.preparePath(entry.fileUri),
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

  private preparePath(path: string): string {
    const withoutPrefix = path.replace(/^file:\/\//, "");
    return decodeURIComponent(withoutPrefix);
  }

  // Override file icon method to use simpler icons for VSCode
  getFileIcon(_extension?: string): string {
    return "gtk-file";
  }
}

async function main() {
  const provider = new VSCodeProvider();
  const editorRofi = new EditorRofi({ provider, maxEntries: 100 });
  await editorRofi.run();
}

main();
