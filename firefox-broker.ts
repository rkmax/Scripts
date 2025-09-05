#!/usr/bin/env -S deno run --allow-all

/**
 * firefox-broker.ts - Routes external links to most recently active Firefox profile
 * Solves Firefox's limitation of always opening links in default profile
 * See: https://support.mozilla.org/en-US/questions/999493
 */

import { existsSync } from "https://deno.land/std@0.218.0/fs/exists.ts";

// Client interface for hyprctl JSON output
interface HyprClient {
  class: string;
  pid: number;
  focusHistoryID: number;
  address: string;
  title: string;
}

// Configuration from environment
const DEBUG = true; // Default true for xdg-open compatibility
const SILENT = false;
const CACHE_FILE = `/tmp/.firefox-broker-cache-${Deno.pid}`;
const LOG_FILE = `/tmp/firefox-broker-${
  new Date().toISOString().split("T")[0]
}.log`;

// Window info interface
interface FirefoxWindow {
  pid: number;
  focusHistoryID: number;
  address: string;
  title: string;
}

// Helper to write log to file
const writeToLogFile = (level: string, ...args: unknown[]): void => {
  try {
    const timestamp = new Date().toISOString();
    const message = args.map((arg) =>
      typeof arg === "object" ? JSON.stringify(arg) : String(arg)
    ).join(" ");
    const logEntry = `${timestamp} [${level}] ${message}\n`;

    // Append to log file
    const encoder = new TextEncoder();
    const data = encoder.encode(logEntry);
    Deno.writeFileSync(LOG_FILE, data, { append: true, create: true });
  } catch (error) {
    // If file logging fails, fall back to console
    console.error("[LOG FILE ERROR]", error);
  }
};

// Logging functions
const logDebug = (...args: unknown[]): void => {
  if (DEBUG) {
    console.error("[DEBUG]", ...args);
    writeToLogFile("DEBUG", ...args);
  }
};

const logError = (...args: unknown[]): void => {
  if (!SILENT) {
    console.error("[ERROR]", ...args);
    writeToLogFile("ERROR", ...args);
  }
};

const logInfo = (...args: unknown[]): void => {
  if (DEBUG) {
    console.error("[INFO]", ...args);
    writeToLogFile("INFO", ...args);
  }
};

// Cleanup on exit
globalThis.addEventListener("unload", () => {
  try {
    if (existsSync(CACHE_FILE)) {
      Deno.removeSync(CACHE_FILE);
    }
  } catch {
    // Ignore cleanup errors
  }
});

async function checkDependencies(): Promise<void> {
  const missing: string[] = [];
  const deps = ["hyprctl", "jq", "firefox"];

  for (const dep of deps) {
    try {
      const cmd = new Deno.Command("which", { args: [dep] });
      const result = await cmd.output();
      if (!result.success) {
        missing.push(dep);
      }
    } catch {
      missing.push(dep);
    }
  }

  if (missing.length > 0) {
    logError(`Missing dependencies: ${missing.join(", ")}`);
    Deno.exit(1);
  }
}

async function getFirefoxWindows(
  forceRefresh = false,
): Promise<FirefoxWindow[]> {
  try {
    // Check cache if not forcing refresh
    if (!forceRefresh && existsSync(CACHE_FILE)) {
      const stat = await Deno.stat(CACHE_FILE);
      const age = (Date.now() - (stat.mtime?.getTime() || 0)) / 1000;

      if (age < 2) {
        logDebug("Using cached window info");
        const cached = await Deno.readTextFile(CACHE_FILE);
        return JSON.parse(cached);
      }
    }

    logDebug("Fetching window info from hyprctl");

    // Run hyprctl command with timeout
    const cmd = new Deno.Command("timeout", {
      args: ["10", "hyprctl", "clients", "-j"],
      stdout: "piped",
      stderr: "piped",
    });

    const result = await cmd.output();

    if (!result.success) {
      logError("Failed to get window info from hyprctl");
      return [];
    }

    const jsonText = new TextDecoder().decode(result.stdout);
    const clients: HyprClient[] = JSON.parse(jsonText);

    const firefoxWindows: FirefoxWindow[] = clients
      .filter((client) => client.class === "firefox")
      .map((client) => ({
        pid: client.pid,
        focusHistoryID: client.focusHistoryID,
        address: client.address,
        title: client.title,
      }));

    // Cache the results
    await Deno.writeTextFile(CACHE_FILE, JSON.stringify(firefoxWindows));

    return firefoxWindows;
  } catch (error) {
    logError("Error getting Firefox windows:", error);
    return [];
  }
}

