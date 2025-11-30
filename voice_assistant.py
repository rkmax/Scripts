#!/home/rkmax/Development/Scripts/.venv_voice_clipboard/bin/python
"""
Minimal streaming voice assistant:
- Captures microphone audio continuously.
- Transcribes short chunks with Whisper (Python API, no CLI).
- Sends only new text through a FIFO to ydotool for typing in the focused window.
"""

from __future__ import annotations

import argparse
import queue
import subprocess
import sys
import threading
import time
from typing import Optional

import numpy as np
import soundcard as sc
import whisper


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Stream mic audio, transcribe with Whisper, and type via ydotool."
    )
    parser.add_argument(
        "--model",
        default="base",
        help="Whisper model name (tiny, base, small, medium, large, etc.). Defaults to base.",
    )
    parser.add_argument(
        "--language",
        default=None,
        help="Optional language hint passed to Whisper (e.g., 'es').",
    )
    parser.add_argument(
        "--input-device",
        default=None,
        help="Optional microphone name/substring or index (as shown by soundcard).",
    )
    parser.add_argument(
        "--chunk-seconds",
        type=float,
        default=1.5,
        help="Audio duration (seconds) per transcription attempt.",
    )
    parser.add_argument(
        "--rms-threshold",
        type=float,
        default=0.01,
        help="Skip chunks whose RMS amplitude is below this value (0-1 range).",
    )
    parser.add_argument(
        "--min-text-len",
        type=int,
        default=3,
        help="Minimum number of characters to send to ydotool.",
    )
    parser.add_argument(
        "--list-devices",
        action="store_true",
        help="List available input devices (including loopback) and exit.",
    )
    return parser.parse_args()


def pick_microphone(device: str | None) -> sc.Microphone:
    if device is None:
        mic = sc.default_microphone()
        if mic is None:
            raise SystemExit("No default microphone available.")
        return mic

    mics = sc.all_microphones(include_loopback=True)
    if device.isdigit():
        idx = int(device)
        if 0 <= idx < len(mics):
            return mics[idx]
        raise SystemExit(f"Input index {idx} not found. Available: 0..{len(mics) - 1}")

    for mic in mics:
        if device.lower() in mic.name.lower():
            return mic

    available = ", ".join(m.name for m in mics) or "none"
    raise SystemExit(f"No microphone matching '{device}'. Available: {available}")


def type_with_ydotool(text: str) -> None:
    subprocess.run(["ydotool", "type", text], check=True)


def delta_text(current: str, previous: str) -> str:
    current = current.strip()
    previous = previous.strip()
    if not previous:
        return current
    if current.startswith(previous):
        return current[len(previous) :].strip()
    return current


def transcription_worker(
    audio_q: "queue.Queue[bytes]",
    typing_q: "queue.Queue[str]",
    stop_event: threading.Event,
    model: whisper.Whisper,
    sample_rate: int,
    chunk_seconds: float,
    rms_threshold: float,
    min_text_len: int,
    language: Optional[str],
) -> None:
    bytes_per_sample = 2  # int16
    target_bytes = int(sample_rate * chunk_seconds * bytes_per_sample)
    buffer = bytearray()
    last_text = ""

    while not stop_event.is_set():
        try:
            chunk = audio_q.get(timeout=0.3)
        except queue.Empty:
            continue
        buffer.extend(chunk)
        if len(buffer) < target_bytes:
            continue

        audio_np = np.frombuffer(buffer, dtype=np.int16).astype(np.float32) / 32768.0
        rms = float(np.sqrt(np.mean(np.square(audio_np)))) if audio_np.size else 0.0
        if rms < rms_threshold:
            buffer.clear()
            continue

        try:
            result = model.transcribe(
                audio_np, fp16=False, language=language, verbose=False
            )
            text = result.get("text", "").strip()
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] Whisper failed: {exc}", file=sys.stderr)
            buffer.clear()
            continue

        if text and len(text) >= min_text_len:
            new_text = delta_text(text, last_text)
            if not new_text and text == last_text:
                new_text = " "
            if new_text:
                if not new_text.endswith(" "):
                    new_text = f"{new_text} "
                typing_q.put(new_text)
                last_text = text

        buffer.clear()


def typing_worker(
    typing_q: "queue.Queue[str]",
    stop_event: threading.Event,
) -> None:
    while not stop_event.is_set() or not typing_q.empty():
        try:
            text = typing_q.get(timeout=0.2)
        except queue.Empty:
            continue
        try:
            type_with_ydotool(text)
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] ydotool failed: {exc}", file=sys.stderr)


def main() -> None:
    args = parse_args()
    if args.list_devices:
        default_mic = sc.default_microphone()
        default_name = default_mic.name if default_mic else None
        for idx, mic in enumerate(sc.all_microphones(include_loopback=True)):
            marker = " (default)" if mic.name == default_name else ""
            print(f"{idx}: {mic.name}{marker}")
        return
    sample_rate = 16000

    print(f"Loading Whisper model '{args.model}'...", file=sys.stderr)
    model = whisper.load_model(args.model)

    audio_q: "queue.Queue[bytes]" = queue.Queue()
    typing_q: "queue.Queue[str]" = queue.Queue()
    stop_event = threading.Event()

    transcriber = threading.Thread(
        target=transcription_worker,
        args=(
            audio_q,
            typing_q,
            stop_event,
            model,
            sample_rate,
            args.chunk_seconds,
            args.rms_threshold,
            args.min_text_len,
            args.language,
        ),
        daemon=True,
    )
    typer = threading.Thread(
        target=typing_worker,
        args=(typing_q, stop_event),
        daemon=True,
    )

    mic = pick_microphone(args.input_device)
    block_frames = 1024
    print(f"Using microphone: {mic.name}", file=sys.stderr)
    print("Starting audio capture. Press Ctrl+C to stop.", file=sys.stderr)

    transcriber.start()
    typer.start()

    try:
        with mic.recorder(samplerate=sample_rate, blocksize=block_frames, channels=1) as recorder:
            while not stop_event.is_set():
                data = recorder.record(numframes=block_frames)
                if data.size == 0:
                    continue
                samples = data.astype(np.float32)
                if samples.ndim > 1:
                    samples = samples.mean(axis=1)
                samples = np.clip(samples, -1.0, 1.0)
                audio_bytes = (samples * 32768.0).astype(np.int16).tobytes()
                audio_q.put(audio_bytes)
                time.sleep(0.01)
    except KeyboardInterrupt:
        print("\nStopping...", file=sys.stderr)
    finally:
        stop_event.set()

    transcriber.join(timeout=2.0)
    typer.join(timeout=2.0)
    print("Exited cleanly.", file=sys.stderr)


if __name__ == "__main__":
    main()
