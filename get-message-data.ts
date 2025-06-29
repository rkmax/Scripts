#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read --allow-write

import { copy, paste } from "./wl-clipboard.ts";

async function main() {
    const textFromClipboard = await paste();

    const jsonFROMClipboard = JSON.parse(textFromClipboard);

    const messages: string[] = [];

    // input format anthropic and openai
    if (jsonFROMClipboard.messages && jsonFROMClipboard.messages.length > 0) {
        for (const message of jsonFROMClipboard.messages) {
            if (message.content) {
                // Handle string content
                if (typeof message.content === "string") {
                    messages.push(getContent(message.content));
                } // Handle array content (anthropic format)
                else if (Array.isArray(message.content)) {
                    for (const contentItem of message.content) {
                        if (contentItem.text) {
                            messages.push(getContent(contentItem.text));
                        }
                    }
                }
            }
        }
    }

    // anthropic system format
    if (jsonFROMClipboard.system) {
        // if system is a string, push it directly
        if (typeof jsonFROMClipboard.system === "string") {
            messages.push(getContent(jsonFROMClipboard.system));
        } else if (
            typeof jsonFROMClipboard.system === "object" &&
            jsonFROMClipboard.system.text
        ) {
            // if system is an object with text, push the text
            messages.push(getContent(jsonFROMClipboard.system.text));
        } else if (Array.isArray(jsonFROMClipboard.system)) {
            // if system is an array, iterate through it
            for (const systemMessage of jsonFROMClipboard.system) {
                if (typeof systemMessage === "string") {
                    messages.push(getContent(systemMessage));
                } else if (systemMessage.text) {
                    messages.push(getContent(systemMessage.text));
                }
            }
        }
    }

    // anthropic format
    if (jsonFROMClipboard.content && jsonFROMClipboard.content.length > 0) {
        for (const content of jsonFROMClipboard.content) {
            if (content.text) {
                messages.push(getContent(content.text));
            }
        }
    }

    // openai response format
    if (jsonFROMClipboard.choices && jsonFROMClipboard.choices.length > 0) {
        for (const choice of jsonFROMClipboard.choices) {
            if (choice.message && choice.message.content) {
                messages.push(getContent(choice.message.content));
            }
        }
    }

    // gemini format
    if (jsonFROMClipboard.contents && jsonFROMClipboard.contents.length > 0) {
        for (const content of jsonFROMClipboard.contents) {
            if (content.parts && content.parts.length > 0) {
                for (const part of content.parts) {
                    if (part.text) {
                        messages.push(getContent(part.text));
                    }
                }
            }
        }
    }

    // gemini response format
    if (jsonFROMClipboard.candidates && jsonFROMClipboard.candidates.length > 0) {
        for (const candidate of jsonFROMClipboard.candidates) {
            if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                for (const part of candidate.content.parts) {
                    if (part.text) {
                        messages.push(getContent(part.text));
                    }
                }
            }
        }
    }

    if (messages.length === 0) {
        console.error("No messages found in the clipboard content.");
        return;
    }

    console.log("Messages found:", messages.length);
    console.log("Copying messages to clipboard...", messages);

    await copy(
        messages.join(
            "\n\n---\n\n",
        ),
    );
}

function getContent(value: string): string {
    return value
        .replace(/\\n/g, "\n")
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"');
}

if (import.meta.main) {
    main();
}
