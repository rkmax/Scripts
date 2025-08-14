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

async function loadProcessGroups(): Promise<ProcessGroup[]> {
  const tempFile = "/tmp/node-process-groups.json";
  try {
    const content = await Deno.readTextFile(tempFile);
    return JSON.parse(content);
  } catch (error) {
    console.error("❌ No process groups found. Run 'node-processes' first.");
    Deno.exit(1);
  }
}

async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    const command = new Deno.Command("ps", {
      args: ["-p", pid.toString()],
      stdout: "piped",
      stderr: "null",
    });
    const output = await command.output();
    return output.success;
  } catch {
    return false;
  }
}

async function killProcess(pid: number, signal: string = "TERM"): Promise<boolean> {
  try {
    const command = new Deno.Command("kill", {
      args: [`-${signal}`, pid.toString()],
    });
    const output = await command.output();
    return output.success;
  } catch {
    return false;
  }
}

async function killProcessGroup(group: ProcessGroup, force: boolean = false) {
  const signal = force ? "KILL" : "TERM";
  let killedCount = 0;
  let failedCount = 0;
  
  console.log(`\n🎯 Killing processes in group: ${group.executable} (${group.cwd})`);
  console.log(`   Using signal: ${signal}`);
  
  for (const process of group.processes) {
    // Check if process is still running
    if (await isProcessRunning(process.pid)) {
      const success = await killProcess(process.pid, signal);
      if (success) {
        console.log(`   ✅ Killed PID ${process.pid}`);
        killedCount++;
      } else {
        console.log(`   ❌ Failed to kill PID ${process.pid}`);
        failedCount++;
      }
    } else {
      console.log(`   ⚠️  PID ${process.pid} is no longer running`);
    }
  }
  
  console.log(`   Summary: ${killedCount} killed, ${failedCount} failed`);
}

async function selectGroups(groups: ProcessGroup[]): Promise<number[]> {
  console.log("\n📋 Available process groups:\n");
  
  let groupIndex = 1;
  for (const group of groups) {
    console.log(`  ${groupIndex}. \x1b[36m${group.executable}\x1b[0m`);
    console.log(`     Directory: ${group.cwd}`);
    console.log(`     Processes: ${group.processes.length}`);
    
    // Show detailed process info similar to node-processes.ts
    for (const process of group.processes) {
      const args = process.args;
      let displayArgs = args;
      
      // Find the main script/entry point
      const scriptMatch = args.match(/([^\s]+\.(js|ts|mjs))/);
      if (scriptMatch) {
        const fullScript = scriptMatch[1];
        const scriptName = fullScript.split('/').pop() || fullScript;
        displayArgs = args.replace(fullScript, `\x1b[32m${scriptName}\x1b[0m`);
      }
      
      // Shorten long absolute paths in arguments
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
      
      console.log(`       \x1b[90mPID ${process.pid}:\x1b[0m ${displayArgs}`);
    }
    
    console.log();
    groupIndex++;
  }
  
  console.log("Enter group numbers to kill (comma-separated), 'all' for all groups, or 'q' to quit:");
  
  const input = prompt("> ");
  
  if (!input || input.toLowerCase() === "q") {
    console.log("Cancelled.");
    return [];
  }
  
  if (input.toLowerCase() === "all") {
    return groups.map((_, index) => index + 1);
  }
  
  const selected = input.split(",")
    .map(s => parseInt(s.trim()))
    .filter(n => !isNaN(n) && n >= 1 && n <= groups.length);
  
  return selected;
}

async function main() {
  const args = Deno.args;
  const force = args.includes("--force") || args.includes("-f");
  const yes = args.includes("--yes") || args.includes("-y");
  const groupNumbers = args.filter(arg => !arg.startsWith("-")).map(n => parseInt(n));
  
  console.log("🔍 Loading process groups...");
  const groups = await loadProcessGroups();
  
  if (groups.length === 0) {
    console.log("No process groups found.");
    return;
  }
  
  let selectedIndices: number[] = [];
  
  if (groupNumbers.length > 0) {
    // Use command line arguments
    selectedIndices = groupNumbers.filter(n => !isNaN(n) && n >= 1 && n <= groups.length);
  } else {
    // Interactive selection
    selectedIndices = await selectGroups(groups);
  }
  
  if (selectedIndices.length === 0) {
    return;
  }
  
  const selectedGroups = selectedIndices.map(i => groups[i - 1]);
  
  // Show what will be killed
  console.log("\n⚠️  The following process groups will be terminated:");
  for (const group of selectedGroups) {
    console.log(`   - \x1b[36m${group.executable}\x1b[0m in ${group.cwd}`);
    console.log(`     ${group.processes.length} process(es):`);
    for (const process of group.processes) {
      console.log(`     PID ${process.pid}`);
    }
  }
  
  if (!yes) {
    const confirm = prompt("\nAre you sure? (y/N): ");
    if (!confirm || confirm.toLowerCase() !== "y") {
      console.log("Cancelled.");
      return;
    }
  }
  
  // Kill the selected groups
  for (const group of selectedGroups) {
    await killProcessGroup(group, force);
  }
  
  console.log("\n✅ Done!");
}

if (import.meta.main) {
  main().catch(console.error);
}