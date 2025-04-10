#!/usr/bin/env -S deno run --allow-env --allow-run --allow-read --allow-write --allow-net --allow-ffi
import { Webview } from "jsr:@webview/webview";
import { join } from "https://deno.land/std@0.203.0/path/mod.ts";

const TEMP_HTML_PATH = join(Deno.env.get("TMPDIR") || "/tmp", "apc-ui.html");
const REFRESH_INTERVAL = 2000; // Refresh interval in milliseconds
const APC_ACCESS_PATH = Deno.env.get("APCACCESS_PATH") || "apcaccess";

const fetchUPSData = async (): Promise<string> => {
  const command = new Deno.Command(APC_ACCESS_PATH, {
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout } = await command.output();
  return new TextDecoder().decode(stdout);
};

const parseUPSData = (rawData: string): Record<string, string> => {
  const usefulKeys = [
    "LINEV",
    "LOADPCT",
    "BCHARGE",
    "TIMELEFT",
    "BATTV",
    "STATUS",
  ];
  return rawData.split("\n").reduce((data, line) => {
    const [key, ...value] = line.split(":");
    if (key && value && usefulKeys.includes(key.trim())) {
      data[key.trim()] = value.join(":").trim();
    }
    return data;
  }, {} as Record<string, string>);
};

const generateHTML = (data: Record<string, string>): string => `
<html>
  <head>
    <title>APC UPS Monitor</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 0;
        background: linear-gradient(135deg, #1e3c72, #2a5298);
        color: #fff;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
      }
      .widget {
        background: #1c1c1c;
        border-radius: 10px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        width: 400px;
        padding: 20px;
        text-align: center;
      }
      .widget h1 {
        font-size: 1.5em;
        margin-bottom: 20px;
        color: #00ff00;
      }
      .parameter {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: 10px 0;
        padding: 10px;
        background: #2a2a2a;
        border-radius: 5px;
      }
      .parameter-label {
        flex: 1;
        text-align: left;
      }
      .parameter-value {
        flex: 1;
        text-align: right;
      }
      .progress-bar {
        width: 100%;
        height: 10px;
        background: #444;
        border-radius: 5px;
        overflow: hidden;
        margin-top: 5px;
      }
      .progress-bar-fill {
        height: 100%;
        background: #00ff00;
      }
      .footer {
        margin-top: 20px;
        font-size: 0.9em;
        color: #aaa;
      }
    </style>
  </head>
  <body>
    <div class="widget">
      <h1>APC UPS Monitor</h1>
      ${
  Object.entries(data)
    .map(([key, value]) => {
      if (key === "LOADPCT" || key === "BCHARGE") {
        const percentage = parseFloat(value.replace("%", ""));
        const valueText = value.replace(" Percent", "%");
        return `
                    <div class="parameter">
                      <span class="parameter-label">${key}</span>
                      <span class="parameter-value">${valueText}</span>
                    </div>
                    <div class="progress-bar">
                      <div class="progress-bar-fill" style="width: ${percentage}%;"></div>
                    </div>`;
      } else {
        return `
                    <div class="parameter">
                      <span class="parameter-label">${key}</span>
                      <span class="parameter-value">${value}</span>
                    </div>`;
      }
    })
    .join("")
}
      <div class="footer">Last updated: <span id="last-updated">${
  new Date().toLocaleTimeString()
}</span></div>
    </div>
  </body>
</html>
`;

const updateHTMLFile = async (webview: Webview): Promise<void> => {
  const rawData = await fetchUPSData();
  const parsedData = parseUPSData(rawData);
  const html = generateHTML(parsedData);
  await Deno.writeTextFile(TEMP_HTML_PATH, html);
  webview.navigate(`file://${TEMP_HTML_PATH}`);
};

const main = async (): Promise<void> => {
  const webview = new Webview();
  webview.title = "APC UPS Monitor";

  // Initial HTML generation and navigation
  await updateHTMLFile(webview);

  // Periodic updates
  setInterval(async () => {
    console.log("Updating HTML file...");
    await updateHTMLFile(webview);
  }, REFRESH_INTERVAL);

  webview.run();
};

await main();
