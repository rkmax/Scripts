#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read --allow-write

import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";
import { copy } from "./wl-clipboard.ts";

type VisionProvider = "openai";

const DEFAULT_SYSTEM =
    "Extract all text from the image. Return only the text content without any additional explanation.";
const DEFAULT_MODEL = "gpt-4o-mini";

async function notify(message: string, timeout: number = 2000): Promise<void> {
    if (Deno.build.os === "windows") {
        console.log(message);
    } else {
        const args = [
            "-r",
            "417037",
            "-t",
            timeout.toString(),
            "Extract Text",
            message,
        ];
        const cmd = new Deno.Command("notify-send", { args });
        await cmd.output();
    }
}

async function getImageFromClipboard(): Promise<string> {
    // Get image from clipboard and save as temporary file
    const tempFile = `/tmp/clipboard_image_${Date.now()}.png`;
    const cmd = new Deno.Command("wl-paste", {
        args: ["--type", "image/png"],
        stdout: "piped",
    });

    const output = await cmd.output();
    if (!output.success) {
        throw new Error(
            "No image found in clipboard or failed to retrieve image",
        );
    }

    await Deno.writeFile(tempFile, output.stdout);
    console.log(`Image saved to temporary file: ${tempFile}`);

    // Convert to base64
    const imageData = await Deno.readFile(tempFile);
    const base64Image = btoa(String.fromCharCode(...imageData));

    // Clean up temp file
    await Deno.remove(tempFile);

    return base64Image;
}

async function extractText(
    base64Image: string,
    systemPrompt: string,
    provider: VisionProvider = "openai",
): Promise<string> {
    const apiKey = Deno.env.get("OPENAI_API_KEY");

    if (provider === "openai" && !apiKey) {
        throw new Error("OPENAI_API_KEY must be set in your environment");
    }

    const url = "https://api.openai.com/v1/chat/completions";

    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
    };

    const body = JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
            {
                role: "system",
                content: systemPrompt,
            },
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: "Extract all text from this image:",
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:image/png;base64,${base64Image}`,
                        },
                    },
                ],
            },
        ],
        max_tokens: 1000,
    });

    const response = await fetch(url, {
        method: "POST",
        headers,
        body,
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
            `API request failed: ${
                errorData.error?.message || response.statusText
            }`,
        );
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

function sanitize(text: string): string {
    return text.replace(/\r\n/g, "\n").replace("\r", "").trim();
}

async function main() {
    await load({ export: true });

    try {
        const systemPrompt = Deno.args.length > 0
            ? Deno.args.join(" ")
            : DEFAULT_SYSTEM;

        await notify("Extracting text from clipboard image...");

        const base64Image = await getImageFromClipboard();

        const provider: VisionProvider = "openai"; // Only OpenAI supported for now

        const startTime = performance.now();
        const extractedText = await extractText(
            base64Image,
            systemPrompt,
            provider,
        );

        const cleanExtractedText = sanitize(extractedText);
        const endTime = performance.now();
        const duration = endTime - startTime;

        await copy(cleanExtractedText);
        await notify(
            `Text extracted and copied to clipboard. Done (${
                duration.toFixed(0)
            }ms)`,
            5000,
        );
    } catch (error) {
        if (error instanceof Error) {
            console.error("Error:", error.stack);
            await notify(`Error: ${error.message}`);
        } else {
            throw error;
        }
    }
}

if (import.meta.main) {
    main();
}
