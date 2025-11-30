#!/home/rkmax/Development/Scripts/.venv_dalle_background/bin/python
"""
CLI to generate a contextual background with OpenAI's DALL-E (gpt-image-1).
Builds a prompt from artwork, location, and temperature, picks the closest allowed
image size, and optionally upscales to a target resolution for wallpapers such as 4K.

Dependencies:
- python -m pip install --upgrade openai pillow
"""

from __future__ import annotations

import argparse
import base64
import os
import sys
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Tuple

import httpx
from openai import OpenAI
from PIL import Image


# Supported by current DALL-E endpoint: keep in sync with API docs.
ALLOWED_SIZES: Tuple[str, ...] = ("1536x1024", "1024x1536", "1024x1024")


@dataclass
class GenerationConfig:
    prompt: str
    base_width: int
    base_height: int
    base_size_str: str
    target_width: int
    target_height: int
    output_path: str
    model: str
    style: str | None
    skip_upscale: bool


@dataclass
class WeatherContext:
    location: str | None
    temperature: float | None
    conditions: str | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a background image using DALL-E with contextual metadata."
    )
    parser.add_argument(
        "--artwork",
        required=False,
        default=None,
        help="Optional description of the current piece or theme the background should echo.",
    )
    parser.add_argument(
        "--location",
        default=None,
        help="Current city or place to influence the palette and lighting.",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=None,
        help="Current temperature in Celsius to hint the mood (e.g., 26.5).",
    )
    parser.add_argument(
        "--conditions",
        default=None,
        help="Optional weather/ambient notes such as 'overcast', 'dry heat', or 'humid twilight'.",
    )
    parser.add_argument(
        "--auto-context",
        action="store_true",
        help="Fetch location/temperature/conditions from OpenWeather + IP lookup when missing.",
    )
    parser.add_argument(
        "--geo-query",
        default=None,
        help="Optional city/state/country to geocode with OpenWeather before IP lookup (e.g., 'Mexico City, MX').",
    )
    parser.add_argument(
        "--weather-lang",
        default="en",
        help="Language code for OpenWeather responses (affects condition description). Defaults to 'en'.",
    )
    parser.add_argument(
        "--target-width",
        type=int,
        default=3840,
        help="Desired output width in pixels. Defaults to 3840 (4K).",
    )
    parser.add_argument(
        "--target-height",
        type=int,
        default=2160,
        help="Desired output height in pixels. Defaults to 2160 (4K).",
    )
    parser.add_argument(
        "--output",
        default="background.png",
        help="Where to save the final image. Defaults to background.png.",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="OpenAI API key. If omitted, OPENAI_API_KEY env var will be used.",
    )
    parser.add_argument(
        "--model",
        default="gpt-image-1",
        help="OpenAI image model to use. Defaults to gpt-image-1.",
    )
    parser.add_argument(
        "--style",
        choices=("natural", "vivid"),
        default=None,
        help="Optional DALL-E style parameter (natural or vivid). If omitted, do not send style.",
    )
    parser.add_argument(
        "--skip-upscale",
        action="store_true",
        help="Save the base image returned by the API without resizing to the target resolution.",
    )
    return parser.parse_args()


def build_prompt(
    artwork: str | None,
    location: str | None,
    temperature: float | None,
    conditions: str | None,
    local_time: str | None,
) -> str:
    context_parts: list[str] = []
    if location:
        context_parts.append(f"Location: {location}.")
    if local_time:
        context_parts.append(f"Local time: {local_time}.")
    if temperature is not None:
        context_parts.append(f"Temperature: {temperature:.1f}°C.")
    if conditions:
        context_parts.append(f"Ambient conditions: {conditions}.")
    context = " ".join(context_parts)
    lead = "Create a cinematic, textless wallpaper"
    if artwork:
        lead += f" inspired by the work '{artwork}'"
    else:
        lead += " reflecting the current environment"
    return (
        f"{lead}. {context} Use color, light, and depth to reflect the place and weather. "
        "Avoid typography, watermarks, people, and logos. Make it wide, cohesive, and atmospheric."
    )


