#!/usr/bin/env -S deno run --allow-read 
import { readAll } from "https://deno.land/std@0.212.0/io/read_all.ts";

const encoder = new TextEncoder();

function writeSequence(seq: string) {
    Deno.stdout.writeSync(encoder.encode(seq));
}

function toWal(index: number, color: string) {
    return `\x1b]4;${index};${color}\x1b\\`;
}

function toSpecial(code: number, color: string) {
    return `\x1b]${code};${color}\x1b\\`;
}

function writePalette(palette: string[]) {
    palette.forEach((color, index) => {
        writeSequence(toWal(index, color));
    });
}

enum SpecialCodes {
    Foreground = 10,
    Background = 11,
    Cursor = 12,
    HighlightText = 13,
    HighlightBackground = 17,
    BoldText = 19,
    BackgroundAlt = 708,
    Surface = 232,
    OnSurface = 256,
}

function writeSpecialColors(base: Colors) {
    const specialMappings = [
        { code: SpecialCodes.Foreground, color: base.on_surface },
        { code: SpecialCodes.Background, color: base.surface },
        { code: SpecialCodes.Cursor, color: base.on_surface },
        { code: SpecialCodes.HighlightText, color: base.on_surface },
        { code: SpecialCodes.HighlightBackground, color: base.on_surface },
        { code: SpecialCodes.BoldText, color: base.surface },
        { code: SpecialCodes.BackgroundAlt, color: base.surface },
    ];

    specialMappings.forEach(({ code, color }) => {
        writeSequence(toSpecial(code, color));
    });

    writeSequence(toWal(SpecialCodes.Surface, base.surface));
    writeSequence(toWal(SpecialCodes.OnSurface, base.on_surface));
}

type Colors = {
    surface: string;
    error: string;
    on_error_container: string;
    error_container: string;
    primary_container: string;
    on_tertiary_container: string;
    tertiary: string;
    on_surface: string;
    on_surface_variant: string;
};

type ColorsTheme = {
    dark: Colors;
    light: Colors;
};

function main(colors: ColorsTheme, theme: "dark" | "light" = "dark") {
    const base = colors[theme];

    const palette = [
        base.surface,
        base.error,
        base.on_error_container,
        base.error_container,
        base.primary_container,
        base.on_tertiary_container,
        base.tertiary,
        base.on_surface,
        base.on_surface_variant,
        base.error,
        base.on_error_container,
        base.error_container,
        base.primary_container,
        base.on_tertiary_container,
        base.tertiary,
        base.on_surface,
    ];

    writePalette(palette);
    writeSpecialColors(base);
}

const input = await readAll(Deno.stdin);
const json = new TextDecoder().decode(input);
const parsed: { colors: ColorsTheme } = JSON.parse(json);

const args = Deno.args;
let theme: "dark" | "light" = "dark";

if (args.includes("--light")) {
    theme = "light";
} else if (args.includes("--dark")) {
    theme = "dark";
}

main(parsed.colors, theme);
