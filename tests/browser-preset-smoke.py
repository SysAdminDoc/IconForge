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
            "pwa/icons/icon-monochrome-512x512.png",
            "pwa/splash/apple-splash-iphone-16-pro-max-1320x2868.png",
            "pwa/splash/apple-splash-iphone-air-1260x2736.png",
        },
        "png": {
            "pwa/icons/icon-192x192.png": (192, 192),
            "pwa/icons/icon-maskable-192x192.png": (192, 192),
            "pwa/icons/icon-monochrome-512x512.png": (512, 512),
            "pwa/splash/apple-splash-iphone-16-pro-max-1320x2868.png": (1320, 2868),
            "pwa/splash/apple-splash-iphone-air-1260x2736.png": (1260, 2736),
        },
        "zip": {"pwa/manifest.webmanifest", "iconforge-export.json"},
        "ico": {},
    },
    "android": {
        "files": {
            "android/mipmap-mdpi/ic_launcher_foreground.png",
            "android/mipmap-mdpi/ic_launcher_background.png",
            "android/mipmap-mdpi/ic_launcher.png",
            "android/mipmap-xxxhdpi/ic_launcher_foreground.png",
            "android/mipmap-xxxhdpi/ic_launcher_background.png",
            "android/mipmap-xxxhdpi/ic_launcher.png",
        },
        "png": {
            "android/mipmap-mdpi/ic_launcher_foreground.png": (108, 108),
            "android/mipmap-mdpi/ic_launcher_background.png": (108, 108),
            "android/mipmap-mdpi/ic_launcher.png": (48, 48),
            "android/mipmap-xxxhdpi/ic_launcher_foreground.png": (432, 432),
            "android/mipmap-xxxhdpi/ic_launcher_background.png": (432, 432),
            "android/mipmap-xxxhdpi/ic_launcher.png": (192, 192),
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
  const validation = await api.validateGeneratedExport();
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
    if preset == "pwa":
        page.locator("#manifestMonochrome").check()
        page.locator("#btnGenerate").click()
        page.wait_for_function(
            """() => {
                const cancel = document.querySelector("#btnCancelOperation");
                const progress = document.querySelector("#generationProgressLabel")?.textContent || "";
                return cancel && getComputedStyle(cancel).display !== "none" && progress.includes("—");
            }"""
        )
        page.locator("#btnCancelOperation").click()
        page.wait_for_function(
            """() => {
                const button = document.querySelector("#btnGenerate");
                const status = document.querySelector("#status")?.textContent || "";
                return button && !button.disabled && /cancelled/i.test(status);
            }"""
        )
        cancel_recovery = page.evaluate(
            """() => ({
                partialItems: document.querySelectorAll("#outputGrid .output-item").length,
                outputHidden: getComputedStyle(document.querySelector("#outputSection")).display === "none",
                progressHidden: getComputedStyle(document.querySelector("#generationProgress")).display === "none"
            })"""
        )
    else:
        cancel_recovery = None
    page.locator("#btnGenerate").click()
    page.wait_for_function(
        """() => {
            const button = document.querySelector("#btnGenerate");
            const status = document.querySelector("#status")?.textContent || "";
            return button && !button.disabled && /Generated/.test(status);
        }""",
        timeout=15000,
    )
    result = page.evaluate(COLLECT_SCRIPT, preset)
    result["cancelRecovery"] = cancel_recovery
    page.set_viewport_size({"width": 390, "height": 844})
    result["mobileOverflow"] = page.evaluate(
        "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"
    )
    page.set_viewport_size({"width": 1440, "height": 1000})
    return result


def check_accessibility_interactions(page, url: str) -> tuple[dict, list[str]]:
    page.goto(url, wait_until="networkidle")
    failures = []
    upload_tab = page.locator("#sourceTabUpload")
    page.keyboard.press("Tab")
    if page.evaluate("() => document.activeElement?.id") != "sourceTabUpload":
        failures.append("first keyboard tab stop should be the selected Upload source tab")
    upload_tab.press("ArrowRight")
    arrow_state = page.evaluate(
        """() => ({
            activeId: document.activeElement?.id,
            selected: document.querySelector('[role="tab"][aria-selected="true"]')?.id,
            textVisible: getComputedStyle(document.querySelector("#textMode")).display !== "none"
        })"""
    )
    if arrow_state != {"activeId": "sourceTabText", "selected": "sourceTabText", "textVisible": True}:
        failures.append(f"source tab ArrowRight state was incorrect: {arrow_state}")

    page.locator("#sourceTabText").press("End")
    end_state = page.evaluate(
        """() => ({
            activeId: document.activeElement?.id,
            selected: document.querySelector('[role="tab"][aria-selected="true"]')?.id,
            emojiVisible: getComputedStyle(document.querySelector("#emojiMode")).display !== "none"
        })"""
    )
    if end_state != {"activeId": "sourceTabEmoji", "selected": "sourceTabEmoji", "emojiVisible": True}:
        failures.append(f"source tab End state was incorrect: {end_state}")

    page.locator("#sourceTabEmoji").press("Home")
    page.wait_for_timeout(200)
    focus_style = page.locator("#sourceTabUpload").evaluate(
        """element => {
            const style = getComputedStyle(element);
            return {
                activeId: document.activeElement?.id,
                focused: element.matches(":focus"),
                focusVisible: element.matches(":focus-visible"),
                outlineStyle: style.outlineStyle,
                outlineWidth: style.outlineWidth,
                boxShadow: style.boxShadow
            };
        }"""
    )
    has_outline = focus_style["outlineStyle"] != "none" and float(focus_style["outlineWidth"].replace("px", "")) >= 2
    has_focus_ring = focus_style["boxShadow"] != "none"
    if not has_outline and not has_focus_ring:
        failures.append(f"source tab focus indicator was not visible: {focus_style}")

    page.locator("#sourceTabText").click()
    page.locator("#textInput").fill("IF")
    page.locator("#btnUseTextIcon").click()
    page.wait_for_function("() => !document.querySelector('#btnGenerate').disabled")
    page.locator("#manifestShortcuts").fill("{")
    page.locator("#btnGenerate").click()
    page.wait_for_function(
        """() => {
            const status = document.querySelector("#status");
            return status?.getAttribute("role") === "alert" && document.activeElement === status;
        }"""
    )
    error_focus = page.evaluate(
        """() => ({
            activeId: document.activeElement?.id,
            role: document.querySelector("#status")?.getAttribute("role"),
            live: document.querySelector("#status")?.getAttribute("aria-live")
        })"""
    )
    if error_focus != {"activeId": "status", "role": "alert", "live": "assertive"}:
        failures.append(f"error status focus state was incorrect: {error_focus}")
    return {
        "arrowNavigation": arrow_state,
        "endNavigation": end_state,
        "focusStyle": focus_style,
        "errorFocus": error_focus,
    }, failures


def check_draft_recovery(page, url: str) -> tuple[dict, list[str]]:
    page.goto(url, wait_until="networkidle")
    failures = []
    page.locator("#manifestName").fill("Reload Recovery")
    page.wait_for_timeout(350)
    saved_status = page.locator("#draftStatus").inner_text()
    if "Saved just now" not in saved_status or "settings only" not in saved_status:
        failures.append(f"draft status did not expose age/size/privacy state: {saved_status}")

    page.reload(wait_until="networkidle")
    restored_name = page.locator("#manifestName").input_value()
    restored_status = page.locator("#draftStatus").inner_text()
    if restored_name != "Reload Recovery" or "Draft settings restored locally" not in restored_status:
        failures.append(f"draft did not restore after reload: name={restored_name!r}, status={restored_status!r}")

    page.locator("#btnClearDraft").click()
    page.reload(wait_until="networkidle")
    cleared_name = page.locator("#manifestName").input_value()
    if cleared_name:
        failures.append(f"Clear Draft was undone by unload autosave: {cleared_name!r}")

    page.evaluate(
        """() => {
            const api = window.__ICONFORGE_TEST__;
            const draft = api.buildDraftSnapshot();
            draft.savedAt = new Date(Date.now() - api.DRAFT_TTL_MS - 1000).toISOString();
            api.setStoredDraftForTest(JSON.stringify(draft));
        }"""
    )
    expired_page = page.context.new_page()
    expired_page.goto(url, wait_until="networkidle")
    expired_status = expired_page.locator("#draftStatus").inner_text()
    if "expired after 30 days and was cleared" not in expired_status:
        failures.append(f"expired draft was not reported and cleared: {expired_status!r}")

    page = expired_page
    page.locator("#manifestName").fill("Disabled Recovery")
    page.wait_for_timeout(350)
    page.locator("#draftEnabledToggle").uncheck()
    page.reload(wait_until="networkidle")
    disabled_name = page.locator("#manifestName").input_value()
    disabled_status = page.locator("#draftStatus").inner_text()
    if disabled_name or "Draft recovery is disabled" not in disabled_status:
        failures.append(f"disabled draft recovery persisted state: name={disabled_name!r}, status={disabled_status!r}")

    return {
        "savedStatus": saved_status,
        "restoredName": restored_name,
        "clearedName": cleared_name,
        "expiredStatus": expired_status,
        "disabledName": disabled_name,
        "disabledStatus": disabled_status,
    }, failures


def validate_result(result: dict) -> list[str]:
    preset = result["preset"]
    expected = EXPECTED[preset]
    failures = []
    if preset == "pwa" and result.get("cancelRecovery") != {
        "partialItems": 0,
        "outputHidden": True,
        "progressHidden": True,
    }:
        failures.append(f"pwa cancellation did not cleanly reset: {result.get('cancelRecovery')}")
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
    offline_shell = {"root": False, "index": False}
    accessibility = {}
    draft_recovery = {}

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            accessibility_context = browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
            accessibility_page = accessibility_context.new_page()
            accessibility_page.add_init_script("window.__ICONFORGE_ENABLE_TEST_API__ = true;")
            accessibility_page.on("console", lambda msg: console_messages.append({"type": msg.type, "text": msg.text}))
            accessibility_page.on("pageerror", lambda exc: page_errors.append(str(exc)))
            accessibility, accessibility_failures = check_accessibility_interactions(accessibility_page, url)
            failures.extend(accessibility_failures)
            accessibility_context.close()

            draft_context = browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
            draft_page = draft_context.new_page()
            draft_page.add_init_script("window.__ICONFORGE_ENABLE_TEST_API__ = true;")
            draft_page.on("console", lambda msg: console_messages.append({"type": msg.type, "text": msg.text}))
            draft_page.on("pageerror", lambda exc: page_errors.append(str(exc)))
            draft_recovery, draft_failures = check_draft_recovery(draft_page, url)
            failures.extend(draft_failures)
            draft_context.close()

            context = browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
            page = context.new_page()
            page.add_init_script("window.__ICONFORGE_ENABLE_TEST_API__ = true;")
            page.on("console", lambda msg: console_messages.append({"type": msg.type, "text": msg.text}))
            page.on("pageerror", lambda exc: page_errors.append(str(exc)))
            for preset in PRESETS:
                try:
                    result = run_preset(page, url, preset)
                except Exception as error:
                    state = page.evaluate(
                        """() => ({
                            status: document.querySelector("#status")?.textContent,
                            statusRole: document.querySelector("#status")?.getAttribute("role"),
                            shortcuts: document.querySelector("#manifestShortcuts")?.value,
                            generateDisabled: document.querySelector("#btnGenerate")?.disabled,
                            outputItems: document.querySelectorAll("#outputGrid .output-item").length
                        })"""
                    )
                    raise RuntimeError(f"{preset} preset browser smoke failed with state {state}") from error
                results.append(result)
                failures.extend(validate_result(result))

            page.goto(url, wait_until="networkidle")
            page.wait_for_function("() => navigator.serviceWorker?.ready")
            page.wait_for_function("() => Boolean(navigator.serviceWorker?.controller)", timeout=10000)
            context.set_offline(True)
            offline_page = context.new_page()
            try:
                offline_page.goto(url, wait_until="domcontentloaded")
                offline_shell["root"] = offline_page.locator("h1").get_by_text("Icon Forge").is_visible()
                offline_page.goto(f"{url}index.html", wait_until="domcontentloaded")
                offline_shell["index"] = offline_page.locator("#btnGenerate").is_visible()
            finally:
                offline_page.close()
                context.set_offline(False)
            if not all(offline_shell.values()):
                failures.append(f"offline shell did not render both navigation forms: {offline_shell}")
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
        "accessibility": accessibility,
        "draftRecovery": draft_recovery,
        "offlineShell": offline_shell,
        "failures": failures,
    }
    print(json.dumps(summary, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
