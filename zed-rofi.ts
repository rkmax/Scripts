#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read --allow-write

import { EditorProvider, EditorRofi, Entry } from "./editor-rofi.ts";

class ZedProvider implements EditorProvider {
  name = "Zed";
  private home: string;
  private xdgDataHome: string;
  private zedDbPath: string;

  constructor() {
    this.home = Deno.env.get("HOME") ?? "";
    this.xdgDataHome = Deno.env.get("XDG_DATA_HOME") ??
      `${this.home}/.local/share`;
    this.zedDbPath = `${this.xdgDataHome}/zed/db/0-stable/db.sqlite`;
  }

  getExecutableCommand(): string {
    return "zeditor";
  }

  async getRecentEntries(): Promise<Entry[]> {
    const entries: Entry[] = [];

    try {
      // Use sqlite3 command for better compatibility with WAL mode
      const workspacesCmd = new Deno.Command("sqlite3", {
        args: [
          this.zedDbPath,
          `SELECT
            w.workspace_id,
            w.local_paths_array,
            w.timestamp,
            CASE
              WHEN w.ssh_project_id IS NOT NULL THEN 'ssh'
              WHEN w.dev_server_project_id IS NOT NULL THEN 'devserver'
              ELSE 'folder'
            END as type,
            COALESCE(
              s.host || ':' || s.paths,
              d.dev_server_name || ':' || d.path,
              NULL
            ) as display_name
          FROM workspaces w
          LEFT JOIN ssh_projects s ON w.ssh_project_id = s.id
          LEFT JOIN dev_server_projects d ON w.dev_server_project_id = d.id
          WHERE w.local_paths_array IS NOT NULL AND w.local_paths_array != ''
             OR w.ssh_project_id IS NOT NULL
             OR w.dev_server_project_id IS NOT NULL
          ORDER BY w.timestamp DESC
          LIMIT 15;`,
        ],
        stdout: "piped",
      });

      const workspacesOutput = await workspacesCmd.output();
      const workspacesText = new TextDecoder().decode(workspacesOutput.stdout);
      const workspaceLines = workspacesText.split("\n").filter((line) =>
        line.trim()
      );

      for (const line of workspaceLines) {
        const parts = line.split("|");
        if (parts.length >= 3) {
          const [workspaceId, path, timestamp, type = "folder", displayName] =
            parts;
          if (path && path.trim()) {
            entries.push({
              workspaceId: parseInt(workspaceId),
              path: path.trim(),
              timestamp,
              type: type as Entry["type"],
              displayName: displayName?.trim(),
            });
          }
        }
      }

      // Also get recently opened files
      const filesCmd = new Deno.Command("sqlite3", {
        args: [
          this.zedDbPath,
          `SELECT DISTINCT
            e.buffer_path,
            w.timestamp
          FROM editors e
          JOIN workspaces w ON e.workspace_id = w.workspace_id
          WHERE e.buffer_path IS NOT NULL
            AND e.buffer_path != ''
            AND e.buffer_path NOT LIKE '%.git%'
          ORDER BY w.timestamp DESC
          LIMIT 10;`,
        ],
        stdout: "piped",
      });

      const filesOutput = await filesCmd.output();
      const filesText = new TextDecoder().decode(filesOutput.stdout);
      const fileLines = filesText.split("\n").filter((line) => line.trim());

      for (const line of fileLines) {
        const parts = line.split("|");
        if (parts.length >= 1) {
          const [filePath, timestamp] = parts;
          if (filePath && filePath.trim()) {
            entries.push({
              path: filePath.trim(),
              timestamp,
              type: "file",
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error reading Zed database: ${error}`);
    }

    return entries;
  }
}

async function main() {
  const provider = new ZedProvider();
  const editorRofi = new EditorRofi({ provider });
  await editorRofi.run();
}

main();
