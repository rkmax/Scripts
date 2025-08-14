#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read --allow-write

import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

const home = Deno.env.get("HOME") ?? "";
const xdgDataHome = Deno.env.get("XDG_DATA_HOME") ?? `${home}/.local/share`;
const zedDbPath = `${xdgDataHome}/zed/db/0-stable/db.sqlite`;

type Entry = {
  type: "folder" | "file" | "ssh" | "devserver";
  path: string;
  timestamp?: string;
  workspaceId?: number;
  displayName?: string;
};

type RofiEntry = {
  name: string;
  icon?: string;
  info?: boolean;
  urgent?: boolean;
  active?: boolean;
  markupRows?: boolean;
};

async function getRecentEntries(): Promise<Entry[]> {
  const entries: Entry[] = [];
  
  try {
    // Use sqlite3 command for better compatibility with WAL mode
    const workspacesCmd = new Deno.Command("sqlite3", {
      args: [
        zedDbPath,
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
        LIMIT 15;`
      ],
      stdout: "piped",
    });
    
    const workspacesOutput = await workspacesCmd.output();
    const workspacesText = new TextDecoder().decode(workspacesOutput.stdout);
    const workspaceLines = workspacesText.split('\n').filter(line => line.trim());
    
    for (const line of workspaceLines) {
      const parts = line.split('|');
      if (parts.length >= 3) {
        const [workspaceId, path, timestamp, type = 'folder', displayName] = parts;
        if (path && path.trim()) {
          entries.push({
            workspaceId: parseInt(workspaceId),
            path: path.trim(),
            timestamp,
            type: type as Entry["type"],
            displayName: displayName?.trim()
          });
        }
      }
    }
    
    // Also get recently opened files
    const filesCmd = new Deno.Command("sqlite3", {
      args: [
        zedDbPath,
        `SELECT DISTINCT 
          e.buffer_path,
          w.timestamp
        FROM editors e
        JOIN workspaces w ON e.workspace_id = w.workspace_id
        WHERE e.buffer_path IS NOT NULL 
          AND e.buffer_path != ''
          AND e.buffer_path NOT LIKE '%.git%'
        ORDER BY w.timestamp DESC
        LIMIT 10;`
      ],
      stdout: "piped",
    });
    
    const filesOutput = await filesCmd.output();
    const filesText = new TextDecoder().decode(filesOutput.stdout);
    const fileLines = filesText.split('\n').filter(line => line.trim());
    
    for (const line of fileLines) {
      const parts = line.split('|');
      if (parts.length >= 1) {
        const [filePath, timestamp] = parts;
        if (filePath && filePath.trim()) {
          entries.push({
            path: filePath.trim(),
            timestamp,
            type: "file"
          });
        }
      }
    }
    
  } catch (error) {
    console.error(`Error reading Zed database: ${error}`);
  }
  
  return entries;
}

function generateRofiEntry(entry: RofiEntry): string {
  const parts: string[] = [];
  
  if (entry.icon) {
    parts.push("icon");
    parts.push(entry.icon);
  }
  
  // Replace home directory with ~ for display
  const displayName = entry.name.replace(home, "~");
  parts.push("display");
  parts.push(displayName);
  
  const line = parts.join("\x1f");
  return `${entry.name}\0${line}`;
}

function executeZed(path: string): void {
  // Launch Zed with the selected project path
  const command = new Deno.Command("zed", {
    args: [path],
    stdout: "null",
    stderr: "null",
  });
  
  command.spawn();
}

async function formatRecentEntries(): Promise<void> {
  const entries = await getRecentEntries();
  
  if (entries.length === 0) {
    console.log("No recent entries found\n");
    return;
  }
  
  // Remove duplicates, keeping the most recent occurrence
  const uniquePaths = new Map<string, Entry>();
  for (const entry of entries) {
    if (!uniquePaths.has(entry.path)) {
      uniquePaths.set(entry.path, entry);
    }
  }
  
  // Sort entries: folders first, then files
  const sortedEntries = Array.from(uniquePaths.values()).sort((a, b) => {
    // Type priority: folder > ssh > devserver > file
    const typePriority = { folder: 0, ssh: 1, devserver: 2, file: 3 };
    const priorityDiff = typePriority[a.type] - typePriority[b.type];
    if (priorityDiff !== 0) return priorityDiff;
    
    // Then sort by timestamp if available
    if (a.timestamp && b.timestamp) {
      return b.timestamp.localeCompare(a.timestamp);
    }
    return 0;
  });
  
  // Output formatted entries for Rofi
  for (const entry of sortedEntries) {
    // Choose appropriate icon based on type
    let icon = "folder";
    if (entry.type === "file") {
      // Determine file icon based on extension
      const ext = entry.path.split('.').pop()?.toLowerCase();
      icon = getFileIcon(ext);
    } else if (entry.type === "ssh") {
      icon = "network-server";
    } else if (entry.type === "devserver") {
      icon = "network-workgroup";
    }
    
    // Use display name for remote projects, path for local
    const displayPath = entry.displayName || entry.path;
    
    const rofiEntry = generateRofiEntry({
      name: displayPath,
      icon: icon,
    });
    console.log(rofiEntry);
  }
}

function getFileIcon(extension?: string): string {
  if (!extension) return "gtk-file";
  
  const iconMap: Record<string, string> = {
    // Code files
    "ts": "text-x-typescript",
    "tsx": "text-x-typescript", 
    "js": "text-x-javascript",
    "jsx": "text-x-javascript",
    "py": "text-x-python",
    "rs": "text-x-rust",
    "go": "text-x-go",
    "java": "text-x-java",
    "c": "text-x-c",
    "cpp": "text-x-c++",
    "h": "text-x-c",
    "hpp": "text-x-c++",
    "cs": "text-x-csharp",
    "php": "text-x-php",
    "rb": "text-x-ruby",
    "swift": "text-x-swift",
    
    // Web files
    "html": "text-html",
    "css": "text-css",
    "scss": "text-css",
    "sass": "text-css",
    "less": "text-css",
    
    // Config files
    "json": "application-json",
    "yaml": "text-yaml",
    "yml": "text-yaml",
    "toml": "text-toml",
    "xml": "text-xml",
    "ini": "text-x-ini",
    "conf": "text-x-ini",
    "env": "text-x-ini",
    
    // Script files
    "sh": "text-x-script",
    "bash": "text-x-script",
    "zsh": "text-x-script",
    "fish": "text-x-script",
    "ps1": "text-x-script",
    "bat": "text-x-script",
    
    // Documentation
    "md": "text-markdown",
    "rst": "text-x-readme",
    "txt": "text-plain",
    
    // Data files
    "sql": "text-x-sql",
    "csv": "text-csv",
    
    // Other
    "dockerfile": "text-dockerfile",
    "makefile": "text-x-makefile",
    "gitignore": "text-x-generic",
  };
  
  return iconMap[extension] || "gtk-file";
}

async function main() {
  const rofiRetv = parseInt(Deno.env.get("ROFI_RETV") ?? "0");
  const args = Deno.args;
  
  switch (rofiRetv) {
    case 0:
      // Initial call - display the list
      await formatRecentEntries();
      break;
    case 1:
      // User selected an entry - open in Zed
      if (args.length > 0) {
        executeZed(args[0]);
      }
      break;
  }
}

main();