#!/usr/bin/env python3
"""Browser-driven preset artifact smoke test for IconForge."""

from __future__ import annotations

import contextlib
import json
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ModuleNotFoundError as exc:
    raise SystemExit(
        "Python Playwright is required for browser smoke tests. "
        "Install it with: python -m pip install playwright && python -m playwright install chromium"
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
PRESETS = ("web", "pwa", "android", "ios", "windows", "social")

EXPECTED = {
    "web": {
        "files": {
            "favicon.ico",
            "icon.svg",
            "apple-touch-icon.png",
            "icon-192.png",
            "icon-512.png",
        },
        "png": {
            "apple-touch-icon.png": (180, 180),
            "icon-192.png": (192, 192),
            "icon-512.png": (512, 512),
        },
        "zip": {"snippets/head.html", "manifest.webmanifest", "iconforge-export.json"},
        "ico": {"favicon.ico": {16, 32, 48, 180, 192}},
    },
    "pwa": {
        "files": {
            "pwa/icons/icon-192x192.png",
            "pwa/icons/icon-maskable-192x192.png",
            "pwa/splash/apple-splash-iphone-14-pro-1179x2556.png",
        },
        "png": {
            "pwa/icons/icon-192x192.png": (192, 192),
            "pwa/icons/icon-maskable-192x192.png": (192, 192),
            "pwa/splash/apple-splash-iphone-14-pro-1179x2556.png": (1179, 2556),
        },
        "zip": {"pwa/manifest.webmanifest", "iconforge-export.json"},
        "ico": {},
    },
    "android": {
        "files": {
            "android/mipmap-xxxhdpi/ic_launcher_foreground.png",
            "android/mipmap-xxxhdpi/ic_launcher_background.png",
            "android/mipmap-xxxhdpi/ic_launcher.png",
        },
        "png": {
            "android/mipmap-xxxhdpi/ic_launcher_foreground.png": (432, 432),
            "android/mipmap-xxxhdpi/ic_launcher_background.png": (432, 432),
            "android/mipmap-xxxhdpi/ic_launcher.png": (432, 432),
        },
        "zip": {"android/mipmap-anydpi-v26/ic_launcher.xml", "iconforge-export.json"},
        "ico": {},
    },
    "ios": {
        "files": {
            "ios/AppIcon.appiconset/Icon-App-1024x1024-1x.png",
            "ios/AppIcon.appiconset/Icon-App-60x60-3x.png",
        },
        "png": {
            "ios/AppIcon.appiconset/Icon-App-1024x1024-1x.png": (1024, 1024),
            "ios/AppIcon.appiconset/Icon-App-60x60-3x.png": (180, 180),
        },
        "zip": {"ios/AppIcon.appiconset/Contents.json", "iconforge-export.json"},
        "ico": {},
    },
    "windows": {
        "files": {
            "windows/favicon.ico",
            "windows/mstile-70x70.png",
            "windows/mstile-150x150.png",
            "windows/mstile-310x150.png",
            "windows/mstile-310x310.png",
        },
        "png": {
            "windows/mstile-70x70.png": (70, 70),
            "windows/mstile-150x150.png": (150, 150),
            "windows/mstile-310x150.png": (310, 150),
            "windows/mstile-310x310.png": (310, 310),
        },
        "zip": {"windows/browserconfig.xml", "iconforge-export.json"},
        "ico": {"windows/favicon.ico": {70, 150}},
    },
    "social": {
        "files": {
            "social/og-image.png",
            "social/twitter-card.png",
            "social/linkedin-preview.png",
        },
        "png": {
            "social/og-image.png": (1200, 630),
            "social/twitter-card.png": (1200, 675),
            "social/linkedin-preview.png": (1200, 627),
        },
        "zip": {"snippets/social-meta.html", "iconforge-export.json"},
        "ico": {},
    },
}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *args: object) -> None:
        return


def free_port() -> int:
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def start_server() -> tuple[ThreadingHTTPServer, str]:
    port = free_port()
    handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(ROOT), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{port}/"


