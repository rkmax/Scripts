#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read --allow-write

/**
 * Uses [matugen](https://github.com/InioX/matugen) to generate a theme of colors, using an image
 * the format of the colors can be either RGB or HSL
 */
async function generateTheme(
    image: string,
    colorType: "rgb" | "hsl",
): Promise<Record<string, [number, number, number]>> {
    const cmd = new Deno.Command("matugen", {
        stdout: "piped",
        args: [
            "image",
            image,
            "-j",
            colorType,
        ],
    });
    const process = cmd.spawn();
    const output = await process.output();
    const status = await process.status;

    if (!status.success) {
        throw new Error("Failed to get colors");
    }

    const colorsJson = new TextDecoder().decode(output.stdout);
    const colors = JSON.parse(colorsJson).colors.light;

    return Object.keys(colors).reduce(
        (acc, colorName) => {
            return {
                ...acc,
                [colorName]: colors[colorName].match(/[\d.]+/g).map(Number) as [
                    number,
                    number,
                    number,
                ],
            };
        },
        {} as Record<string, [number, number, number]>,
    );
}

/**
 * This function retrieves the most saturated color from the theme
 */
async function getMostSaturatedImageColor(image: string) {
    const [rgb, hsl] = await Promise.all([
        generateTheme(image, "rgb"),
        generateTheme(image, "hsl"),
    ]);

    const colorsToInspect = [
        "primary",
        "secondary",
        "tertiary",
        "source_color",
        "surface",
    ];
    let selectedColorName = "primary";

    colorsToInspect.forEach((colorName) => {
        if (hsl[colorName][1] > hsl[selectedColorName][1]) {
            selectedColorName = colorName;
        }
    });
    console.log(`Selected color: ${selectedColorName}`);

    return rgb[selectedColorName];
}

async function setRGBLedColors(rgb: string) {
    const cmd = new Deno.Command("openrgb", {
        args: [
            "-m",
            "Direct",
            "-c",
            rgb,
        ],
        stdout: "null",
    });

    const process = cmd.spawn();
    await process.status;
}

function gammaCorrect(
    colors: [number, number, number],
    gamma = 2.2,
): [number, number, number] {
    const gammaA = (color: number) =>
        Math.round(255 * Math.pow(color / 255, 1 / gamma));
    // const gammaB = (color: number) => Math.pow(color / 255, gamma) * 255;;
    return colors.map(gammaA) as [number, number, number];
}

function rgbToHex(colors: [number, number, number]): string {
    return `${
        colors.map((color) => color.toString(16).padStart(2, "0")).join("")
    }`.toUpperCase();
}

async function main() {
    const image = Deno.args[0];
    const rgbColors = await getMostSaturatedImageColor(image);
    console.log(`Current RGB colors: ${rgbColors}. ${rgbToHex(rgbColors)}`);
    const correctedRgbColors = gammaCorrect(rgbColors, 0.5);
    console.log(
        `Gamma-corrected RGB colors: ${correctedRgbColors}. ${
            rgbToHex(correctedRgbColors)
        }`,
    );
    const hexColors = rgbToHex(correctedRgbColors);
    await setRGBLedColors(hexColors);
}

main()
    .catch((error) => console.error("Error:", error));