def safe_number(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            parsed = float(value)
        except ValueError:
            return None
        return parsed if parsed != float("inf") and parsed != float("-inf") else None
    return None


def http_get_json(url: str) -> Any:
    try:
        with httpx.Client(timeout=10.0, follow_redirects=True) as client:
            response = client.get(url)
        if response.status_code != 200:
            return None
        return response.json()
    except Exception as exc:
        print(f"[warn] http fetch failed for {url}: {exc}", file=sys.stderr)
        return None


def geocode_location(api_key: str, query: str, lang: str) -> tuple[float, float, str] | None:
    params = httpx.QueryParams({"q": query, "limit": 1, "lang": lang, "appid": api_key})
    url = f"https://api.openweathermap.org/geo/1.0/direct?{params}"
    payload = http_get_json(url)
    if not isinstance(payload, list) or len(payload) == 0:
        return None

    entry = payload[0]
    if not isinstance(entry, dict):
        return None

    lat = safe_number(entry.get("lat"))
    lon = safe_number(entry.get("lon"))
    if lat is None or lon is None:
        return None

    name = entry.get("name")
    state = entry.get("state")
    country = entry.get("country")
    label_parts = [
        value
        for value in [name, state, country]
        if isinstance(value, str) and value.strip()
    ]
    label = ", ".join(label_parts) or "Local"
    return lat, lon, label


def ip_lookup_coords() -> tuple[float, float, str] | None:
    payload = http_get_json("https://ipinfo.io/json")
    if not isinstance(payload, dict):
        return None
    loc = payload.get("loc")
    if not isinstance(loc, str) or "," not in loc:
        return None
    lat_str, lon_str = loc.split(",", 1)
    lat = safe_number(lat_str)
    lon = safe_number(lon_str)
    if lat is None or lon is None:
        return None

    city = payload.get("city")
    region = payload.get("region")
    country = payload.get("country")
    label_parts = [
        value
        for value in [city, region, country]
        if isinstance(value, str) and value.strip()
    ]
    label = ", ".join(label_parts) or "Local"
    return lat, lon, label


def resolve_location_label(payload: dict, fallback_label: str) -> str:
    name = payload.get("name")
    sys_payload = payload.get("sys") if isinstance(payload.get("sys"), dict) else None
    country = sys_payload.get("country") if isinstance(sys_payload, dict) else None
    label_parts = [
        value
        for value in [name, fallback_label, country]
        if isinstance(value, str) and value.strip()
    ]
    label = ", ".join(dict.fromkeys(label_parts))  # dedupe while preserving order
    return label or fallback_label


def fetch_weather_context(api_key: str, lat: float, lon: float, lang: str, fallback_label: str) -> WeatherContext | None:
    params = httpx.QueryParams(
        {"lat": lat, "lon": lon, "units": "metric", "lang": lang, "appid": api_key}
    )
    url = f"https://api.openweathermap.org/data/2.5/weather?{params}"
    payload = http_get_json(url)
    if not isinstance(payload, dict):
        return None

    main = payload.get("main") if isinstance(payload.get("main"), dict) else None
    temp = safe_number(main.get("temp")) if main else None

    conditions = None
    weather_entries = payload.get("weather") if isinstance(payload.get("weather"), list) else []
    if weather_entries and isinstance(weather_entries[0], dict):
        desc = weather_entries[0].get("description")
        if isinstance(desc, str) and desc.strip():
            conditions = desc.strip()

    location_label = resolve_location_label(payload, fallback_label)
    return WeatherContext(location=location_label, temperature=temp, conditions=conditions)


def auto_fill_context(
    api_key: str | None,
    args: argparse.Namespace,
    context: WeatherContext,
) -> WeatherContext:
    if not args.auto_context:
        return context
    if not api_key:
        print("[warn] OPENWEATHER_API_KEY missing; skipping auto-context lookup.", file=sys.stderr)
        return context

    coords: tuple[float, float, str] | None = None
    if args.geo_query:
        coords = geocode_location(api_key, args.geo_query, args.weather_lang)
    if not coords:
        coords = ip_lookup_coords()
    if not coords:
        print("[warn] Could not resolve location via geocode/IP; keeping provided context.", file=sys.stderr)
        return context

    lat, lon, label = coords
    weather = fetch_weather_context(api_key, lat, lon, args.weather_lang, label)
    if not weather:
        print("[warn] Weather lookup failed; keeping provided context.", file=sys.stderr)
        return context

    return WeatherContext(
        location=context.location or weather.location,
        temperature=context.temperature if context.temperature is not None else weather.temperature,
        conditions=context.conditions or weather.conditions,
    )


def current_local_time() -> str:
    now = datetime.now()
    time_str = now.strftime("%I:%M%p").lower()
    return time_str.lstrip("0")


def pick_base_size(target_width: int, target_height: int) -> tuple[int, int, str]:
    target_ratio = target_width / target_height
    best: tuple[float, int, str, int, int] | None = None

    for size in ALLOWED_SIZES:
        width_str, height_str = size.split("x")
        width = int(width_str)
        height = int(height_str)
        ratio = width / height
        ratio_diff = abs(ratio - target_ratio)
        area = width * height
        candidate = (ratio_diff, -area, size, width, height)
        if best is None or candidate < best:
            best = candidate

    if best is None:
        raise RuntimeError("Failed to determine a valid base size.")

    _, _, size_str, base_width, base_height = best
    return base_width, base_height, size_str


def generate_image(
    client: OpenAI,
    prompt: str,
    base_size: str,
    model: str,
    style: str | None,
) -> bytes:
    kwargs: dict[str, str] = {"size": base_size}
    if style:
        kwargs["style"] = style

    response = client.images.generate(
        model=model,
        prompt=prompt,
        **kwargs,
    )
    image_data = response.data[0].b64_json
    if not image_data:
        raise RuntimeError("No image data returned by OpenAI.")
    return base64.b64decode(image_data)


def upscale_image(image_bytes: bytes, target_width: int, target_height: int) -> Image.Image:
    image = Image.open(BytesIO(image_bytes))
    if image.width == target_width and image.height == target_height:
        return image
    return image.resize((target_width, target_height), Image.LANCZOS)


def assemble_config(args: argparse.Namespace, ctx: WeatherContext) -> GenerationConfig:
    prompt = build_prompt(args.artwork, ctx.location, ctx.temperature, ctx.conditions, current_local_time())
    base_width, base_height, base_size_str = pick_base_size(args.target_width, args.target_height)
    return GenerationConfig(
        prompt=prompt,
        base_width=base_width,
        base_height=base_height,
        base_size_str=base_size_str,
        target_width=args.target_width,
        target_height=args.target_height,
        output_path=args.output,
        model=args.model,
        style=args.style,
        skip_upscale=args.skip_upscale,
    )


def load_local_env() -> None:
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def main() -> None:
    load_local_env()
    args = parse_args()
    api_key = args.api_key or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is not set and --api-key was not provided.")

    weather_api_key = os.getenv("OPENWEATHER_API_KEY")
    context = WeatherContext(location=args.location, temperature=args.temperature, conditions=args.conditions)
    context = auto_fill_context(weather_api_key, args, context)

    config = assemble_config(args, context)
    client = OpenAI(api_key=api_key)

    print("\n--- Prompt sent to DALL-E ---", file=sys.stderr)
    print(config.prompt, file=sys.stderr)
    print("-----------------------------\n", file=sys.stderr)
    print(
        f"Generating {config.base_size_str} image with model {config.model} (style={config.style})...",
        file=sys.stderr,
    )

    raw_image = generate_image(
        client=client,
        prompt=config.prompt,
        base_size=config.base_size_str,
        model=config.model,
        style=config.style,
    )

    if config.skip_upscale:
        final_image = Image.open(BytesIO(raw_image))
    else:
        final_image = upscale_image(raw_image, config.target_width, config.target_height)

    final_image.save(config.output_path)
    print(
        f"Saved {config.output_path} at {final_image.width}x{final_image.height} (base {config.base_size_str}).",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
