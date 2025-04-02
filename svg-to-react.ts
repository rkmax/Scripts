#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read --allow-write

import { copy, paste } from "./wl-clipboard.ts";

// Utility to convert kebab-case to camelCase
const kebabToCamel = (str: string): string => {
    return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
};

// Process SVG content generically
const processSvg = (svgContent: string): string => {
    // Generic regex to find all attributes in kebab-case and convert them to camelCase
    const processedSvg = svgContent
        .replace(/\s+/g, " ")
        .replace(/\n/g, " ")
        .replace(/<([a-zA-Z0-9]+)([^>]*)>/g, (_match, tag, attributes) => {
            // Handle special case for class -> className
            let processedAttrs = attributes.replace(/\bclass=/g, "className=");

            // Generic replacement for all kebab-case attributes
            processedAttrs = processedAttrs.replace(
                /\b([a-z]+-[a-z-]+)=/g,
                (_attrMatch: string, attrName: string) => {
                    return `${kebabToCamel(attrName)}=`;
                },
            );

            // Handle namespaced attributes like xlink:href -> xlinkHref
            processedAttrs = processedAttrs.replace(
                /\b([a-zA-Z]+):([a-zA-Z]+)=/g,
                (_nsMatch: string, namespace: string, attr: string) => {
                    return `${namespace.toLowerCase()}${
                        attr.charAt(0).toUpperCase()
                    }${attr.slice(1)}=`;
                },
            );

            return `<${tag}${processedAttrs}>`;
        });

    return processedSvg;
};

// Main function to convert SVG to React component
function convertSvgToReact(
    svgContent: string,
    componentName?: string,
) {
    // Determine component name - either from argument or derived from filename
    const name = componentName;

    // Process SVG content to make it React-compatible
    const processedSvg = processSvg(svgContent);

    // Create React component code
    const reactComponent = `import { ComponentProps } from 'react';

type ${name}Props =  ComponentProps<'svg'> & {
// Add any custom props here
}

export const ${name} = (props: ${name}Props) => {
return (
  ${processedSvg}
);
};

`;

    // Write the React component file
    return reactComponent;
}

async function main() {
    const svgContent = await paste();
    const componentName = "SVGComponent";
    const reactComponent = convertSvgToReact(svgContent, componentName);
    await copy(reactComponent);
}

if (import.meta.main) {
    main().catch((err) => {
        console.log(err);
    });
}
