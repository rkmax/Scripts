#!/usr/bin/env python3

import os
import sys
import argparse
import subprocess
import venv
import tempfile
from pathlib import Path
from collections import defaultdict, Counter

SCRIPT_DIR = Path(__file__).parent
VENV_DIR = SCRIPT_DIR / '.venv_language_analyzer'
REQUIREMENTS = ['matplotlib>=3.0.0']

def ensure_venv():
    """Create and activate virtual environment if it doesn't exist."""
    if not VENV_DIR.exists():
        print("Creating virtual environment...")
        venv.create(VENV_DIR, with_pip=True)
        
        # Install requirements
        pip_path = VENV_DIR / 'bin' / 'pip'
        if not pip_path.exists():
            pip_path = VENV_DIR / 'Scripts' / 'pip.exe'  # Windows
        
        for req in REQUIREMENTS:
            print(f"Installing {req}...")
            subprocess.check_call([str(pip_path), 'install', req])
        
        print("Virtual environment setup complete!")
    
    # Add venv to path
    if sys.platform == 'win32':
        venv_python = VENV_DIR / 'Scripts' / 'python.exe'
        venv_site_packages = VENV_DIR / 'Lib' / 'site-packages'
    else:
        venv_python = VENV_DIR / 'bin' / 'python'
        venv_site_packages = VENV_DIR / 'lib' / f'python{sys.version_info.major}.{sys.version_info.minor}' / 'site-packages'
    
    if str(venv_site_packages) not in sys.path:
        sys.path.insert(0, str(venv_site_packages))

def import_matplotlib():
    """Import matplotlib with fallback handling."""
    try:
        import matplotlib
        matplotlib.use('Agg')  # Use non-interactive backend
        import matplotlib.pyplot as plt
        return plt
    except ImportError:
        ensure_venv()
        try:
            import matplotlib
            matplotlib.use('Agg')
            import matplotlib.pyplot as plt
            return plt
        except ImportError:
            print("Error: Could not install or import matplotlib")
            return None

def get_language_by_extension(file_path):
    """Determine programming language based on file extension."""
    ext_to_lang = {
        '.py': 'Python',
        '.js': 'JavaScript',
        '.ts': 'TypeScript',
        '.jsx': 'JavaScript',
        '.tsx': 'TypeScript',
        '.java': 'Java',
        '.c': 'C',
        '.cpp': 'C++',
        '.cc': 'C++',
        '.cxx': 'C++',
        '.h': 'C/C++',
        '.hpp': 'C++',
        '.cs': 'C#',
        '.php': 'PHP',
        '.rb': 'Ruby',
        '.go': 'Go',
        '.rs': 'Rust',
        '.swift': 'Swift',
        '.kt': 'Kotlin',
        '.scala': 'Scala',
        '.r': 'R',
        '.m': 'Objective-C',
        '.mm': 'Objective-C++',
        '.pl': 'Perl',
        '.lua': 'Lua',
        '.sh': 'Shell',
        '.bash': 'Shell',
        '.zsh': 'Shell',
        '.fish': 'Shell',
        '.ps1': 'PowerShell',
        '.html': 'HTML',
        '.htm': 'HTML',
        '.css': 'CSS',
        '.scss': 'SCSS',
        '.sass': 'Sass',
        '.less': 'Less',
        '.xml': 'XML',
        '.json': 'JSON',
        '.yaml': 'YAML',
        '.yml': 'YAML',
        '.toml': 'TOML',
        '.ini': 'INI',
        '.cfg': 'Config',
        '.conf': 'Config',
        '.sql': 'SQL',
        '.md': 'Markdown',
        '.txt': 'Text',
        '.log': 'Log',
        '.dockerfile': 'Dockerfile',
        '.makefile': 'Makefile',
        '.cmake': 'CMake',
        '.gradle': 'Gradle',
        '.maven': 'Maven',
        '.vim': 'Vim',
        '.el': 'Emacs Lisp',
        '.lisp': 'Lisp',
        '.clj': 'Clojure',
        '.hs': 'Haskell',
        '.ml': 'OCaml',
        '.fs': 'F#',
        '.erl': 'Erlang',
        '.ex': 'Elixir',
        '.dart': 'Dart',
        '.jl': 'Julia',
        '.nim': 'Nim',
        '.zig': 'Zig',
        '.v': 'V',
        '.d': 'D',
        '.pas': 'Pascal',
        '.ada': 'Ada',
        '.f90': 'Fortran',
        '.f95': 'Fortran',
        '.f03': 'Fortran',
        '.f08': 'Fortran',
        '.cob': 'COBOL',
        '.asm': 'Assembly',
        '.s': 'Assembly',
    }
    
    extension = file_path.suffix.lower()
    
    # Handle special cases
    if file_path.name.lower() in ['dockerfile', 'makefile', 'cmakelists.txt']:
        return file_path.name.lower().title()
    
    return ext_to_lang.get(extension, 'Other')

def count_lines_in_file(file_path):
    """Count non-empty lines in a file."""
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = [line.strip() for line in f if line.strip()]
            return len(lines)
    except (IOError, OSError):
        return 0