COLLECT_SCRIPT = """
async (preset) => {
  const api = window.__ICONFORGE_TEST__;
  const decoder = new TextDecoder();

  function pngDimensions(bytes) {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
  }

  function icoEntries(bytes) {
    if (bytes.length < 6) return [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) return [];
    const count = view.getUint16(4, true);
    const entries = [];
    for (let index = 0; index < count; index += 1) {
      const offset = 6 + index * 16;
      if (offset + 16 > bytes.length) break;
      const widthByte = view.getUint8(offset);
      const heightByte = view.getUint8(offset + 1);
      entries.push({
        width: widthByte === 0 ? 256 : widthByte,
        height: heightByte === 0 ? 256 : heightByte,
        bytes: view.getUint32(offset + 8, true)
      });
    }
    return entries;
  }

  function zipNames(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return [];
    const totalEntries = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const names = [];
    for (let index = 0; index < totalEntries; index += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) break;
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const nameStart = offset + 46;
      names.push(decoder.decode(bytes.slice(nameStart, nameStart + nameLength)));
      offset = nameStart + nameLength + extraLength + commentLength;
    }
    return names;
  }

  const files = api.getState().generatedFiles;
  const decoded = {};
  for (const file of files) {
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    decoded[file.name] = {
      size: file.blob.size,
      mime: file.blob.type,
      declared: file.size,
      png: file.format === "png" ? pngDimensions(bytes) : null,
      ico: file.format === "ico" ? icoEntries(bytes) : [],
      svgHasRoot: file.format === "svg" ? decoder.decode(bytes).includes("<svg") : false
    };
  }

  const exportFiles = await api.getExportFilesWithManifest();
  const zipItems = [];
  for (const file of exportFiles) {
    zipItems.push({ name: file.name, data: new Uint8Array(await file.blob.arrayBuffer()) });
  }
  const zipBlob = api.buildZip(zipItems);
  const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
  const validation = api.validateGeneratedExport();
  const diagnostics = api.buildGenerationDiagnostics({ selectedFormats: [], validationResult: validation });

  return {
    preset,
    statusText: document.querySelector("#status")?.textContent || "",
    validation,
    diagnostics,
    files: Object.keys(decoded),
    decoded,
    zipNames: zipNames(zipBytes),
    zipSize: zipBlob.size,
    desktopOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    diagnosticsText: document.querySelector("#diagnosticsSummary")?.textContent || ""
  };
}
"""


def run_preset(page, url: str, preset: str) -> dict:
    page.goto(url, wait_until="networkidle")
    page.locator('.mode-tab[data-mode="text"]').click()
    page.locator("#textInput").fill("IF")
    page.locator("#btnUseTextIcon").click()
    page.locator(f'button[data-preset="{preset}"]').click()
    page.locator("#btnGenerate").click()
    page.wait_for_function(
        """() => {
            const button = document.querySelector("#btnGenerate");
            const status = document.querySelector("#status")?.textContent || "";
            return button && !button.disabled && /Generated/.test(status);
        }""",
        timeout=60000,
    )
    result = page.evaluate(COLLECT_SCRIPT, preset)
    page.set_viewport_size({"width": 390, "height": 844})
    result["mobileOverflow"] = page.evaluate(
        "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"
    )
    page.set_viewport_size({"width": 1440, "height": 1000})
    return result


def validate_result(result: dict) -> list[str]:
    preset = result["preset"]
    expected = EXPECTED[preset]
    failures = []
    names = set(result["files"])
    zip_names = set(result["zipNames"])

    if result["validation"]["status"] != "pass":
        failures.append(f"{preset}: validation did not pass: {result['validation']}")
    if "Generated" not in result["statusText"]:
        failures.append(f"{preset}: status did not report generated files")
    if result["desktopOverflow"]:
        failures.append(f"{preset}: desktop generated output has horizontal overflow")
    if result["mobileOverflow"]:
        failures.append(f"{preset}: mobile generated output has horizontal overflow")
    missing_files = sorted(expected["files"] - names)
    if missing_files:
        failures.append(f"{preset}: missing generated files {missing_files}")
    missing_zip = sorted(expected["zip"] - zip_names)
    if missing_zip:
        failures.append(f"{preset}: missing ZIP entries {missing_zip}")
    if result["zipSize"] <= 0:
        failures.append(f"{preset}: ZIP blob is empty")

    for name, dimensions in expected["png"].items():
        decoded = result["decoded"].get(name)
        actual = decoded.get("png") if decoded else None
        if actual != {"width": dimensions[0], "height": dimensions[1]}:
            failures.append(f"{preset}: {name} decoded as {actual}, expected {dimensions}")

    for name, sizes in expected["ico"].items():
        decoded = result["decoded"].get(name)
        actual_sizes = {entry["width"] for entry in (decoded or {}).get("ico", [])}
        if not sizes.issubset(actual_sizes):
            failures.append(f"{preset}: {name} ICO entries {sorted(actual_sizes)} missing {sorted(sizes)}")

    for name in names:
        decoded = result["decoded"][name]
        if decoded["size"] <= 0:
            failures.append(f"{preset}: {name} has no bytes")

    return failures


def main() -> int:
    server, url = start_server()
    console_messages: list[dict] = []
    page_errors: list[str] = []
    results = []
    failures = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
            page.add_init_script("window.__ICONFORGE_ENABLE_TEST_API__ = true;")
            page.on("console", lambda msg: console_messages.append({"type": msg.type, "text": msg.text}))
            page.on("pageerror", lambda exc: page_errors.append(str(exc)))
            for preset in PRESETS:
                result = run_preset(page, url, preset)
                results.append(result)
                failures.extend(validate_result(result))
            browser.close()
    finally:
        server.shutdown()
        server.server_close()

    relevant_console = [msg for msg in console_messages if msg["type"] in ("error", "warning")]
    if relevant_console:
        failures.append(f"console warnings/errors emitted: {relevant_console}")
    if page_errors:
        failures.append(f"page errors emitted: {page_errors}")

    summary = {
        "url": url,
        "presets": [
            {
                "preset": item["preset"],
                "fileCount": len(item["files"]),
                "zipEntries": len(item["zipNames"]),
                "zipSize": item["zipSize"],
                "validation": item["validation"]["status"],
            }
            for item in results
        ],
        "failures": failures,
    }
    print(json.dumps(summary, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
