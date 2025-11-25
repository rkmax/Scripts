#!/home/rkmax/Development/Scripts/.venv_voice_clipboard/bin/python
"""
Quick CLI to record microphone audio, transcribe it with whisper CLI,
and push the result into the system clipboard.

Prerequisites:
- sox installed and available in PATH (for recording).
- whisper CLI from openai-whisper (`pip install -U openai-whisper`).
- Clipboard helper: pbcopy (macOS), wl-copy or xclip (Linux), or clip (Windows).
  The script will try tkinter as a last resort if those commands are absent.
"""

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def ensure_tool(tool_name: str) -> None:
    if shutil.which(tool_name):
        return
    raise SystemExit(f"Required tool '{tool_name}' was not found in PATH.")


def start_recording(
    target: Path,
    backend: str,
    input_device: str | None,
    input_type: str | None,
) -> subprocess.Popen:
    if backend == "pw-record":
        cmd = ["pw-record", "--channels", "1", "--rate", "16000"]
        if input_device:
            cmd.extend(["--target", input_device])
        cmd.append(str(target))
    else:
        cmd = ["sox"]
        if input_type:
            cmd.extend(["-t", input_type])
        cmd.append(input_device or "-d")
        cmd.extend(["-c", "1", "-r", "16000", "-b", "16", str(target)])

    try:
        return subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except FileNotFoundError as exc:
        raise SystemExit(f"{backend} is not installed or not in PATH.") from exc


def stop_recording(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


def run_whisper(audio_path: Path, model: str, language: str | None) -> Path:
    cmd = [
        "whisper",
        str(audio_path),
        "--model",
        model,
        "--output_format",
        "txt",
        "--output_dir",
        str(audio_path.parent),
    ]
    if language:
        cmd.extend(["--language", language])

    subprocess.run(cmd, check=True)

    expected = audio_path.with_suffix(".txt")
    if expected.exists():
        return expected

    for candidate in audio_path.parent.glob("*.txt"):
        if audio_path.stem in candidate.stem:
            return candidate

    raise RuntimeError("Could not locate transcription output produced by whisper.")


def copy_to_clipboard(text: str) -> str | None:
    candidates = [
        ["pbcopy"],
        ["wl-copy"],
        ["xclip", "-selection", "clipboard"],
        ["clip"],
    ]

    for cmd in candidates:
        if shutil.which(cmd[0]) is None:
            continue
        try:
            subprocess.run(cmd, input=text.encode("utf-8"), check=True)
            return cmd[0]
        except subprocess.CalledProcessError:
            continue

    try:
        import tkinter  # type: ignore

        root = tkinter.Tk()
        root.withdraw()
        root.clipboard_clear()
        root.clipboard_append(text)
        root.update()
        root.destroy()
        return "tkinter"
    except Exception:
        return None


def send_notification(title: str, message: str) -> str | None:
    title = title.strip()
    message = message.strip()
    escaped_title = title.replace("\\", "\\\\").replace('"', '\\"')
    escaped_message = message.replace("\\", "\\\\").replace('"', '\\"')

    commands = [
        ["notify-send", title, message],
        ["osascript", "-e", f'display notification "{escaped_message}" with title "{escaped_title}"'],
        ["terminal-notifier", "-title", title, "-message", message],
    ]

    for cmd in commands:
        if shutil.which(cmd[0]) is None:
            continue
        try:
            subprocess.run(cmd, check=True)
            return cmd[0]
        except subprocess.CalledProcessError:
            continue
    return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Record audio, transcribe with whisper CLI, and copy to clipboard."
    )
    parser.add_argument(
        "--model",
        default="base",
        help="Whisper model to use (tiny, base, small, medium, large, etc.).",
    )
    parser.add_argument(
        "--language",
        default=None,
        help="Language hint passed to whisper (e.g. 'Spanish'). Leave empty to auto-detect.",
    )
    parser.add_argument(
        "--no-clipboard",
        action="store_true",
        help="Do not attempt to copy the transcription to the clipboard.",
    )
    parser.add_argument(
        "--no-notify",
        action="store_true",
        help="Do not attempt to send a desktop notification when done.",
    )
    parser.add_argument(
        "--input-device",
        default=None,
        help="Sox input device (e.g. 'default', 'hw:0,0', or a Pulse source name). Defaults to '-d'.",
    )
    parser.add_argument(
        "--input-type",
        default=None,
        help="Sox input type if Sox cannot infer it (e.g. 'pulse', 'alsa').",
    )
    parser.add_argument(
        "--keep-temp",
        action="store_true",
        help="Keep temporary WAV/TXT files for inspection (prints the directory path).",
    )
    parser.add_argument(
        "--backend",
        choices=["sox", "pw-record"],
        default="sox",
        help="Recording backend to use. 'pw-record' works well on PipeWire; 'sox' is the default.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ensure_tool(args.backend)
    ensure_tool("whisper")

    temp_ctx = None
    if args.keep_temp:
        tmpdir = tempfile.mkdtemp(prefix="voice_clipboard_")
        cleanup = lambda: None  # noqa: E731
        print(f"Keeping temp files in: {tmpdir}")
    else:
        temp_ctx = tempfile.TemporaryDirectory(prefix="voice_clipboard_")
        tmpdir = temp_ctx.name
        cleanup = temp_ctx.cleanup

    try:
        tmp_path = Path(tmpdir)
        audio_path = tmp_path / "recording.wav"

        print("Press Enter to start recording. Press Enter again to stop.")
        input()

        proc = start_recording(audio_path, args.backend, args.input_device, args.input_type)
        try:
            input("Recording... press Enter to stop.\n")
        except KeyboardInterrupt:
            print("\nStopping recording...")
        finally:
            stop_recording(proc)

        if not audio_path.exists() or audio_path.stat().st_size == 0:
            raise SystemExit(
                "No audio captured. Check microphone permissions, input device, and try again."
            )

        print("Transcribing with whisper...")
        transcript_file = run_whisper(audio_path, args.model, args.language)
        transcript = transcript_file.read_text(encoding="utf-8").strip()

        if not transcript:
            raise SystemExit("Whisper returned an empty transcript.")

        print("\n--- Transcript ---\n")
        print(transcript)
        print("\n------------------\n")

        if args.no_clipboard:
            print("Skipping clipboard copy.")
        else:
            copied_via = copy_to_clipboard(transcript)
            if copied_via:
                print(f"Transcription copied to clipboard via {copied_via}.")
            else:
                print("Could not copy to clipboard automatically. See transcript above.")

        if not args.no_notify:
            snippet = transcript if len(transcript) <= 120 else transcript[:117] + "..."
            notif_used = send_notification("Voice transcript ready", snippet)
            if notif_used:
                print(f"Notification sent via {notif_used}.")
            else:
                print("Notification command not available; skipped.")
    finally:
        cleanup()


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        sys.exit(f"Command failed: {exc}")
    except Exception as exc:  # noqa: BLE001
        sys.exit(str(exc))