def analyze_directory(directory_path):
    """Analyze directory and return language statistics."""
    directory = Path(directory_path)
    
    if not directory.exists():
        print(f"Error: Directory '{directory_path}' does not exist.")
        return None
    
    if not directory.is_dir():
        print(f"Error: '{directory_path}' is not a directory.")
        return None
    
    lang_stats = defaultdict(lambda: {'files': 0, 'lines': 0})
    other_extensions = defaultdict(lambda: {'files': 0, 'lines': 0})
    total_files = 0
    total_lines = 0
    
    # Walk through all files in directory and subdirectories
    for file_path in directory.rglob('*'):
        if file_path.is_file():
            language = get_language_by_extension(file_path)
            line_count = count_lines_in_file(file_path)
            
            lang_stats[language]['files'] += 1
            lang_stats[language]['lines'] += line_count
            total_files += 1
            total_lines += line_count
            
            # Track extensions for "Other" category
            if language == 'Other':
                ext = file_path.suffix.lower() if file_path.suffix else '(no extension)'
                other_extensions[ext]['files'] += 1
                other_extensions[ext]['lines'] += line_count
    
    return dict(lang_stats), dict(other_extensions), total_files, total_lines

def print_statistics(lang_stats, other_extensions, total_files, total_lines):
    """Print detailed statistics."""
    print(f"\n{'='*60}")
    print(f"DIRECTORY ANALYSIS RESULTS")
    print(f"{'='*60}")
    print(f"Total Files: {total_files}")
    print(f"Total Lines: {total_lines:,}")
    print(f"{'='*60}")
    
    # Sort by line count (descending)
    sorted_langs = sorted(lang_stats.items(), key=lambda x: x[1]['lines'], reverse=True)
    
    print(f"{'Language':<20} {'Files':<10} {'Lines':<15} {'% of Lines':<10}")
    print(f"{'-'*60}")
    
    for lang, stats in sorted_langs:
        percentage = (stats['lines'] / total_lines * 100) if total_lines > 0 else 0
        print(f"{lang:<20} {stats['files']:<10} {stats['lines']:<15,} {percentage:<10.1f}%")
    
    # Show breakdown of "Other" category if it exists
    if 'Other' in lang_stats and other_extensions:
        print(f"\n{'='*60}")
        print(f"BREAKDOWN OF 'OTHER' CATEGORY")
        print(f"{'='*60}")
        
        # Sort by line count (descending)
        sorted_others = sorted(other_extensions.items(), key=lambda x: x[1]['lines'], reverse=True)
        
        print(f"{'Extension':<20} {'Files':<10} {'Lines':<15} {'% of Other':<10}")
        print(f"{'-'*60}")
        
        other_total_lines = lang_stats['Other']['lines']
        for ext, stats in sorted_others:
            percentage = (stats['lines'] / other_total_lines * 100) if other_total_lines > 0 else 0
            print(f"{ext:<20} {stats['files']:<10} {stats['lines']:<15,} {percentage:<10.1f}%")

def create_pie_chart(lang_stats, total_lines, output_path=None):
    """Create a pie chart showing language distribution by lines of code."""
    if not lang_stats:
        print("No data to create pie chart.")
        return
    
    plt = import_matplotlib()
    if plt is None:
        print("Skipping pie chart generation - matplotlib not available")
        return
    
    # Filter out languages with very small percentages for better visualization
    min_percentage = 1.0
    significant_langs = {}
    other_lines = 0
    
    for lang, stats in lang_stats.items():
        percentage = (stats['lines'] / total_lines * 100) if total_lines > 0 else 0
        if percentage >= min_percentage:
            significant_langs[lang] = stats['lines']
        else:
            other_lines += stats['lines']
    
    if other_lines > 0:
        significant_langs['Other'] = other_lines
    
    # Create pie chart
    plt.figure(figsize=(12, 8))
    
    languages = list(significant_langs.keys())
    line_counts = list(significant_langs.values())
    
    # Create colors
    colors = plt.cm.Set3(range(len(languages)))
    
    # Create pie chart
    wedges, texts, autotexts = plt.pie(line_counts, labels=languages, autopct='%1.1f%%',
                                       colors=colors, startangle=90)
    
    # Customize the chart
    plt.title('Programming Languages Distribution by Lines of Code', fontsize=16, fontweight='bold')
    
    # Make percentage text more readable
    for autotext in autotexts:
        autotext.set_color('white')
        autotext.set_fontweight('bold')
    
    # Add legend
    plt.legend(wedges, [f'{lang}: {count:,} lines' for lang, count in zip(languages, line_counts)],
               title="Languages", loc="center left", bbox_to_anchor=(1, 0, 0.5, 1))
    
    plt.tight_layout()
    
    if output_path:
        plt.savefig(output_path, dpi=300, bbox_inches='tight')
        print(f"\nPie chart saved to: {output_path}")
    else:
        # Save to temporary directory since we're using non-interactive backend
        temp_dir = tempfile.gettempdir()
        default_path = Path(temp_dir) / 'language_distribution.png'
        plt.savefig(default_path, dpi=300, bbox_inches='tight')
        print(f"\nPie chart saved to: {default_path}")
    
    plt.close()  # Free memory

def main():
    parser = argparse.ArgumentParser(description='Analyze programming languages in a directory')
    parser.add_argument('directory', nargs='?', default='.', help='Directory to analyze (default: current directory)')
    parser.add_argument('-o', '--output', help='Output file for pie chart (PNG format)')
    parser.add_argument('--no-chart', action='store_true', help='Skip generating pie chart')
    
    args = parser.parse_args()
    
    # Analyze directory
    result = analyze_directory(args.directory)
    if result is None:
        sys.exit(1)
    
    lang_stats, other_extensions, total_files, total_lines = result
    
    if total_files == 0:
        print("No files found in the directory.")
        sys.exit(0)
    
    # Print statistics
    print_statistics(lang_stats, other_extensions, total_files, total_lines)
    
    # Create pie chart
    if not args.no_chart:
        try:
            create_pie_chart(lang_stats, total_lines, args.output)
        except Exception as e:
            print(f"\nError creating pie chart: {e}")
            print("Continuing with text output only...")

if __name__ == '__main__':
    main()