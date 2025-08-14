#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read --allow-write

export type EntryType = "folder" | "file" | "ssh" | "devserver" | "workspace";

export interface Entry {
  type: EntryType;
  path: string;
  timestamp?: string;
  workspaceId?: number;
  displayName?: string;
}

export interface RofiEntry {
  name: string;
  icon?: string;
  info?: boolean;
  urgent?: boolean;
  active?: boolean;
  markupRows?: boolean;
}

export interface EditorProvider {
  name: string;
  getRecentEntries(): Promise<Entry[]> | Entry[];
  getExecutableCommand(): string;
  getFileIcon?(extension?: string): string;
  sortEntries?(entries: Entry[]): Entry[];
}

export interface EditorRofiConfig {
  provider: EditorProvider;
  homeDir?: string;
  maxEntries?: number;
}

export class EditorRofi {
  private provider: EditorProvider;
  private homeDir: string;
  private maxEntries: number;

  constructor(config: EditorRofiConfig) {
    this.provider = config.provider;
    this.homeDir = config.homeDir ?? Deno.env.get("HOME") ?? "";
    this.maxEntries = config.maxEntries ?? 15;
  }

  private generateRofiOption(name: string, value: string) {
    return `\0${name}\x1f${value}`;
  }

  private generateRofiOtions(options: string[]) {
    if (!options || options.length === 0) {
      return;
    }

    console.log(options.join("\n") + "\n");
  }

  private generateRofiEntry(entry: RofiEntry): string {
    const parts: string[] = [];

    if (entry.icon) {
      parts.push("icon");
      parts.push(entry.icon);
    }

    // Replace home directory with ~ for display
    const displayName = entry.name.replace(this.homeDir, "~");
    parts.push("display");
    parts.push(displayName);

    const line = parts.join("\x1f");
    return `${entry.name}\0${line}`;
  }

  private getDefaultFileIcon(extension?: string): string {
    if (!extension) return "text-x-generic";
    return FILE_ICON_MAP[extension.toLowerCase()] || "text-x-generic";
  }

  private getIconForEntry(entry: Entry): string {
    let icon = "folder";

    if (entry.type === "file") {
      const ext = entry.path.split(".").pop()?.toLowerCase();
      // Use provider's getFileIcon if available, otherwise use default
      icon = this.provider.getFileIcon?.(ext) ?? this.getDefaultFileIcon(ext);
    } else if (entry.type === "ssh") {
      icon = "network-server";
    } else if (entry.type === "devserver") {
      icon = "network-workgroup";
    } else if (entry.type === "workspace") {
      icon = "folder-documents";
    }

    return icon;
  }

  private removeDuplicates(entries: Entry[]): Entry[] {
    const uniquePaths = new Map<string, Entry>();
    for (const entry of entries) {
      if (!uniquePaths.has(entry.path)) {
        uniquePaths.set(entry.path, entry);
      }
    }
    return Array.from(uniquePaths.values());
  }

  private defaultSortEntries(entries: Entry[]): Entry[] {
    const typePriority: Record<EntryType, number> = {
      folder: 0,
      ssh: 1,
      devserver: 2,
      workspace: 3,
      file: 4,
    };

    return entries.sort((a, b) => {
      const priorityDiff = typePriority[a.type] - typePriority[b.type];
      if (priorityDiff !== 0) return priorityDiff;

      // Then sort by timestamp if available
      if (a.timestamp && b.timestamp) {
        return b.timestamp.localeCompare(a.timestamp);
      }
      return 0;
    });
  }

  async formatRecentEntries(): Promise<void> {
    const entries = await this.provider.getRecentEntries();

    if (entries.length === 0) {
      console.log("No recent entries found\n");
      return;
    }

    // Remove duplicates and limit entries
    const uniqueEntries = this.removeDuplicates(entries).slice(
      0,
      this.maxEntries,
    );

    // Sort entries using provider's sort or default
    const sortedEntries = this.provider.sortEntries
      ? this.provider.sortEntries(uniqueEntries)
      : this.defaultSortEntries(uniqueEntries);

    this.generateRofiOtions([
      this.generateRofiOption("use-hot-keys", "true"),
      this.generateRofiOption("no-custom", "true"),
      this.generateRofiOption("markup-rows", "true"),
    ]);

    // Output formatted entries for Rofi
    for (const entry of sortedEntries) {
      const icon = this.getIconForEntry(entry);

      // Use display name for remote projects, path for local
      const displayPath = entry.displayName || entry.path;

      const rofiEntry = this.generateRofiEntry({
        name: displayPath,
        icon: icon,
      });
      console.log(rofiEntry);
    }
  }

  executeEditor(path: string, extraArgs: string[] = []): void {
    const command = new Deno.Command(this.provider.getExecutableCommand(), {
      args: [path, ...extraArgs],
      stdin: "null",
      stdout: "null",
      stderr: "null",
    });

    command.spawn();
  }

