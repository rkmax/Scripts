#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write

interface ProcessInfo {
  pid: number;
  ppid: number;
  command: string;
  args: string;
  cwd: string;
  executable: string;
}

interface ProcessGroup {
  key: string;
  cwd: string;
  executable: string;
  processes: ProcessInfo[];
}

async function getNodeProcesses(): Promise<ProcessInfo[]> {
  const processes: ProcessInfo[] = [];

  // Get all node processes with detailed info
  const psCommand = new Deno.Command("ps", {
    args: ["aux"],
  });

  const psOutput = await psCommand.output();
  const psText = new TextDecoder().decode(psOutput.stdout);
  const lines = psText.split("\n");

  // Get PIDs of node processes
  const nodePids: number[] = [];
  for (const line of lines) {
    if (line.includes("node ") && !line.includes("grep")) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[1]);
      if (!isNaN(pid)) {
        nodePids.push(pid);
      }
    }
  }

  // Get detailed info for each node process
  for (const pid of nodePids) {
    try {
      // Get process info including cwd
      const lsofCommand = new Deno.Command("lsof", {
        args: ["-p", pid.toString(), "-Fn", "-a", "-d", "cwd"],
      });
      const lsofOutput = await lsofCommand.output();
      const lsofText = new TextDecoder().decode(lsofOutput.stdout);

      let cwd = "";
      const cwdMatch = lsofText.match(/n(.+)/);
      if (cwdMatch) {
        cwd = cwdMatch[1];
      }

      // Get full command line
      const psDetailCommand = new Deno.Command("ps", {
        args: ["-p", pid.toString(), "-o", "pid,ppid,comm,args", "-ww"],
      });
      const psDetailOutput = await psDetailCommand.output();
      const psDetailText = new TextDecoder().decode(psDetailOutput.stdout);
      const psLines = psDetailText.split("\n");

      if (psLines.length > 1) {
        const parts = psLines[1].trim().split(/\s+/);
        const ppid = parseInt(parts[1]) || 0;
        const executable = parts[2] || "";
        const args = parts.slice(3).join(" ");

        processes.push({
          pid,
          ppid,
          command: executable,
          args,
          cwd: cwd || "unknown",
          executable,
        });
      }
    } catch {
      // Process might have ended, skip it
      continue;
    }
  }

  return processes;
}

function groupProcesses(processes: ProcessInfo[]): ProcessGroup[] {
  const groups = new Map<string, ProcessGroup>();

  for (const process of processes) {
    // Create a group key based on cwd and main executable/script
    let mainScript = "node";
    const argParts = process.args.split(" ");

    // Try to find the main script file
    for (const part of argParts) {
      if (
        part.endsWith(".js") || part.endsWith(".ts") || part.endsWith(".mjs")
      ) {
        mainScript = part.split("/").pop() || part;
        break;
      }
    }

    const groupKey = `${process.cwd}|${mainScript}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        key: groupKey,
        cwd: process.cwd,
        executable: mainScript,
        processes: [],
      });
    }

    groups.get(groupKey)!.processes.push(process);
  }

  return Array.from(groups.values()).sort((a, b) => a.cwd.localeCompare(b.cwd));
}

async function main() {
  console.log("🔍 Scanning for Node.js processes...\n");

  const processes = await getNodeProcesses();

  if (processes.length === 0) {
    console.log("No Node.js processes found.");
    return;
  }

  const groups = groupProcesses(processes);

  console.log(
    `Found ${processes.length} Node.js process(es) in ${groups.length} group(s):\n`,
  );

  let groupIndex = 1;
  for (const group of groups) {
    console.log(`\x1b[36mGroup ${groupIndex}:\x1b[0m ${group.executable}`);
    console.log(`\x1b[90mDirectory:\x1b[0m ${group.cwd}`);
    console.log(`\x1b[90mProcesses:\x1b[0m ${group.processes.length}`);

    // Show process details
    for (const process of group.processes) {
      // Parse the command arguments for better display
      const args = process.args;
      let displayArgs = args;
      
      // Find the main script/entry point
      const scriptMatch = args.match(/([^\s]+\.(js|ts|mjs))/);
      if (scriptMatch) {
        const fullScript = scriptMatch[1];
        const scriptName = fullScript.split('/').pop() || fullScript;
        
        // Replace full path with shortened version, highlighting the script name
        displayArgs = args.replace(fullScript, `\x1b[32m${scriptName}\x1b[0m`);
      }
      
      // Shorten long absolute paths in arguments (keep last 2 directories)
      displayArgs = displayArgs.replace(/\/(?:home|Users)\/[^\/]+\/([^\s]+)/g, (match) => {
        const parts = match.split('/');
        if (parts.length > 4) {
          const relevant = parts.slice(-3).join('/');
          return `\x1b[90m.../${relevant}\x1b[0m`;
        }
        return match;
      });
      
      // Highlight common flags
      displayArgs = displayArgs.replace(/(--?\w+(?:=\S+)?)/g, '\x1b[33m$1\x1b[0m');
      
      console.log(`    \x1b[90mPID ${process.pid}:\x1b[0m ${displayArgs}`);
    }
    console.log();
    groupIndex++;
  }

  // Save groups to temp file for kill command
  const tempFile = "/tmp/node-process-groups.json";
  await Deno.writeTextFile(tempFile, JSON.stringify(groups, null, 2));
  console.log(`\x1b[33mℹ️  Process groups saved to ${tempFile}\x1b[0m`);
  console.log(
    `\x1b[33mℹ️  Use 'kill-node-group' to selectively kill process groups\x1b[0m`,
  );
}

if (import.meta.main) {
  main().catch(console.error);
}
