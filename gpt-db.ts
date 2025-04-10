#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read --allow-write

import { load } from "jsr:@std/dotenv";
import { join } from "jsr:@std/path";
import { DatabaseSync } from "node:sqlite";

export function createDB() {
    const defaultDbPath = join(Deno.env.get("HOME") || "", ".gpt_requests.db");
    const dbPath = Deno.env.get("GPT_DB_PATH") || defaultDbPath;
    const db = new DatabaseSync(dbPath);
    initializeDB(db);
    return db;
}

function initializeDB(db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL,
      response TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
}

export function saveToDB(db: DatabaseSync, prompt: string, response: string) {
    db.prepare("INSERT INTO requests (prompt, response) VALUES (?, ?)").run(
        prompt,
        response,
    );
}

type Request = {
    id: number;
    prompt: string;
    response: string;
    timestamp: string;
};

function getAllRequests(db: DatabaseSync, options: {
    sort?: "asc" | "desc";
    limit?: number;
    search?: string;
} = {}): Request[] {
    let query = "SELECT * FROM requests";
    const params: any[] = [];

    // Add search if provided
    if (options.search) {
        query += " WHERE prompt LIKE ? OR response LIKE ?";
        params.push(`%${options.search}%`, `%${options.search}%`);
    }

    // Add sorting
    query += ` ORDER BY timestamp ${options.sort === "asc" ? "ASC" : "DESC"}`;

    // Add limit
    if (options.limit) {
        query += " LIMIT ?";
        params.push(options.limit);
    }

    const stmt = db.prepare(query);
    const rows = stmt.all(...params);

    return rows as Request[];
}

async function main() {
    await load({ export: true });
    const db = createDB();
    const encoder = new TextEncoder();

    const args = Deno.args;
    const options: {
        sort?: "asc" | "desc";
        limit?: number;
        search?: string;
    } = {
        sort: "desc", // Default to newest first
        limit: 100, // Default limit
    };

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--sort" && i + 1 < args.length) {
            options.sort = args[i + 1] as "asc" | "desc";
            i++;
        } else if (args[i] === "--limit" && i + 1 < args.length) {
            options.limit = parseInt(args[i + 1], 10);
            i++;
        } else if (args[i] === "--search" && i + 1 < args.length) {
            options.search = args[i + 1];
            i++;
        }
    }

    try {
        const all = getAllRequests(db, options);
        for (const row of all) {
            // Format date with both date and time
            const date = new Date(row.timestamp);
            const formattedDate =
                `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;

            // Create truncated preview of prompt (first 50 chars)
            const promptPreview = row.prompt.length > 50
                ? row.prompt.substring(0, 50).replace(/\n/g, " ") + "..."
                : row.prompt.replace(/\n/g, " ");

            // Output format: [ID] Preview | Full prompt | Full response | [DateTime]
            const line =
                `[${row.id}] ${promptPreview} | ${row.prompt} | ${row.response} | [${formattedDate}]\n`;
            Deno.stdout.write(encoder.encode(line));
        }
    } finally {
        db.close();
    }
}

if (import.meta.main) {
    await main();
}