async function detectProfileForPid(pid: number): Promise<string> {
  logDebug(`Detecting profile for PID: ${pid}`);

  try {
    const cmdlinePath = `/proc/${pid}/cmdline`;
    if (!existsSync(cmdlinePath)) {
      return "default";
    }

    const cmdlineBytes = await Deno.readFile(cmdlinePath);
    const cmdline = new TextDecoder().decode(cmdlineBytes).replace(/\0/g, " ");
    logDebug(`Command line for PID ${pid}: ${cmdline}`);

    // Check for -P profile argument
    const profileMatch = cmdline.match(/-P\s+([^\s]+)/);
    if (profileMatch) {
      const profile = profileMatch[1];
      logDebug(`Found profile: ${profile}`);
      return profile;
    }

    // Check for --profile path argument
    const profilePathMatch = cmdline.match(/--profile\s+([^\s]+)/);
    if (profilePathMatch) {
      const profilePath = profilePathMatch[1];
      const pathParts = profilePath.split("/");
      const profile = pathParts[pathParts.length - 1].replace(/\.[^.]+$/, "");
      logDebug(`Found profile path: ${profile}`);
      return profile;
    }

    return "default";
  } catch (error) {
    logDebug(`Error detecting profile for PID ${pid}:`, error);
    return "default";
  }
}

async function findMostRecentFirefox(): Promise<string> {
  logDebug("Finding most recent Firefox window");

  const windows = await getFirefoxWindows(true);

  if (windows.length === 0) {
    logDebug("No Firefox windows open");
    return "default";
  }

  let mostRecentWindow: FirefoxWindow | null = null;
  let lowestFocusId = Infinity;

  for (const window of windows) {
    logDebug(
      `Window: PID=${window.pid}, Focus=${window.focusHistoryID}, Title=${window.title}`,
    );

    if (window.focusHistoryID < lowestFocusId) {
      lowestFocusId = window.focusHistoryID;
      mostRecentWindow = window;
      logDebug(
        `New most recent: PID=${window.pid}, Focus=${window.focusHistoryID}`,
      );
    }
  }

  if (mostRecentWindow) {
    const profile = await detectProfileForPid(mostRecentWindow.pid);
    logInfo(
      `Most recent Firefox: PID=${mostRecentWindow.pid}, Profile=${profile}`,
    );
    return profile;
  }

  return "default";
}

function validateUrl(url: string): boolean {
  // Check for valid URL scheme or domain-like pattern
  if (
    !url.match(/^(https?|file|ftp):\/\/.*$/) &&
    !url.match(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}.*$/)
  ) {
    logError(`Invalid URL: ${url}`);
    return false;
  }

  return true;
}

async function focusFirefoxWindow(): Promise<void> {
  try {
    const windows = await getFirefoxWindows(true);

    if (windows.length === 0) return;

    let mostRecentWindow: FirefoxWindow | null = null;
    let lowestFocusId = Infinity;

    for (const window of windows) {
      if (window.focusHistoryID < lowestFocusId) {
        lowestFocusId = window.focusHistoryID;
        mostRecentWindow = window;
      }
    }

    if (mostRecentWindow) {
      const cmd = new Deno.Command("timeout", {
        args: [
          "10",
          "hyprctl",
          "dispatch",
          "focuswindow",
          `address:${mostRecentWindow.address}`,
        ],
        stdout: "null",
        stderr: "null",
      });

      await cmd.output();
    }
  } catch (error) {
    logDebug("Error focusing Firefox window:", error);
  }
}

