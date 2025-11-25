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
import contextlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def ensure_venv_bin_on_path() -> None:
    """Prepend the current interpreter's bin directory to PATH so venv tools resolve."""
    bin_dir = Path(sys.executable).parent
    path_parts = os.environ.get("PATH", "").split(os.pathsep)
    if str(bin_dir) not in path_parts:
        os.environ["PATH"] = os.pathsep.join([str(bin_dir)] + path_parts)


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


def process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def wait_for_termination(pid: int, timeout: float = 5.0) -> None:
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        if not process_alive(pid):
            return
        time.sleep(0.1)
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        return


def load_state(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def save_state(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data), encoding="utf-8")


def clear_state(path: Path) -> None:
    with contextlib.suppress(FileNotFoundError):
        path.unlink()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Record audio, transcribe with whisper CLI, and copy to clipboard."
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Whisper model to use (tiny, base, small, medium, large, etc.). Defaults to 'base'.",
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
    parser.add_argument(
        "--action",
        choices=["interactive", "start", "stop", "toggle"],
        default="interactive",
        help="Recording flow: interactive prompts, or start/stop/toggle for automation (e.g. Stream Deck).",
    )
    parser.add_argument(
        "--state-file",
        default="/tmp/voice_clipboard_state.json",
        help="Path to store state between start/stop invocations.",
    )
    return parser.parse_args()


def interactive_flow(args: argparse.Namespace) -> None:
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

        model = args.model or "base"
        print("Transcribing with whisper...")
        transcript_file = run_whisper(audio_path, model, args.language)
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


def handle_start(args: argparse.Namespace, state_path: Path) -> None:
    state = load_state(state_path)
    if state and process_alive(state.get("pid", -1)):
        raise SystemExit(f"Recording already in progress (pid {state['pid']}). Use --action stop.")
    if state and not process_alive(state.get("pid", -1)):
        clear_state(state_path)

    tmpdir = tempfile.mkdtemp(prefix="voice_clipboard_")
    audio_path = Path(tmpdir) / "recording.wav"

    proc = start_recording(audio_path, args.backend, args.input_device, args.input_type)
    model = args.model or "base"

    state_data = {
        "pid": proc.pid,
        "backend": args.backend,
        "input_device": args.input_device,
        "input_type": args.input_type,
        "model": model,
        "language": args.language,
        "no_clipboard": args.no_clipboard,
        "no_notify": args.no_notify,
        "keep_temp": args.keep_temp,
        "tmp_dir": tmpdir,
        "audio_path": str(audio_path),
    }
    save_state(state_path, state_data)
    print(f"Recording started (pid {proc.pid}). State stored at {state_path}.")
    if not args.no_notify:
        notif_used = send_notification(
            "Voice capture started",
            f"Backend: {args.backend}, device: {args.input_device or 'default'}",
        )
        if notif_used:
            print(f"Start notification sent via {notif_used}.")


def handle_stop(
    args: argparse.Namespace, state_path: Path, preloaded_state: dict | None = None
) -> None:
    state = preloaded_state or load_state(state_path)
    if not state:
        raise SystemExit("No active recording state found. Start first.")

    pid = state.get("pid")
    audio_path = Path(state.get("audio_path", ""))
    tmp_dir = Path(state.get("tmp_dir", audio_path.parent))

    if pid and process_alive(pid):
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
        wait_for_termination(pid)

    if not audio_path.exists() or audio_path.stat().st_size == 0:
        clear_state(state_path)
        raise SystemExit(
            f"No audio captured at {audio_path}. Check input device and try again."
        )

    model = args.model or state.get("model", "base")
    language = args.language if args.language is not None else state.get("language")
    no_clipboard = args.no_clipboard or state.get("no_clipboard", False)
    no_notify = args.no_notify or state.get("no_notify", False)
    keep_temp = args.keep_temp or state.get("keep_temp", False)

    if not no_notify:
        notif_used = send_notification(
            "Voice capture stopping",
            f"Transcribing with model {model}...",
        )
        if notif_used:
            print(f"Stop notification sent via {notif_used}.")

    print("Transcribing with whisper...")
    transcript_file = run_whisper(audio_path, model, language)
    transcript = transcript_file.read_text(encoding="utf-8").strip()

    if not transcript:
        raise SystemExit("Whisper returned an empty transcript.")

    print("\n--- Transcript ---\n")
    print(transcript)
    print("\n------------------\n")

    if no_clipboard:
        print("Skipping clipboard copy.")
    else:
        copied_via = copy_to_clipboard(transcript)
        if copied_via:
            print(f"Transcription copied to clipboard via {copied_via}.")
        else:
            print("Could not copy to clipboard automatically. See transcript above.")

    if not no_notify:
        snippet = transcript if len(transcript) <= 120 else transcript[:117] + "..."
        notif_used = send_notification("Voice transcript ready", snippet)
        if notif_used:
            print(f"Notification sent via {notif_used}.")
        else:
            print("Notification command not available; skipped.")

    if keep_temp:
        print(f"Keeping temp files in: {tmp_dir}")
    else:
        with contextlib.suppress(Exception):
            shutil.rmtree(tmp_dir, ignore_errors=True)

    clear_state(state_path)
    print("Recording state cleared.")


def main() -> None:
    ensure_venv_bin_on_path()
    args = parse_args()
    state_path = Path(args.state_file)

    if args.action == "interactive":
        ensure_tool(args.backend)
        ensure_tool("whisper")
        interactive_flow(args)
        return

    if args.action == "start":
        ensure_tool(args.backend)
        ensure_tool("whisper")
        handle_start(args, state_path)
        return

    if args.action == "stop":
        ensure_tool("whisper")
        handle_stop(args, state_path)
        return

    if args.action == "toggle":
        state = load_state(state_path)
        alive = state is not None and process_alive(state.get("pid", -1))
        if alive:
            ensure_tool("whisper")
            handle_stop(args, state_path, preloaded_state=state)
        else:
            ensure_tool(args.backend)
            ensure_tool("whisper")
            handle_start(args, state_path)
        return


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        sys.exit(f"Command failed: {exc}")
    except Exception as exc:  # noqa: BLE001
        sys.exit(str(exc))
