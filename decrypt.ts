#!/usr/bin/env -S deno run --allow-env --allow-run

import { createDecipheriv } from "node:crypto";
import { Buffer } from "node:buffer";
import { copy, paste } from "./wl-clipboard.ts";

interface DecryptOptions {
  secret: string;
  algorithm?: string;
}

function decrypt<T = any>(data: string, options: DecryptOptions): T | null {
  try {
    const { secret, algorithm = "aes-256-ctr" } = options;

    // Split the encrypted data into IV and encrypted content
    const [iv, encrypted] = data.split(":");

    if (!iv || !encrypted) {
      throw new Error("Invalid encrypted data format");
    }

    // Create decipher with the algorithm, secret, and IV
    const decipher = createDecipheriv(
      algorithm,
      secret,
      Buffer.from(iv, "hex"),
    );

    // Decrypt the data
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, "hex")),
      decipher.final(),
    ]).toString();

    // Parse the JSON data
    return JSON.parse(decrypted);
  } catch (error) {
    console.error("Decryption failed:", error);
    return null;
  }
}

// Main CLI
if (import.meta.main) {
  const args = Deno.args;

  // Parse flags
  const useClipboard = args.includes("-c") || args.includes("--clipboard");
  const algorithmIndex = args.indexOf("--algorithm");
  let algorithm = "aes-256-ctr";

  if (algorithmIndex !== -1 && args[algorithmIndex + 1]) {
    algorithm = args[algorithmIndex + 1];
  }

  // Filter out flags to get positional arguments
  const positionalArgs = args.filter((arg, index) => {
    return arg !== "-c" && arg !== "--clipboard" &&
      arg !== "--algorithm" &&
      (index !== algorithmIndex + 1 || algorithmIndex === -1);
  });

  // Handle clipboard mode
  if (useClipboard) {
    try {
      if (positionalArgs.length < 1) {
        console.error("Usage: decrypt.ts --clipboard <secret>");
        console.error(
          "       Reads encrypted data from clipboard and copies decrypted result back",
        );
        console.error(
          "Optional: --algorithm <algorithm-name> (default: aes-256-ctr)",
        );
        Deno.exit(1);
      }

      const secret = positionalArgs[0];

      // Check secret length for AES-256 (32 bytes)
      if (
        algorithm.startsWith("aes-256") && Buffer.from(secret).length !== 32
      ) {
        console.error("Error: AES-256 requires a 32-byte secret key");
        Deno.exit(1);
      }

      // Get encrypted data from clipboard
      const encryptedData = await paste();
      if (!encryptedData.trim()) {
        console.error("Error: No data found in clipboard");
        Deno.exit(1);
      }

      const result = decrypt(encryptedData.trim(), { secret, algorithm });

      if (result !== null) {
        const output = JSON.stringify(result, null, 2);
        await copy(output);
        console.log("✓ Decrypted data copied to clipboard");
        console.log(
          "Preview:",
          output.substring(0, 100) + (output.length > 100 ? "..." : ""),
        );
      } else {
        console.error("Failed to decrypt data");
        Deno.exit(1);
      }
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      Deno.exit(1);
    }
  } else {
    // Standard mode (from command line arguments)
    if (positionalArgs.length < 2) {
      console.error("Usage: decrypt.ts <encrypted-string> <secret>");
      console.error("       decrypt.ts --clipboard <secret>");
      console.error(
        "Optional: --algorithm <algorithm-name> (default: aes-256-ctr)",
      );
      console.error(
        "          -c, --clipboard  Read from clipboard and copy result back",
      );
      Deno.exit(1);
    }

    const encryptedData = positionalArgs[0];
    const secret = positionalArgs[1];

    // Check secret length for AES-256 (32 bytes)
    if (algorithm.startsWith("aes-256") && Buffer.from(secret).length !== 32) {
      console.error("Error: AES-256 requires a 32-byte secret key");
      Deno.exit(1);
    }

    const result = decrypt(encryptedData, { secret, algorithm });

    if (result !== null) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error("Failed to decrypt data");
      Deno.exit(1);
    }
  }
}

// Export for use as a module
export { decrypt, type DecryptOptions };