  async run(): Promise<void> {
    const rofiRetv = parseInt(Deno.env.get("ROFI_RETV") ?? "0");
    const args = Deno.args;

    switch (rofiRetv) {
      case 0:
        // Initial call - display the list
        await this.formatRecentEntries();
        break;
      case 1:
        // User selected an entry - open in editor
        if (args.length > 0) {
          this.executeEditor(args[0]);
        }
        break;
      case 10:
        if (args.length > 0) {
          this.executeEditor(args[0], ["-n"]);
        }
    }
  }
}

// Comprehensive file extension to icon mapping based on freedesktop.org MIME types
const FILE_ICON_MAP: Record<string, string> = {
  // Programming Languages - Common
  "ts": "text-x-typescript",
  "tsx": "text-x-typescript",
  "js": "application-x-javascript",
  "jsx": "application-x-javascript",
  "mjs": "application-x-javascript",
  "cjs": "application-x-javascript",
  "py": "text-x-python",
  "pyw": "text-x-python",
  "py3": "text-x-python3",
  "pyi": "text-x-python",
  "java": "application-x-java",
  "class": "application-x-java",
  "jar": "application-x-java-archive",
  "c": "text-x-csrc",
  "h": "text-x-chdr",
  "cpp": "text-x-c++src",
  "cxx": "text-x-c++src",
  "cc": "text-x-c++src",
  "hpp": "text-x-c++hdr",
  "hxx": "text-x-c++hdr",
  "hh": "text-x-c++hdr",
  "cs": "text-x-csharp",
  "vb": "text-x-vbnet",
  "fs": "text-x-fsharp",
  "fsx": "text-x-fsharp",
  "fsi": "text-x-fsharp",

  // Programming Languages - Web
  "html": "text-html",
  "htm": "text-html",
  "xhtml": "application-xhtml+xml",
  "css": "text-css",
  "scss": "text-css",
  "sass": "text-css",
  "less": "text-css",
  "styl": "text-css",
  "php": "application-x-php",
  "php3": "application-x-php",
  "php4": "application-x-php",
  "php5": "application-x-php",
  "php7": "application-x-php",
  "phtml": "application-x-php",

  // Programming Languages - Systems
  "rs": "text-rust",
  "go": "text-x-go",
  "mod": "text-x-go",
  "zig": "text-x-generic",
  "nim": "text-x-nim",
  "nims": "text-x-nim",
  "d": "text-x-dsrc",
  "swift": "text-x-swift",
  "kt": "text-x-kotlin",
  "kts": "text-x-kotlin",
  "m": "text-x-objcsrc",
  "mm": "text-x-objcsrc",

  // Programming Languages - Scripting
  "rb": "application-x-ruby",
  "rbw": "application-x-ruby",
  "rake": "application-x-ruby",
  "gemspec": "application-x-ruby",
  "lua": "text-x-lua",
  "pl": "application-x-perl",
  "pm": "application-x-perl",
  "t": "application-x-perl",
  "pod": "application-x-perl",
  "tcl": "text-x-tcl",
  "r": "text-x-r",
  "R": "text-x-r",
  "jl": "text-x-julia",
  "ex": "text-x-elixir",
  "exs": "text-x-elixir",
  "erl": "text-x-erlang",
  "hrl": "text-x-erlang",

  // Programming Languages - Functional
  "hs": "text-x-haskell",
  "lhs": "text-x-haskell",
  "ml": "text-x-ocaml",
  "mli": "text-x-ocaml",
  "scala": "text-x-scala",
  "sc": "text-x-scala",
  "clj": "text-x-clojure",
  "cljs": "text-x-clojure",
  "cljc": "text-x-clojure",
  "lisp": "text-x-common-lisp",
  "lsp": "text-x-common-lisp",
  "el": "text-x-emacs-lisp",
  "scm": "text-x-scheme",
  "ss": "text-x-scheme",
  "rkt": "text-x-scheme",

  // Programming Languages - Low Level
  "asm": "text-x-asm",
  "s": "text-x-asm",
  "S": "text-x-asm",
  "pas": "text-x-pascal",
  "pp": "text-x-pascal",
  "p": "text-x-pascal",
  "for": "text-x-fortran",
  "f": "text-x-fortran",
  "f90": "text-x-fortran",
  "f95": "text-x-fortran",
  "f03": "text-x-fortran",
  "ada": "text-x-adasrc",
  "adb": "text-x-adasrc",
  "ads": "text-x-adasrc",
  "cob": "text-x-cobol",
  "cbl": "text-x-cobol",

  // Shell & Scripts
  "sh": "text-x-script",
  "bash": "text-x-script",
  "zsh": "text-x-script",
  "fish": "text-x-script",
  "ksh": "text-x-script",
  "csh": "text-x-script",
  "ps1": "text-x-script",
  "psm1": "text-x-script",
  "psd1": "text-x-script",
  "bat": "text-x-script",
  "cmd": "text-x-script",
  "awk": "text-x-script",
  "sed": "text-x-script",

  // Markup & Data
  "xml": "text-xml",
  "xsl": "text-xml",
  "xslt": "text-xml",
  "xsd": "text-xml",
  "dtd": "text-xml",
  "json": "application-json",
  "jsonc": "application-json",
  "json5": "application-json",
  "yaml": "text-x-yaml",
  "yml": "text-x-yaml",
  "toml": "text-x-toml",
  "ini": "text-x-generic",
  "cfg": "text-x-generic",
  "conf": "text-x-generic",
  "config": "text-x-generic",
  "properties": "text-x-generic",
  "props": "text-x-generic",
  "env": "text-x-generic",
  "dotenv": "text-x-generic",

  // Documentation
  "md": "text-x-markdown",
  "markdown": "text-x-markdown",
  "mdown": "text-x-markdown",
  "mkd": "text-x-markdown",
  "mdx": "text-x-markdown",
  "rst": "text-x-readme",
  "rest": "text-x-readme",
  "txt": "text-plain",
  "text": "text-plain",
  "log": "text-x-log",
  "changelog": "text-x-changelog",
  "authors": "text-x-authors",
  "contributors": "text-x-authors",
  "copying": "text-x-copying",
  "license": "text-x-copying",
  "install": "text-x-install",
  "readme": "text-x-readme",
  "todo": "text-x-generic",
  "nfo": "text-x-nfo",

  // Build & Config
  "makefile": "text-x-makefile",
  "mk": "text-x-makefile",
  "mak": "text-x-makefile",
  "cmake": "text-x-cmake",
  "dockerfile": "text-dockerfile",
  "containerfile": "text-dockerfile",
  "docker-compose.yml": "text-dockerfile",
  "docker-compose.yaml": "text-dockerfile",
  "vagrantfile": "text-x-script",
  "jenkinsfile": "text-x-script",
  "rakefile": "application-x-ruby",
  "gulpfile": "application-x-javascript",
  "gruntfile": "application-x-javascript",
  "webpack.config.js": "application-x-javascript",

  // Database
  "sql": "text-x-sql",
  "mysql": "text-x-sql",
  "pgsql": "text-x-sql",
  "sqlite": "text-x-sql",
  "db": "application-vnd.oasis.opendocument.database",
  "sqlite3": "application-vnd.oasis.opendocument.database",

  // Data Files
  "csv": "text-csv",
  "tsv": "text-csv",
  "ldif": "text-x-ldif",

  // LaTeX & Typography
  "tex": "text-x-tex",
  "ltx": "text-x-tex",
  "latex": "text-x-tex",
  "bib": "text-x-bibtex",
  "bibtex": "text-x-bibtex",
  "sty": "text-x-tex",
  "cls": "text-x-tex",
  "typst": "text-x-typst",

  // Web Assembly
  "wat": "text-plain",
  "wasm": "application-wasm",

  // Template Files
  "tpl": "text-plain",
  "hbs": "text-html",
  "handlebars": "text-html",
  "mustache": "text-html",
  "ejs": "text-html",
  "erb": "text-html",
  "jinja": "text-html",
  "jinja2": "text-html",
  "j2": "text-html",
  "twig": "text-html",
  "vue": "text-html",
  "svelte": "text-html",

  // Version Control
  "gitignore": "text-x-generic",
  "gitattributes": "text-x-generic",
  "gitmodules": "text-x-generic",
  "gitconfig": "text-x-generic",
  "hgignore": "text-x-generic",
  "svnignore": "text-x-generic",

  // Patches & Diffs
  "patch": "text-x-patch",
  "diff": "text-x-patch",
  "rej": "text-x-patch",

  // Localization
  "po": "text-x-po",
  "pot": "text-x-po",
  "mo": "text-x-po",

  // QML & Qt
  "qml": "text-x-qml",
  "qrc": "text-xml",
  "ui": "text-xml",

  // Other
  "vim": "text-plain",
  "vimrc": "text-plain",
  "gvimrc": "text-plain",
  "emacs": "text-plain",
  "nano": "text-plain",
  "editorconfig": "text-x-generic",
  "htaccess": "text-x-generic",
  "htpasswd": "text-x-generic",
  "robots.txt": "text-plain",
  "humans.txt": "text-plain",
  "manifest": "text-x-generic",
  "rpm": "text-x-rpm-spec",
  "spec": "text-x-rpm-spec",
  "deb": "application-x-deb",
  "apk": "application-vnd.android.package-archive",
  "dmg": "application-x-apple-diskimage",
  "pkg": "application-x-xar",
  "msi": "application-x-msi",
  "exe": "application-x-executable",
  "dll": "application-x-sharedlib",
  "so": "application-x-sharedlib",
  "dylib": "application-x-sharedlib",
  "a": "application-x-archive",
  "lib": "application-x-archive",
  "o": "application-x-object",
  "obj": "application-x-object",
  "ko": "application-x-object",
  "elf": "application-x-executable",
  "hex": "text-x-hex",
};