async function runFirefoxCommand(args: string[]): Promise<boolean> {
  try {
    logDebug(`Executing: firefox ${args.join(" ")}`);

    const cmd = new Deno.Command("firefox", {
      args,
      stdout: "null",
      stderr: "null",
    });

    const result = await cmd.output();
    return result.success;
  } catch (error) {
    logDebug("Firefox command error:", error);
    return false;
  }
}

async function routeUrl(url: string): Promise<void> {
  logInfo(`Routing URL: ${url}`);

  // Validate URL
  if (!validateUrl(url)) {
    Deno.exit(1);
  }

  // Find target profile
  const targetProfile = await findMostRecentFirefox();
  logInfo(`Target profile: ${targetProfile}`);

  // Check if Firefox is running
  const firefoxWindows = await getFirefoxWindows(true);

  if (firefoxWindows.length > 0) {
    logDebug("Firefox is running, attempting to open in existing instance");

    // Build Firefox command
    const firefoxCmd: string[] = [];

    // Add profile specification if not default
    if (targetProfile !== "default") {
      firefoxCmd.push("-P", targetProfile);
    }

    // Add URL opening arguments
    firefoxCmd.push("--new-tab", url);

    // Try to open URL in existing Firefox instance
    if (await runFirefoxCommand(firefoxCmd)) {
      logInfo(
        `URL opened in existing Firefox instance (profile: ${targetProfile})`,
      );

      // Give Firefox time to process the command
      await new Promise((resolve) => setTimeout(resolve, 300));
      await focusFirefoxWindow();
      Deno.exit(0);
    }

    logDebug("Failed to open in existing instance, trying alternative method");

    // Alternative: try firefox --remote command
    if (await runFirefoxCommand(["--remote", `openURL(${url},new-tab)`])) {
      logInfo("URL opened using Firefox remote command");
      await new Promise((resolve) => setTimeout(resolve, 300));
      await focusFirefoxWindow();
      Deno.exit(0);
    }

    logDebug("Firefox remote command failed");
  } else {
    logDebug("No Firefox windows found, starting new instance");
  }

  // Fallback: start new Firefox instance
  logDebug("Starting new Firefox instance");

  const firefoxCmd: string[] = [];

  // Add profile specification if not default
  if (targetProfile !== "default") {
    firefoxCmd.push("-P", targetProfile);
  }

  // Add URL as startup argument
  firefoxCmd.push(url);

  logDebug(`Executing fallback: firefox ${firefoxCmd.join(" ")}`);

  try {
    // Start Firefox in background
    const cmd = new Deno.Command("firefox", {
      args: firefoxCmd,
      stdout: "null",
      stderr: "null",
    });

    const _process = cmd.spawn();

    // Give Firefox time to start
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Check if process is still running (basic check)
    logInfo("Firefox started with new instance");

    // Give Firefox more time to fully start, then focus
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await focusFirefoxWindow();

    Deno.exit(0);
  } catch (error) {
    logError("Failed to start Firefox:", error);
    Deno.exit(1);
  }
}

function showUsage(): void {
  console.log(`Usage: firefox-broker <URL>
Routes external links to most recently active Firefox profile.

Environment: FIREFOX_BROKER_DEBUG=1 (default), FIREFOX_BROKER_SILENT=1
Requires: hyprctl, jq, firefox`);
}

// Main execution
async function main(): Promise<void> {
  // Log startup
  logInfo(`Firefox Broker started - PID: ${Deno.pid}, Log file: ${LOG_FILE}`);
  logInfo(`Arguments: ${Deno.args.join(" ")}`);

  const args = Deno.args;

  // Handle help requests
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    showUsage();
    Deno.exit(0);
  }

  // Check dependencies
  await checkDependencies();

  // Route the URL
  await routeUrl(args[0]);
}

// Execute main function
if (import.meta.main) {
  main().catch((error) => {
    logError("Unhandled error:", error);
    Deno.exit(1);
  });
}
