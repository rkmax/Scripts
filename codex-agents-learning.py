#!/usr/bin/env python3

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime as dt
import difflib
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SCRIPT_TASK_MARKER = "[[CODEX_SESSION_AUTOPROC_V1]]"
AUTO_SECTION_START = "<!-- codex-session-learnings:start -->"
AUTO_SECTION_END = "<!-- codex-session-learnings:end -->"
STATE_SCHEMA_VERSION = 1
DEFAULT_LIMIT = 10
DEFAULT_WORKERS = 4
DEFAULT_TIMEOUT_SECONDS = 240
DEFAULT_MODEL_REASONING = "high"
MAX_SESSION_MESSAGES = 60
MAX_SESSION_TEXT_CHARS = 60_000
MAX_PER_SESSION_PROPOSALS = 3
MAX_FINAL_RULES = 8


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def normalize_text(value: str) -> str:
    lowered = value.strip().lower()
    lowered = re.sub(r"\s+", " ", lowered)
    lowered = re.sub(r"[^a-z0-9áéíóúüñ]+", " ", lowered)
    return lowered.strip()


def clean_rule_text(value: str) -> str:
    cleaned = value.strip()
    cleaned = re.sub(r"^[-*•]+\s*", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_session_timestamp(path: Path) -> dt.datetime:
    match = re.search(r"rollout-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})", path.name)
    if match:
        date_part, hh, mm, ss = match.groups()
        timestamp = f"{date_part}T{hh}:{mm}:{ss}+00:00"
        return dt.datetime.fromisoformat(timestamp)
    return dt.datetime.fromtimestamp(path.stat().st_mtime, tz=dt.timezone.utc)


def session_contains_marker(path: Path, marker: str) -> bool:
    with path.open("r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            if marker in line:
                return True
    return False


def extract_json_object(raw_output: str) -> dict[str, Any]:
    text = raw_output.strip()
    fenced = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    else:
        first = text.find("{")
        last = text.rfind("}")
        if first != -1 and last != -1 and last > first:
            text = text[first : last + 1]
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("Expected a JSON object.")
    return parsed


def unique_rules(rules: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for item in rules:
        cleaned = clean_rule_text(item)
        if not cleaned:
            continue
        key = normalize_text(cleaned)
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(cleaned)
    return output


def extract_existing_auto_rules(agents_text: str) -> list[str]:
    start = agents_text.find(AUTO_SECTION_START)
    end = agents_text.find(AUTO_SECTION_END)
    if start == -1 or end == -1 or end <= start:
        return []
    body = agents_text[start + len(AUTO_SECTION_START) : end]
    rules: list[str] = []
    for raw_line in body.splitlines():
        line = raw_line.strip()
        if line.startswith("- "):
            rules.append(line[2:].strip())
    return rules


def extract_all_agents_bullets(agents_text: str) -> list[str]:
    bullets: list[str] = []
    for raw_line in agents_text.splitlines():
        line = raw_line.strip()
        if line.startswith("- "):
            bullets.append(line[2:].strip())
    return bullets


def update_agents_text(agents_text: str, rules: list[str]) -> str:
    header = "## 🧠 Aprendizajes de sesiones (auto)"
    block_lines = [
        AUTO_SECTION_START,
        *[f"- {rule}" for rule in rules],
        AUTO_SECTION_END,
    ]
    block = "\n".join(block_lines)

    start = agents_text.find(AUTO_SECTION_START)
    end = agents_text.find(AUTO_SECTION_END)
    if not rules:
        return agents_text

    if start != -1 and end != -1 and end > start:
        end += len(AUTO_SECTION_END)
        before = agents_text[:start].rstrip()
        after = agents_text[end:].lstrip("\n")
        merged = f"{before}\n{block}\n"
        if after:
            merged = f"{merged}\n{after}"
        return merged

    suffix = "\n\n---\n"
    suffix += f"{header}\n\n"
    suffix += f"{block}\n"
    return agents_text.rstrip() + suffix


def build_diff(original: str, updated: str, file_label: str) -> str:
    diff_lines = list(
        difflib.unified_diff(
        original.splitlines(),
        updated.splitlines(),
        fromfile=file_label,
        tofile=f"{file_label}.candidate",
        lineterm="",
    )
    )
    if not diff_lines:
        return ""
    return "\n".join(diff_lines) + "\n"


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "schema_version": STATE_SCHEMA_VERSION,
            "script_task_marker": SCRIPT_TASK_MARKER,
            "processed_sessions": {},
            "failed_sessions": {},
            "analysis_records": {},
            "merge_backlog": [],
            "runs": {},
            "applied_previews": [],
        }
    loaded = json.loads(read_text(path))
    if loaded.get("schema_version") != STATE_SCHEMA_VERSION:
        raise RuntimeError(
            f"Unsupported state schema version: {loaded.get('schema_version')} "
            f"(expected {STATE_SCHEMA_VERSION})."
        )
    return loaded


def save_state(path: Path, state: dict[str, Any]) -> None:
    state["schema_version"] = STATE_SCHEMA_VERSION
    state["script_task_marker"] = SCRIPT_TASK_MARKER
    write_text(path, json.dumps(state, indent=2, ensure_ascii=False) + "\n")


def run_codex(
    prompt: str,
    model: str | None,
    reasoning: str,
    timeout_seconds: int,
) -> str:
    args = ["codex", "exec"]
    if model:
        args.extend(["--model", model])
    args.extend(
        [
            "-c",
            f'model_reasoning_effort="{reasoning}"',
            "--skip-git-repo-check",
            "--color",
            "never",
            "-",
        ]
    )

    process = subprocess.run(
        args,
        input=prompt,
        text=True,
        capture_output=True,
        timeout=timeout_seconds,
        check=False,
    )
    if process.returncode != 0:
        stderr = process.stderr.strip()
        raise RuntimeError(f"codex exec failed ({process.returncode}): {stderr}")
    return process.stdout.strip()


def discover_sessions(codex_home: Path) -> list[Path]:
    sessions_root = codex_home / "sessions"
    if not sessions_root.exists():
        return []
    sessions = [path for path in sessions_root.rglob("*.jsonl") if path.is_file()]
    sessions.sort(key=parse_session_timestamp, reverse=True)
    return sessions


def rel_session_path(codex_home: Path, session_path: Path) -> str:
    return session_path.relative_to(codex_home / "sessions").as_posix()


def is_agents_boilerplate_user_message(text: str) -> bool:
    return "AGENTS.md instructions for" in text and "<INSTRUCTIONS>" in text


def collect_session_messages(session_path: Path) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    with session_path.open("r", encoding="utf-8", errors="ignore") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            raw_line = raw_line.strip()
            if not raw_line:
                continue
            try:
                event = json.loads(raw_line)
            except json.JSONDecodeError:
                continue

            if event.get("type") != "response_item":
                continue
            payload = event.get("payload", {})
            if payload.get("type") != "message":
                continue

            role = payload.get("role")
            if role not in {"user", "assistant"}:
                continue

            content_items = payload.get("content", [])
            text_parts: list[str] = []
            if isinstance(content_items, list):
                for item in content_items:
                    if not isinstance(item, dict):
                        continue
                    text = item.get("text")
                    if isinstance(text, str):
                        text_parts.append(text)
            text = "\n".join(part.strip() for part in text_parts if part.strip()).strip()
            if not text:
                continue

            if SCRIPT_TASK_MARKER in text:
                continue
            if role == "user" and is_agents_boilerplate_user_message(text):
                continue

            messages.append(
                {
                    "role": role,
                    "line": line_number,
                    "text": text,
                }
            )
    return messages


def compact_session_transcript(messages: list[dict[str, Any]]) -> tuple[str, int]:
    if not messages:
        return "", 0

    selected = messages[-MAX_SESSION_MESSAGES:]
    rendered: list[str] = []
    char_budget = MAX_SESSION_TEXT_CHARS
    used = 0

    for index, item in enumerate(selected, start=1):
        snippet = item["text"]
        remaining = char_budget - used
        if remaining <= 0:
            break
        if len(snippet) > remaining:
            snippet = snippet[:remaining]
        rendered.append(
            f"[{index}] role={item['role']} source_line={item['line']}\n{snippet}\n"
        )
        used += len(snippet)

    return "\n".join(rendered).strip(), len(rendered)


def build_session_analysis_prompt(
    relpath: str,
    analysis_output_hint: Path,
    agents_snapshot: str,
    transcript: str,
    message_count: int,
) -> str:
    return f"""You are analyzing one Codex session to extract durable AGENTS.md improvements.

TASK_MARKER: {SCRIPT_TASK_MARKER}
TASK_TYPE: session_analysis
SESSION: {relpath}
OUTPUT_HINT: {analysis_output_hint}

Rules:
- Return JSON only, no markdown and no explanations outside JSON.
- Keep focus on durable, reusable operating rules only.
- Do not propose personal tastes, one-off requests, or tool-specific trivia.
- Only include rules that are NOT already covered in AGENTS.md.
- Max {MAX_PER_SESSION_PROPOSALS} proposals.
- Proposals must be written in clear Spanish because AGENTS.md is in Spanish.

Expected JSON schema:
{{
  "marker": "{SCRIPT_TASK_MARKER}",
  "task_type": "session_analysis",
  "session_relpath": "{relpath}",
  "summary": "short summary",
  "proposals": [
    {{
      "instruction": "single bullet line for AGENTS.md",
      "category": "workflow|verification|communication|coding|other",
      "why": "brief reason",
      "evidence": [
        {{
          "message_index": 1,
          "quote": "short quote from user message"
        }}
      ],
      "confidence": "low|medium|high"
    }}
  ],
  "discarded": [
    {{
      "candidate": "text",
      "reason": "why discarded"
    }}
  ],
  "no_new_rules_reason": "optional"
}}

Current AGENTS.md:
<<<AGENTS
{agents_snapshot}
AGENTS

Session transcript ({message_count} messages, condensed):
<<<TRANSCRIPT
{transcript}
TRANSCRIPT
"""


def build_consolidation_prompt(
    agents_text: str,
    dedup_candidates: list[dict[str, Any]],
    output_hint: Path,
) -> str:
    candidates_json = json.dumps(dedup_candidates, ensure_ascii=False, indent=2)
    return f"""You are consolidating candidate AGENTS.md additions from multiple sessions.

TASK_MARKER: {SCRIPT_TASK_MARKER}
TASK_TYPE: consolidate_proposals
OUTPUT_HINT: {output_hint}

Rules:
- Return JSON only.
- Keep only durable and general rules.
- Reject tastes, temporary preferences, or duplicated policy.
- Rules must be in Spanish, concise, and bullet-ready for AGENTS.md.
- Keep at most {MAX_FINAL_RULES} selected rules.

Expected JSON schema:
{{
  "marker": "{SCRIPT_TASK_MARKER}",
  "task_type": "consolidate_proposals",
  "selected_rules": [
    {{
      "instruction": "single bullet line in Spanish",
      "source_sessions": ["2026/02/09/rollout-...jsonl"],
      "reason": "short reason"
    }}
  ],
  "rejected_rules": [
    {{
      "instruction": "rule",
      "reason": "why rejected"
    }}
  ]
}}

Current AGENTS.md:
<<<AGENTS
{agents_text}
AGENTS

Candidate rules:
<<<CANDIDATES
{candidates_json}
CANDIDATES
"""


def list_command(args: argparse.Namespace) -> int:
    codex_home = Path(args.codex_home).expanduser().resolve()
    processing_root = Path(args.processing_root).expanduser().resolve()
    state_path = processing_root / "state.json"
    state = load_state(state_path)

    sessions = discover_sessions(codex_home)
    processed = state.get("processed_sessions", {})
    pending_count = 0
    ignored_count = 0
    processed_count = 0

    rows: list[str] = []
    for session_path in sessions:
        relpath = rel_session_path(codex_home, session_path)
        if relpath in processed:
            status = "processed"
            processed_count += 1
        elif session_contains_marker(session_path, SCRIPT_TASK_MARKER):
            status = "ignored-marker"
            ignored_count += 1
        else:
            status = "pending"
            pending_count += 1
        rows.append(f"{status:14} {relpath}")

    limit = args.limit if args.limit and args.limit > 0 else len(rows)
    print(f"Sessions root: {codex_home / 'sessions'}")
    print(f"Total: {len(rows)} | pending: {pending_count} | processed: {processed_count} | ignored-marker: {ignored_count}")
    for line in rows[:limit]:
        print(line)
    return 0


@dataclass
class PreparedSession:
    source_path: Path
    relpath: str
    copied_path: Path
    sha256: str


def prepare_run_directories(processing_root: Path) -> tuple[str, Path]:
    run_id = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = processing_root / "runs" / run_id
    for sub in ["sessions", "analysis", "consolidation", "preview", "logs"]:
        (run_dir / sub).mkdir(parents=True, exist_ok=True)
    return run_id, run_dir


def select_pending_sessions(
    codex_home: Path,
    state: dict[str, Any],
    limit: int,
) -> list[Path]:
    processed = state.get("processed_sessions", {})
    selected: list[Path] = []
    for session_path in discover_sessions(codex_home):
        relpath = rel_session_path(codex_home, session_path)
        if relpath in processed:
            continue
        if session_contains_marker(session_path, SCRIPT_TASK_MARKER):
            continue
        selected.append(session_path)
        if len(selected) >= limit:
            break
    return selected


def copy_sessions_for_run(
    codex_home: Path,
    run_dir: Path,
    selected_sessions: list[Path],
) -> list[PreparedSession]:
    prepared: list[PreparedSession] = []
    for source_path in selected_sessions:
        relpath = rel_session_path(codex_home, source_path)
        destination = run_dir / "sessions" / relpath
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, destination)
        prepared.append(
            PreparedSession(
                source_path=source_path,
                relpath=relpath,
                copied_path=destination,
                sha256=sha256_file(destination),
            )
        )
    return prepared


@dataclass
class SessionAnalysisResult:
    relpath: str
    sha256: str
    status: str
    analysis_json_path: str
    error: str = ""


def analyze_prepared_session(
    prepared: PreparedSession,
    run_dir: Path,
    agents_snapshot: str,
    model: str | None,
    reasoning: str,
    timeout_seconds: int,
) -> SessionAnalysisResult:
    messages = collect_session_messages(prepared.copied_path)
    transcript, message_count = compact_session_transcript(messages)

    stem = Path(prepared.relpath).stem
    analysis_json_path = run_dir / "analysis" / f"{stem}.json"
    analysis_raw_path = run_dir / "analysis" / f"{stem}.raw.txt"
    prompt_log_path = run_dir / "logs" / f"{stem}.session_analysis.prompt.txt"

    if message_count == 0:
        empty_payload = {
            "marker": SCRIPT_TASK_MARKER,
            "task_type": "session_analysis",
            "session_relpath": prepared.relpath,
            "summary": "No relevant messages after filtering.",
            "proposals": [],
            "discarded": [],
            "no_new_rules_reason": "No relevant transcript content.",
        }
        write_text(
            analysis_json_path,
            json.dumps(empty_payload, indent=2, ensure_ascii=False) + "\n",
        )
        write_text(analysis_raw_path, "No relevant messages for analysis.\n")
        return SessionAnalysisResult(
            relpath=prepared.relpath,
            sha256=prepared.sha256,
            status="no-content",
            analysis_json_path=str(analysis_json_path),
        )

    prompt = build_session_analysis_prompt(
        relpath=prepared.relpath,
        analysis_output_hint=analysis_json_path,
        agents_snapshot=agents_snapshot,
        transcript=transcript,
        message_count=message_count,
    )
    write_text(prompt_log_path, prompt)

    try:
        raw_output = run_codex(
            prompt=prompt,
            model=model,
            reasoning=reasoning,
            timeout_seconds=timeout_seconds,
        )
        write_text(analysis_raw_path, raw_output + "\n")
        parsed = extract_json_object(raw_output)
        if parsed.get("marker") != SCRIPT_TASK_MARKER:
            raise ValueError("Invalid marker in session analysis response.")
        parsed["session_relpath"] = prepared.relpath
        write_text(analysis_json_path, json.dumps(parsed, indent=2, ensure_ascii=False) + "\n")
    except Exception as exc:
        message = str(exc)
        write_text(analysis_raw_path, f"ERROR: {message}\n")
        return SessionAnalysisResult(
            relpath=prepared.relpath,
            sha256=prepared.sha256,
            status="failed",
            analysis_json_path=str(analysis_json_path),
            error=message,
        )

    return SessionAnalysisResult(
        relpath=prepared.relpath,
        sha256=prepared.sha256,
        status="ok",
        analysis_json_path=str(analysis_json_path),
    )


def score_confidence(value: str) -> int:
    return {"low": 1, "medium": 2, "high": 3}.get(value.strip().lower(), 0)


def deduplicate_candidates(analysis_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for item in analysis_items:
        instruction = clean_rule_text(str(item.get("instruction", "")))
        if not instruction:
            continue
        key = normalize_text(instruction)
        if not key:
            continue
        current = grouped.get(key)
        source_sessions = item.get("source_sessions", [])
        confidence = str(item.get("confidence", "")).strip().lower()
        if current is None:
            grouped[key] = {
                "instruction": instruction,
                "confidence": confidence,
                "source_sessions": list(dict.fromkeys(source_sessions)),
                "reasons": [item.get("why", "")],
                "evidence": item.get("evidence", []),
            }
            continue
        if score_confidence(confidence) > score_confidence(str(current.get("confidence", ""))):
            current["instruction"] = instruction
            current["confidence"] = confidence
        current["source_sessions"] = list(
            dict.fromkeys(list(current.get("source_sessions", [])) + list(source_sessions))
        )
        if item.get("why"):
            current.setdefault("reasons", []).append(item["why"])
        existing_evidence = list(current.get("evidence", []))
        existing_evidence.extend(item.get("evidence", []))
        current["evidence"] = existing_evidence[:8]
    return list(grouped.values())


def run_command(args: argparse.Namespace) -> int:
    codex_home = Path(args.codex_home).expanduser().resolve()
    processing_root = Path(args.processing_root).expanduser().resolve()
    agents_path = Path(args.agents_path).expanduser().resolve()
    limit = max(1, args.limit)
    workers = max(1, args.workers)

    processing_root.mkdir(parents=True, exist_ok=True)
    state_path = processing_root / "state.json"
    state = load_state(state_path)

    run_id, run_dir = prepare_run_directories(processing_root)
    selected_sources = select_pending_sessions(codex_home, state, limit=limit)
    prepared_sessions = copy_sessions_for_run(codex_home, run_dir, selected_sources)

    run_manifest = {
        "run_id": run_id,
        "created_at": utc_now(),
        "limit": limit,
        "workers": workers,
        "selected_sessions": [session.relpath for session in prepared_sessions],
        "processed_sessions": [],
        "failed_sessions": [],
        "preview_generated": False,
    }
    state.setdefault("runs", {})[run_id] = run_manifest
    save_state(state_path, state)

    if not prepared_sessions:
        print("No pending sessions found.")
        print(f"Run id: {run_id}")
        return 0

    agents_snapshot = read_text(agents_path)
    write_text(run_dir / "logs" / "AGENTS.snapshot.md", agents_snapshot)

    if shutil.which("codex") is None:
        raise RuntimeError("codex CLI not found in PATH.")

    analysis_records = state.setdefault("analysis_records", {})
    processed_sessions = state.setdefault("processed_sessions", {})
    failed_sessions = state.setdefault("failed_sessions", {})
    merge_backlog = state.setdefault("merge_backlog", [])

    worker_count = min(workers, len(prepared_sessions))
    run_manifest["effective_workers"] = worker_count
    future_to_prepared: dict[Any, PreparedSession] = {}
    model = args.model or None
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        for prepared in prepared_sessions:
            future = executor.submit(
                analyze_prepared_session,
                prepared,
                run_dir,
                agents_snapshot,
                model,
                args.reasoning,
                args.timeout_seconds,
            )
            future_to_prepared[future] = prepared

        for future in as_completed(future_to_prepared):
            prepared = future_to_prepared[future]
            try:
                result = future.result()
            except Exception as exc:
                stem = Path(prepared.relpath).stem
                analysis_json_path = str(run_dir / "analysis" / f"{stem}.json")
                analysis_raw_path = run_dir / "analysis" / f"{stem}.raw.txt"
                message = f"Unexpected worker failure: {exc}"
                write_text(analysis_raw_path, f"ERROR: {message}\n")
                result = SessionAnalysisResult(
                    relpath=prepared.relpath,
                    sha256=prepared.sha256,
                    status="failed",
                    analysis_json_path=analysis_json_path,
                    error=message,
                )

            if result.status == "failed":
                run_manifest["failed_sessions"].append(result.relpath)
                failed = failed_sessions.get(result.relpath, {"count": 0})
                failed["count"] = int(failed.get("count", 0)) + 1
                failed["last_error"] = result.error
                failed["last_failed_at"] = utc_now()
                failed_sessions[result.relpath] = failed
                save_state(state_path, state)
                continue

            processed_sessions[result.relpath] = {
                "processed_at": utc_now(),
                "sha256": result.sha256,
                "run_id": run_id,
                "analysis_json": result.analysis_json_path,
                "result": result.status,
            }
            failed_sessions.pop(result.relpath, None)

            record_id = f"{run_id}:{result.relpath}"
            analysis_records[record_id] = {
                "recorded_at": utc_now(),
                "run_id": run_id,
                "session_relpath": result.relpath,
                "analysis_json": result.analysis_json_path,
            }
            if record_id not in merge_backlog:
                merge_backlog.append(record_id)
            run_manifest["processed_sessions"].append(result.relpath)
            save_state(state_path, state)

    save_state(state_path, state)

    backlog_items: list[dict[str, Any]] = []
    for record_id in list(merge_backlog):
        record = analysis_records.get(record_id)
        if not record:
            continue
        analysis_path = Path(record["analysis_json"])
        if not analysis_path.exists():
            continue
        parsed = json.loads(read_text(analysis_path))
        proposals = parsed.get("proposals", [])
        if not isinstance(proposals, list):
            continue
        for proposal in proposals:
            if not isinstance(proposal, dict):
                continue
            proposal_copy = dict(proposal)
            proposal_copy["source_sessions"] = [record.get("session_relpath", "")]
            backlog_items.append(proposal_copy)

    dedup_candidates = deduplicate_candidates(backlog_items)
    consolidation_prompt_path = run_dir / "logs" / "consolidation.prompt.txt"
    consolidation_raw_path = run_dir / "consolidation" / "consolidation.raw.txt"
    consolidation_json_path = run_dir / "consolidation" / "consolidation.json"

    selected_rules: list[str] = []
    selected_with_sources: list[dict[str, Any]] = []
    if dedup_candidates:
        consolidation_prompt = build_consolidation_prompt(
            agents_text=agents_snapshot,
            dedup_candidates=dedup_candidates,
            output_hint=consolidation_json_path,
        )
        write_text(consolidation_prompt_path, consolidation_prompt)
        raw_consolidation = run_codex(
            prompt=consolidation_prompt,
            model=args.model,
            reasoning=args.reasoning,
            timeout_seconds=args.timeout_seconds,
        )
        write_text(consolidation_raw_path, raw_consolidation + "\n")
        consolidated = extract_json_object(raw_consolidation)
        if consolidated.get("marker") != SCRIPT_TASK_MARKER:
            raise RuntimeError("Invalid marker in consolidation response.")
        write_text(
            consolidation_json_path,
            json.dumps(consolidated, indent=2, ensure_ascii=False) + "\n",
        )
        selected = consolidated.get("selected_rules", [])
        if isinstance(selected, list):
            for entry in selected:
                if not isinstance(entry, dict):
                    continue
                instruction = str(entry.get("instruction", "")).strip()
                instruction = clean_rule_text(instruction)
                if not instruction:
                    continue
                selected_rules.append(instruction)
                selected_with_sources.append(
                    {
                        "instruction": instruction,
                        "source_sessions": entry.get("source_sessions", []),
                    }
                )
    else:
        write_text(consolidation_raw_path, "No candidate proposals in merge backlog.\n")
        write_text(
            consolidation_json_path,
            json.dumps(
                {
                    "marker": SCRIPT_TASK_MARKER,
                    "task_type": "consolidate_proposals",
                    "selected_rules": [],
                    "rejected_rules": [],
                },
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
        )

    existing_auto_rules = extract_existing_auto_rules(agents_snapshot)
    all_agents_bullets = extract_all_agents_bullets(agents_snapshot)
    existing_norm = {normalize_text(item) for item in all_agents_bullets if item.strip()}
    filtered_new = []
    for rule in selected_rules:
        if normalize_text(rule) in existing_norm:
            continue
        filtered_new.append(rule)

    final_rules = unique_rules(existing_auto_rules + filtered_new)
    updated_agents = update_agents_text(agents_snapshot, final_rules)
    diff_text = build_diff(agents_snapshot, updated_agents, str(agents_path))

    preview_dir = run_dir / "preview"
    candidate_agents_path = preview_dir / "AGENTS.candidate.md"
    diff_path = preview_dir / "AGENTS.preview.diff"
    preview_meta_path = preview_dir / "preview.meta.json"

    write_text(candidate_agents_path, updated_agents)
    write_text(diff_path, diff_text)

    included_record_ids = list(merge_backlog)
    preview_meta = {
        "run_id": run_id,
        "generated_at": utc_now(),
        "agents_path": str(agents_path),
        "agents_sha256_before": sha256_file(agents_path),
        "candidate_agents_path": str(candidate_agents_path),
        "diff_path": str(diff_path),
        "included_record_ids": included_record_ids,
        "new_rules_count": len(filtered_new),
        "selected_rules": selected_with_sources,
    }
    write_text(preview_meta_path, json.dumps(preview_meta, indent=2, ensure_ascii=False) + "\n")

    run_manifest["preview_generated"] = True
    run_manifest["preview_meta"] = str(preview_meta_path)
    save_state(state_path, state)

    print(f"Run id: {run_id}")
    print(f"Selected sessions: {len(prepared_sessions)}")
    print(f"Workers: {worker_count}")
    print(f"Processed sessions: {len(run_manifest['processed_sessions'])}")
    print(f"Failed sessions: {len(run_manifest['failed_sessions'])}")
    print(f"Preview diff: {diff_path}")
    print(f"Candidate AGENTS: {candidate_agents_path}")
    if diff_text:
        print("Preview generated. AGENTS.md was not modified.")
    else:
        print("No AGENTS changes proposed in this preview.")

    if args.print_preview:
        if diff_text:
            print("\n--- Preview diff ---")
            print(diff_text.rstrip())
        else:
            print("\n--- Preview diff ---")
            print("(no changes)")
    return 0


def resolve_run_id(args: argparse.Namespace, state: dict[str, Any]) -> str:
    if args.run_id:
        return args.run_id
    runs = sorted(state.get("runs", {}).keys())
    if not runs:
        raise RuntimeError("No runs found in state.")
    return runs[-1]


def preview_command(args: argparse.Namespace) -> int:
    processing_root = Path(args.processing_root).expanduser().resolve()
    state_path = processing_root / "state.json"
    state = load_state(state_path)
    run_id = resolve_run_id(args, state)
    run = state.get("runs", {}).get(run_id)
    if not run:
        raise RuntimeError(f"Run not found: {run_id}")
    preview_meta_path = run.get("preview_meta")
    if not preview_meta_path:
        raise RuntimeError(f"Run {run_id} has no preview metadata.")

    preview_meta = json.loads(read_text(Path(preview_meta_path)))
    diff_path = Path(preview_meta["diff_path"])
    if not diff_path.exists():
        raise RuntimeError(f"Preview diff missing: {diff_path}")
    print(f"Run id: {run_id}")
    print(f"Diff file: {diff_path}")
    print()
    print(read_text(diff_path).rstrip())
    return 0


def apply_command(args: argparse.Namespace) -> int:
    processing_root = Path(args.processing_root).expanduser().resolve()
    state_path = processing_root / "state.json"
    state = load_state(state_path)

    run_id = resolve_run_id(args, state)
    run = state.get("runs", {}).get(run_id)
    if not run:
        raise RuntimeError(f"Run not found: {run_id}")
    preview_meta_path = run.get("preview_meta")
    if not preview_meta_path:
        raise RuntimeError(f"Run {run_id} has no preview metadata.")

    preview_meta = json.loads(read_text(Path(preview_meta_path)))
    agents_path = Path(preview_meta["agents_path"])
    candidate_agents_path = Path(preview_meta["candidate_agents_path"])
    if not agents_path.exists():
        raise RuntimeError(f"AGENTS path missing: {agents_path}")
    if not candidate_agents_path.exists():
        raise RuntimeError(f"Candidate AGENTS missing: {candidate_agents_path}")

    current_sha = sha256_file(agents_path)
    expected_sha = preview_meta.get("agents_sha256_before")
    if current_sha != expected_sha and not args.force:
        raise RuntimeError(
            "AGENTS.md changed since preview. Re-run `run` or use `apply --force`."
        )

    shutil.copy2(candidate_agents_path, agents_path)

    included_record_ids = preview_meta.get("included_record_ids", [])
    merge_backlog = state.get("merge_backlog", [])
    state["merge_backlog"] = [
        record_id for record_id in merge_backlog if record_id not in included_record_ids
    ]
    state.setdefault("applied_previews", []).append(
        {
            "run_id": run_id,
            "applied_at": utc_now(),
            "agents_path": str(agents_path),
            "new_rules_count": preview_meta.get("new_rules_count", 0),
            "included_records": len(included_record_ids),
        }
    )
    run["applied"] = True
    run["applied_at"] = utc_now()
    save_state(state_path, state)

    print(f"Applied preview from run: {run_id}")
    print(f"Updated AGENTS: {agents_path}")
    print(f"Removed backlog records: {len(included_record_ids)}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Analyze Codex sessions and generate deduplicated AGENTS.md updates "
            "with preview-before-apply workflow."
        )
    )
    parser.add_argument(
        "--codex-home",
        default=os.environ.get("CODEX_HOME", "~/.codex"),
        help="Path to Codex home directory (default: ~/.codex).",
    )
    parser.add_argument(
        "--processing-root",
        default=".codex-agents-learning",
        help="Working directory for snapshots, outputs, and state.",
    )
    parser.add_argument(
        "--agents-path",
        default="~/.codex/AGENTS.md",
        help="AGENTS.md path to read/update.",
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("CODEX_LEARNING_MODEL", ""),
        help="Optional model passed to codex exec.",
    )
    parser.add_argument(
        "--reasoning",
        default=os.environ.get("CODEX_LEARNING_REASONING", DEFAULT_MODEL_REASONING),
        help=f'Reasoning effort for codex exec (default: "{DEFAULT_MODEL_REASONING}").',
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"Timeout per codex task (default: {DEFAULT_TIMEOUT_SECONDS}).",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="List sessions with status.")
    list_parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="Number of rows to print (default: 100).",
    )

    run_parser = subparsers.add_parser(
        "run",
        help="Process newest pending sessions, then build AGENTS preview.",
    )
    run_parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help=f"Maximum pending sessions to process (default: {DEFAULT_LIMIT}).",
    )
    run_parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help=(
            "Parallel session analyses during run "
            f"(default: {DEFAULT_WORKERS})."
        ),
    )
    run_parser.add_argument(
        "--print-preview",
        action="store_true",
        help="Print the generated diff in stdout.",
    )

    preview_parser = subparsers.add_parser(
        "preview",
        help="Print preview diff from a run (latest by default).",
    )
    preview_parser.add_argument(
        "--run-id",
        default="",
        help="Run id to preview. Defaults to latest run.",
    )

    apply_parser = subparsers.add_parser(
        "apply",
        help="Apply the candidate AGENTS from a run (latest by default).",
    )
    apply_parser.add_argument(
        "--run-id",
        default="",
        help="Run id to apply. Defaults to latest run.",
    )
    apply_parser.add_argument(
        "--force",
        action="store_true",
        help="Apply even if AGENTS.md changed after preview.",
    )

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    command = args.command
    if command == "list":
        return list_command(args)
    if command == "run":
        return run_command(args)
    if command == "preview":
        return preview_command(args)
    if command == "apply":
        return apply_command(args)
    parser.error(f"Unknown command: {command}")
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
