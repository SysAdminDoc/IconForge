#!/usr/bin/env python3
"""Browser-driven preset artifact smoke test for IconForge."""

from __future__ import annotations

import contextlib
import json
import re
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

try:
    from playwright.sync_api import sync_playwright
except ModuleNotFoundError as exc:
    raise SystemExit(
        "Python Playwright is required for browser smoke tests. "
        "Install it with: python -m pip install playwright && python -m playwright install chromium firefox webkit"
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_ROOT = ROOT / "tests" / "fixtures"
CURRENT_VERSION = re.search(
    r"ICONFORGE_VERSION\s*=\s*'([^']+)'",
    (ROOT / "version.js").read_text(encoding="utf-8"),
).group(1)
CHANGELOG_VERSIONS = re.findall(
    r"^## \[(v\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$",
    (ROOT / "CHANGELOG.md").read_text(encoding="utf-8"),
    re.MULTILINE,
)
CURRENT_RELEASE_INDEX = CHANGELOG_VERSIONS.index(CURRENT_VERSION)
PREVIOUS_VERSION = CHANGELOG_VERSIONS[CURRENT_RELEASE_INDEX + 1]
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
            "android/mipmap-mdpi/ic_launcher_round.png",
            "android/mipmap-mdpi/ic_launcher_monochrome.png",
            "android/mipmap-xxxhdpi/ic_launcher_foreground.png",
            "android/mipmap-xxxhdpi/ic_launcher_background.png",
            "android/mipmap-xxxhdpi/ic_launcher.png",
            "android/mipmap-xxxhdpi/ic_launcher_round.png",
            "android/mipmap-xxxhdpi/ic_launcher_monochrome.png",
        },
        "png": {
            "android/mipmap-mdpi/ic_launcher_foreground.png": (108, 108),
            "android/mipmap-mdpi/ic_launcher_background.png": (108, 108),
            "android/mipmap-mdpi/ic_launcher.png": (48, 48),
            "android/mipmap-mdpi/ic_launcher_round.png": (48, 48),
            "android/mipmap-mdpi/ic_launcher_monochrome.png": (108, 108),
            "android/mipmap-xxxhdpi/ic_launcher_foreground.png": (432, 432),
            "android/mipmap-xxxhdpi/ic_launcher_background.png": (432, 432),
            "android/mipmap-xxxhdpi/ic_launcher.png": (192, 192),
            "android/mipmap-xxxhdpi/ic_launcher_round.png": (192, 192),
            "android/mipmap-xxxhdpi/ic_launcher_monochrome.png": (432, 432),
        },
        "zip": {
            "android/mipmap-anydpi-v26/ic_launcher.xml",
            "android/mipmap-anydpi-v26/ic_launcher_round.xml",
            "android/mipmap-anydpi-v33/ic_launcher.xml",
            "android/mipmap-anydpi-v33/ic_launcher_round.xml",
            "android/AndroidManifest.xml",
            "iconforge-export.json",
        },
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

    def copyfile(self, source, outputfile) -> None:
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            return

    def do_GET(self) -> None:
        pwa_version = getattr(self.server, "pwa_version", None)
        request_path = urlparse(self.path).path
        if pwa_version and request_path in {"/version.js", "/sw.js"}:
            if request_path == "/version.js":
                content = f"globalThis.ICONFORGE_VERSION = '{pwa_version}';\n"
            else:
                content = (ROOT / "sw.js").read_text(encoding="utf-8")
                content += f"\n// Browser upgrade fixture: {pwa_version}\n"
            payload = content.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()


def free_port() -> int:
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def start_server() -> tuple[ThreadingHTTPServer, str]:
    port = free_port()
    handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(ROOT), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    server.pwa_version = None
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
  const zipProgress = [];
  const zipResult = await api.buildZipFromBlobs(exportFiles, {
    onProgress(update) {
      zipProgress.push({ stage: update.stage, completed: update.completed, total: update.total });
    }
  });
  const zipBlob = zipResult.blob;
  const beforeCancelledZipCount = api.getState().generatedFiles.length;
  const zipAbort = new AbortController();
  let zipCancelled = false;
  let zipCancelProgressEvents = 0;
  try {
    await api.buildZipFromBlobs(
      [{ name: "synthetic-cancel.bin", blob: new Blob([new Uint8Array(2 * 1024 * 1024)]) }],
      {
        signal: zipAbort.signal,
        onProgress() {
          zipCancelProgressEvents += 1;
          zipAbort.abort();
        }
      }
    );
  } catch (error) {
    zipCancelled = error.name === "AbortError";
  }
  const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
  const validation = await api.validateGeneratedExport();
  const diagnostics = api.buildGenerationDiagnostics({ selectedFormats: [], validationResult: validation });
  const supportReport = api.buildDiagnosticsSupportReport({ selectedFormats: [], validationResult: validation, diagnostics });
  const outputActionViolations = Array.from(document.querySelectorAll("#outputGrid .output-item")).flatMap((item) => {
    const download = item.querySelector(".btn-download");
    const copy = item.querySelector(".btn-copy");
    const fileName = download?.dataset.filename || "";
    const violations = [];
    if (!fileName || download?.getAttribute("aria-label") !== `Download ${fileName}`) violations.push(`download:${fileName}`);
    if (!fileName || copy?.getAttribute("aria-label") !== `Copy ${fileName} as Base64 data URL`) violations.push(`copy:${fileName}`);
    return violations;
  });
  const resultGroups = Array.from(document.querySelectorAll("#outputGrid .output-group")).map((group) => ({
    key: group.dataset.groupKey,
    count: group.querySelectorAll(".output-item").length,
    status: group.dataset.validationStatus,
    open: group.open
  }));
  document.querySelector("#btnCollapseResults")?.click();
  const collapsedGroupCount = document.querySelectorAll("#outputGrid .output-group:not([open])").length;
  document.querySelector("#btnExpandResults")?.click();
  const expandedGroupCount = document.querySelectorAll("#outputGrid .output-group[open]").length;
  const nameFilter = document.querySelector("#outputNameFilter");
  nameFilter.value = "splash";
  nameFilter.dispatchEvent(new Event("input", { bubbles: true }));
  const filteredResultState = {
    visibleGroups: Array.from(document.querySelectorAll("#outputGrid .output-group")).filter((group) => getComputedStyle(group).display !== "none").length,
    visibleItems: Array.from(document.querySelectorAll("#outputGrid .output-item")).filter((item) => getComputedStyle(item).display !== "none").length
  };
  nameFilter.value = "";
  nameFilter.dispatchEvent(new Event("input", { bubbles: true }));

  return {
    preset,
    statusText: document.querySelector("#status")?.textContent || "",
    validation,
    diagnostics,
    supportReport,
    files: Object.keys(decoded),
    decoded,
    zipNames: zipNames(zipBytes),
    zipSize: zipBlob.size,
    zipProgress,
    zipCancellation: {
      cancelled: zipCancelled,
      progressEvents: zipCancelProgressEvents,
      generatedFilesPreserved: api.getState().generatedFiles.length === beforeCancelledZipCount
    },
    workflowCurrent: document.querySelector('[data-workflow-step][aria-current="step"]')?.dataset.workflowStep || null,
    workflowCurrentCount: document.querySelectorAll('[data-workflow-step][aria-current="step"]').length,
    outputActionViolations,
    resultGroups,
    collapsedGroupCount,
    expandedGroupCount,
    filteredResultState,
    desktopOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    diagnosticsText: document.querySelector("#diagnosticsSummary")?.textContent || ""
  };
}
"""


def run_preset(page, url: str, preset: str, source_text: str = "IF", worker_eligible: bool = False) -> dict:
    page.goto(url, wait_until="networkidle")
    page.locator('.mode-tab[data-mode="text"]').click()
    page.locator("#textInput").fill(source_text)
    page.locator("#btnUseTextIcon").click()
    if worker_eligible:
        page.locator("#safePaddingSlider").fill("0")
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
    page.set_viewport_size({"width": 720, "height": 500})
    result["zoom200Overflow"] = page.evaluate(
        "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"
    )
    result["zoom200PrimaryActionsVisible"] = page.evaluate(
        """() => Array.from(document.querySelectorAll("#outputGrid .output-group[open] .btn-download"))
            .every((button) => button.getBoundingClientRect().width > 0)"""
    )
    page.set_viewport_size({"width": 390, "height": 844})
    result["mobileOverflow"] = page.evaluate(
        "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"
    )
    page.set_viewport_size({"width": 1440, "height": 1000})
    return result


def check_reforge_import(page, url: str) -> tuple[dict, list[str]]:
    page.goto(url, wait_until="networkidle")
    page.locator("#sourceTabText").click()
    page.locator("#textInput").fill("OLD")
    page.locator("#btnUseTextIcon").click()
    manifest = {
        "schema": "iconforge-export-v1",
        "version": "v0.4.1",
        "preset": "web",
        "options": {
            "sizes": [32, {"width": 64, "height": 96}],
            "formats": ["png", "webp"],
            "processing": {
                "paddingPercent": 12,
                "lossyQualityPercent": 84,
                "sizeBudgetBytes": 16384,
                "resample": "nearest",
                "backgroundMode": "gradient",
                "backgroundColor": "#112233",
                "backgroundColor2": "#445566",
                "effect": "desaturate",
                "dropShadow": True,
            },
            "replacementTemplate": {
                "active": True,
                "targets": ["assets/icon-32.png", "manifest.webmanifest"],
            },
            "deploymentUrls": {
                "mode": "custom",
                "customBase": "https://cdn.example.com/icons/",
                "cacheBust": True,
            },
            "manifestMetadata": {
                "name": "Reforged App",
                "shortName": "Reforged",
                "startUrl": "./launch",
                "scope": "./",
                "display": "standalone",
                "themeColor": "#112233",
                "backgroundColor": "#445566",
            },
        },
        "files": [],
    }
    page.locator("#reforgeInput").set_input_files({
        "name": "iconforge-export.json",
        "mimeType": "application/json",
        "buffer": json.dumps(manifest).encode("utf-8"),
    })
    page.wait_for_function("() => !document.querySelector('#btnApplyReforge').disabled")
    preview = page.locator("#reforgePreview").inner_text()
    page.locator("#btnApplyReforge").click()
    applied = page.evaluate(
        """() => ({
            status: document.querySelector("#reforgeStatus")?.textContent,
            preview: document.querySelector("#reforgePreview")?.textContent,
            sourceRequired: document.querySelector("#btnGenerate")?.disabled,
            preset: document.querySelector(".btn-preset.active")?.dataset.preset,
            selectedSizes: Array.from(document.querySelectorAll("#sizeGrid input:checked"), input => `${input.value}x${input.dataset.height || input.value}`),
            selectedFormats: Array.from(document.querySelectorAll("#formatOptions input:checked"), input => input.value),
            padding: document.querySelector("#safePaddingSlider")?.value,
            quality: document.querySelector("#lossyQualitySlider")?.value,
            budget: document.querySelector("#sizeBudgetInput")?.value,
            replacement: document.querySelector("#replaceStatus")?.textContent,
            urlMode: document.querySelector("#assetUrlMode")?.value,
            urlBase: document.querySelector("#assetUrlBase")?.value,
            cacheBust: document.querySelector("#cacheBustToggle")?.checked,
            manifestName: document.querySelector("#manifestName")?.value
        })"""
    )
    state_before_rejected = page.evaluate(
        """() => ({
            preset: document.querySelector(".btn-preset.active")?.dataset.preset,
            manifestName: document.querySelector("#manifestName")?.value,
            padding: document.querySelector("#safePaddingSlider")?.value
        })"""
    )
    future_manifest = {**manifest, "schemaVersion": 99}
    page.locator("#reforgeInput").set_input_files({
        "name": "future.json",
        "mimeType": "application/json",
        "buffer": json.dumps(future_manifest).encode("utf-8"),
    })
    page.wait_for_function(
        """() => document.querySelector("#btnApplyReforge")?.disabled
            && /newer than supported/.test(document.querySelector("#reforgeStatus")?.textContent || "")"""
    )
    rejected = page.evaluate(
        """() => ({
            applyDisabled: document.querySelector("#btnApplyReforge")?.disabled,
            status: document.querySelector("#reforgeStatus")?.textContent,
            state: {
                preset: document.querySelector(".btn-preset.active")?.dataset.preset,
                manifestName: document.querySelector("#manifestName")?.value,
                padding: document.querySelector("#safePaddingSlider")?.value
            }
        })"""
    )
    failures = []
    if "legacy v1 migrated in memory" not in preview:
        failures.append("reforge preview did not report in-memory v1 migration")
    if applied["status"] != "Settings applied" or "Re-select source artwork" not in applied["preview"]:
        failures.append(f"reforge apply did not request source re-selection: {applied}")
    if not applied["sourceRequired"] or applied["preset"] != "web":
        failures.append(f"reforge did not clear source and restore preset: {applied}")
    if set(applied["selectedSizes"]) != {"32x32", "64x96"} or set(applied["selectedFormats"]) != {"png", "webp"}:
        failures.append(f"reforge size/format restore mismatch: {applied}")
    if (applied["padding"], applied["quality"], applied["budget"]) != ("12", "84", "16"):
        failures.append(f"reforge processing restore mismatch: {applied}")
    if "2 target filenames restored" not in applied["replacement"]:
        failures.append(f"reforge replacement targets were not restored: {applied}")
    if (applied["urlMode"], applied["urlBase"], applied["cacheBust"]) != ("custom", "https://cdn.example.com/icons/", True):
        failures.append(f"reforge deployment settings mismatch: {applied}")
    if applied["manifestName"] != "Reforged App":
        failures.append(f"reforge manifest metadata mismatch: {applied}")
    if not rejected["applyDisabled"] or "newer than supported" not in rejected["status"]:
        failures.append(f"future reforge manifest did not fail closed: {rejected}")
    if rejected["state"] != state_before_rejected:
        failures.append(f"future reforge manifest changed current settings: {rejected}")
    return {"preview": preview, "applied": applied, "rejected": rejected}, failures


def check_image_fixture_corpus(page, url: str, include_goldens: bool = False) -> tuple[dict, list[str]]:
    cases = json.loads((FIXTURE_ROOT / "image-cases.json").read_text(encoding="utf-8"))
    report = {"valid": {}, "invalid": {}, "goldens": None}
    failures = []
    for fixture in cases["valid"]:
        page.goto(url, wait_until="networkidle")
        page.locator("#fileInput").set_input_files(str(FIXTURE_ROOT / fixture["file"]))
        page.wait_for_function(
            """name => {
                const info = document.querySelector("#previewInfo")?.textContent || "";
                const status = document.querySelector("#status");
                return info.includes(name) || status?.getAttribute("role") === "alert";
            }""",
            arg=fixture["file"],
        )
        outcome = page.evaluate(
            """() => ({
                loaded: !document.querySelector("#btnGenerate")?.disabled,
                preview: document.querySelector("#previewInfo")?.textContent || "",
                error: document.querySelector("#status")?.getAttribute("role") === "alert"
                    ? document.querySelector("#status")?.textContent || ""
                    : ""
            })"""
        )
        report["valid"][fixture["file"]] = outcome
        if fixture["format"] in {"png", "jpeg", "webp", "svg", "bmp"} and not outcome["loaded"]:
            failures.append(f"{fixture['file']} should decode in this engine: {outcome['error']}")
        if fixture.get("displayWidth") and outcome["loaded"]:
            expected_dimensions = f"{fixture['displayWidth']} × {fixture['displayHeight']}"
            if expected_dimensions not in outcome["preview"]:
                failures.append(f"{fixture['file']} did not honor EXIF orientation: {outcome['preview']}")

    for fixture in cases["invalid"]:
        page.goto(url, wait_until="networkidle")
        page.locator("#fileInput").set_input_files(str(FIXTURE_ROOT / fixture["file"]))
        page.wait_for_function(
            "() => document.querySelector('#status')?.getAttribute('role') === 'alert'"
        )
        outcome = page.evaluate(
            """() => ({
                generateDisabled: document.querySelector("#btnGenerate")?.disabled,
                error: document.querySelector("#status")?.textContent || ""
            })"""
        )
        report["invalid"][fixture["file"]] = outcome
        if not outcome["generateDisabled"]:
            failures.append(f"{fixture['file']} left generation enabled after rejection")
        if fixture.get("loadError") and fixture["loadError"].lower() not in outcome["error"].lower():
            failures.append(f"{fixture['file']} error did not explain malformed input: {outcome['error']}")

    if not include_goldens:
        return report, failures

    goldens = json.loads((FIXTURE_ROOT / "pixel-goldens.json").read_text(encoding="utf-8"))
    page.goto(url, wait_until="networkidle")
    page.locator("#fileInput").set_input_files(str(FIXTURE_ROOT / goldens["source"]))
    page.wait_for_function("() => !document.querySelector('#btnGenerate').disabled")
    page.locator("#safePaddingSlider").fill("0")
    page.locator("#sizeGrid input").evaluate_all("inputs => inputs.forEach(input => { if (input.checked) input.click(); })")
    for size in goldens["outputs"]["standard"]["sizes"]:
        page.locator(f'#sizeGrid input[value="{size}"]').evaluate("input => { if (!input.checked) input.click(); }")
    page.locator("#formatOptions input").evaluate_all(
        """inputs => inputs.forEach(input => {
            const shouldCheck = input.value === "png";
            if (input.checked !== shouldCheck) input.click();
        })"""
    )
    page.locator("#btnGenerate").click()
    page.wait_for_function(
        "() => !document.querySelector('#btnGenerate').disabled && /Generated/.test(document.querySelector('#status')?.textContent || '')"
    )
    standard = page.evaluate(
        """async ({ sizes, samples }) => {
            const files = window.__ICONFORGE_TEST__.getState().generatedFiles;
            const results = {};
            for (const size of sizes) {
                const file = files.find(item => item.format === "png" && item.size?.width === size && item.size?.height === size);
                if (!file) {
                    results[size] = { missing: true };
                    continue;
                }
                const bitmap = await createImageBitmap(file.blob);
                const canvas = document.createElement("canvas");
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                const context = canvas.getContext("2d", { willReadFrequently: true });
                context.drawImage(bitmap, 0, 0);
                results[size] = {
                    width: bitmap.width,
                    height: bitmap.height,
                    samples: samples.map(sample => {
                        const x = Math.round((bitmap.width - 1) * sample.at[0]);
                        const y = Math.round((bitmap.height - 1) * sample.at[1]);
                        return Array.from(context.getImageData(x, y, 1, 1).data);
                    })
                };
                bitmap.close();
            }
            return results;
        }""",
        {
            "sizes": goldens["outputs"]["standard"]["sizes"],
            "samples": goldens["outputs"]["standard"]["samples"],
        },
    )
    page.locator('button[data-preset="pwa"]').click()
    page.locator("#manifestMonochrome").check()
    page.locator("#btnGenerate").click()
    page.wait_for_function(
        "() => !document.querySelector('#btnGenerate').disabled && /Generated/.test(document.querySelector('#status')?.textContent || '')",
        timeout=15000,
    )
    role_files = page.evaluate(
        """async specs => {
            const files = window.__ICONFORGE_TEST__.getState().generatedFiles;
            const results = {};
            for (const [role, spec] of Object.entries(specs)) {
                const file = files.find(item => item.name === spec.file);
                if (!file) {
                    results[role] = { missing: true };
                    continue;
                }
                const bitmap = await createImageBitmap(file.blob);
                const canvas = document.createElement("canvas");
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                const context = canvas.getContext("2d", { willReadFrequently: true });
                context.drawImage(bitmap, 0, 0);
                results[role] = {
                    width: bitmap.width,
                    height: bitmap.height,
                    samples: spec.samples.map(sample => {
                        const x = Math.round((bitmap.width - 1) * sample.at[0]);
                        const y = Math.round((bitmap.height - 1) * sample.at[1]);
                        return Array.from(context.getImageData(x, y, 1, 1).data);
                    })
                };
                bitmap.close();
            }
            return results;
        }""",
        {
            "maskable": goldens["outputs"]["maskable"],
            "monochrome": goldens["outputs"]["monochrome"],
        },
    )
    report["goldens"] = {"standard": standard, "roles": role_files}

    def compare_samples(label: str, actual: dict, spec: dict, expected_dimensions: tuple[int, int]) -> None:
        if actual.get("missing"):
            failures.append(f"{label} output was not generated")
            return
        if (actual["width"], actual["height"]) != expected_dimensions:
            failures.append(f"{label} dimensions were {actual['width']}x{actual['height']}, expected {expected_dimensions[0]}x{expected_dimensions[1]}")
        for index, (pixel, sample) in enumerate(zip(actual["samples"], spec["samples"])):
            if any(abs(pixel[channel] - sample["rgba"][channel]) > sample["tolerance"][channel] for channel in range(4)):
                failures.append(f"{label} sample {index} was {pixel}, expected {sample['rgba']} within {sample['tolerance']}")

    standard_spec = goldens["outputs"]["standard"]
    for size in standard_spec["sizes"]:
        compare_samples(f"standard {size}", standard[str(size)], standard_spec, (size, size))
    compare_samples("maskable", role_files["maskable"], goldens["outputs"]["maskable"], (512, 512))
    compare_samples("monochrome", role_files["monochrome"], goldens["outputs"]["monochrome"], (512, 512))
    return report, failures


def check_localization_boundary(page, url: str) -> tuple[dict, list[str]]:
    page.goto(url, wait_until="networkidle")
    failures = []

    def layout_snapshot() -> dict:
        return page.evaluate(
            """() => ({
                lang: document.documentElement.lang,
                dir: document.documentElement.dir,
                horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
                outsideControls: Array.from(document.querySelectorAll("button, input, select, textarea"))
                    .filter(element => {
                        const rect = element.getBoundingClientRect();
                        return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
                    })
                    .map(element => element.id || element.getAttribute("aria-label") || element.textContent.trim())
                    .slice(0, 10),
                workflowSource: document.querySelector('[data-workflow-step="source"] strong')?.textContent || "",
                manifestPlaceholder: document.querySelector("#manifestName")?.placeholder || "",
                title: document.title
            })"""
        )

    page.locator("#localeSelect").select_option("en-XA")
    page.wait_for_function("() => document.documentElement.lang === 'en-XA'")
    expanded_desktop = layout_snapshot()
    page.set_viewport_size({"width": 390, "height": 844})
    expanded_mobile = layout_snapshot()
    page.reload(wait_until="networkidle")
    persisted = page.evaluate(
        """() => ({
            locale: document.querySelector("#localeSelect")?.value,
            lang: document.documentElement.lang,
            dir: document.documentElement.dir
        })"""
    )
    page.locator("#localeSelect").select_option("ar-XB")
    page.wait_for_function("() => document.documentElement.dir === 'rtl'")
    rtl_mobile = layout_snapshot()
    page.set_viewport_size({"width": 1440, "height": 1000})
    rtl_desktop = layout_snapshot()
    page.locator("#localeSelect").focus()
    page.keyboard.press("Tab")
    rtl_focus_next = page.evaluate("() => document.activeElement?.id")
    manifest_localization = page.evaluate(
        """() => {
            const api = window.__ICONFORGE_TEST__;
            api.setState({
                generatedFiles: [{
                    name: "icon-192.png",
                    format: "png",
                    size: { width: 192, height: 192 },
                    purpose: "any",
                    blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })
                }],
                manifestMetadata: {
                    name: "Localized App",
                    shortName: "Localized",
                    startUrl: "./index.html",
                    scope: "./",
                    display: "standalone",
                    shortcuts: "",
                    screenshots: "",
                    localized: ""
                }
            });
            const metadata = api.getManifestMetadata();
            const manifest = JSON.parse(api.buildManifestSnippet());
            return {
                locale: api.getState().locale,
                metadataLang: metadata.metadata.lang,
                metadataDir: metadata.metadata.dir,
                manifestLang: manifest.lang,
                manifestDir: manifest.dir
            };
        }"""
    )
    fallback = page.evaluate(
        """() => {
            const api = window.__ICONFORGE_TEST__;
            return {
                locale: api.setLocale("fr-FR", { persist: false, syncManifest: false }),
                appName: api.getUiString("shell.appName"),
                lang: document.documentElement.lang,
                dir: document.documentElement.dir
            };
        }"""
    )
    page.evaluate("() => window.__ICONFORGE_TEST__.setLocale('en')")

    for label, snapshot in (
        ("expanded desktop", expanded_desktop),
        ("expanded mobile", expanded_mobile),
        ("RTL desktop", rtl_desktop),
        ("RTL mobile", rtl_mobile),
    ):
        if snapshot["horizontalOverflow"] or snapshot["outsideControls"]:
            failures.append(f"{label} localization layout overflowed: {snapshot}")
    if not expanded_desktop["workflowSource"].startswith("［") or not expanded_desktop["manifestPlaceholder"].startswith("［"):
        failures.append(f"pseudo-expanded catalog did not cover hooked and unhooked shell text: {expanded_desktop}")
    if persisted != {"locale": "en-XA", "lang": "en-XA", "dir": "ltr"}:
        failures.append(f"locale preference did not persist across reload: {persisted}")
    if rtl_mobile["lang"] != "ar-XB" or rtl_mobile["dir"] != "rtl":
        failures.append(f"pseudo-RTL did not update document language and direction: {rtl_mobile}")
    if rtl_focus_next != "sourceTabUpload":
        failures.append(f"RTL mode changed logical focus order; next control was {rtl_focus_next}")
    if manifest_localization != {
        "locale": "ar-XB",
        "metadataLang": "ar-XB",
        "metadataDir": "rtl",
        "manifestLang": "ar-XB",
        "manifestDir": "rtl",
    }:
        failures.append(f"generated manifest did not follow pseudo locale metadata: {manifest_localization}")
    if fallback != {"locale": "en", "appName": "Icon Forge", "lang": "en", "dir": "ltr"}:
        failures.append(f"unsupported locale fallback was not deterministic: {fallback}")
    return {
        "expandedDesktop": expanded_desktop,
        "expandedMobile": expanded_mobile,
        "persisted": persisted,
        "rtlDesktop": rtl_desktop,
        "rtlMobile": rtl_mobile,
        "rtlFocusNext": rtl_focus_next,
        "manifest": manifest_localization,
        "fallback": fallback,
    }, failures


def check_role_artwork(page, url: str) -> tuple[dict, list[str]]:
    page.goto(url, wait_until="networkidle")
    failures = []
    page.locator("#fileInput").set_input_files(str(FIXTURE_ROOT / "alpha-fringe.png"))
    page.wait_for_function("() => !document.querySelector('#btnGenerate')?.disabled")
    page.locator("#roleArtworkEnabled").check()
    page.locator("#roleSplashInput").set_input_files(str(FIXTURE_ROOT / "sample.webp"))
    page.locator("#roleAndroidForegroundInput").set_input_files(str(FIXTURE_ROOT / "unicode-界.svg"))
    page.locator("#roleAndroidBackgroundInput").set_input_files(str(FIXTURE_ROOT / "orientation-6.jpg"))
    page.wait_for_function(
        """() => {
            const sources = window.__ICONFORGE_TEST__.getState().roleArtwork.sources;
            return sources.splash.name && sources.androidForeground.name && sources.androidBackground.name;
        }"""
    )
    page.locator("#roleSplashFit").select_option("cover")
    page.locator("#roleSplashPadding").fill("9")
    page.locator("#roleAndroidForegroundPadding").fill("21")
    page.locator("#roleAndroidBackgroundFit").select_option("contain")
    page.locator("#roleAndroidBackgroundPadding").fill("4")
    page.locator("#draftSourceToggle").check()

    configured = page.evaluate(
        """() => {
            const api = window.__ICONFORGE_TEST__;
            const splash = api.resolveRoleRenderSource(
                "splash",
                { naturalWidth: 64, naturalHeight: 64 },
                null,
                1200,
                630
            );
            const saved = api.saveDraftState({ silent: true });
            return {
                state: api.getState().roleArtwork,
                splashResolved: {
                    custom: splash.custom,
                    width: splash.image.naturalWidth,
                    height: splash.image.naturalHeight,
                    crop: splash.crop,
                    paddingPercent: splash.paddingPercent
                },
                draftSchema: saved.schema,
                draftBytes: JSON.stringify(saved).length,
                draftHasMain: Boolean(saved.sourceImage?.dataUrl),
                draftRoleBytes: Object.fromEntries(
                    Object.entries(saved.roleArtwork.sources).map(([key, source]) => [key, Boolean(source.dataUrl)])
                )
            };
        }"""
    )

    page.reload(wait_until="networkidle")
    page.wait_for_function(
        """() => {
            const state = window.__ICONFORGE_TEST__.getState();
            return !document.querySelector("#btnGenerate")?.disabled &&
                state.roleArtwork.sources.splash.name === "sample.webp" &&
                state.roleArtwork.sources.androidForeground.name === "unicode-界.svg" &&
                state.roleArtwork.sources.androidBackground.name === "orientation-6.jpg";
        }""",
        timeout=15000,
    )
    restored = page.evaluate(
        """() => ({
            state: window.__ICONFORGE_TEST__.getState().roleArtwork,
            visiblePreviews: Array.from(document.querySelectorAll(".role-artwork-preview"))
                .filter(preview => getComputedStyle(preview).display !== "none").length,
            status: document.querySelector("#roleArtworkStatus")?.textContent || "",
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
        })"""
    )

    page.locator('button[data-preset="android"]').click()
    page.locator("#btnGenerate").click()
    page.wait_for_function(
        """() => {
            const label = document.querySelector("#generationProgressLabel")?.textContent || "";
            return label.includes("ic_launcher_background.png");
        }""",
        timeout=15000,
    )
    page.locator("#btnCancelOperation").click()
    page.wait_for_function(
        """() => !document.querySelector("#btnGenerate")?.disabled &&
            /cancelled/i.test(document.querySelector("#status")?.textContent || "")""",
        timeout=10000,
    )
    cancelled = page.evaluate(
        """() => ({
            generatedCount: window.__ICONFORGE_TEST__.getState().generatedFiles.length,
            status: document.querySelector("#status")?.textContent || "",
            controlsEnabled: !document.querySelector("#roleArtworkEnabled")?.disabled &&
                !document.querySelector("#roleAndroidForegroundInput")?.disabled
        })"""
    )

    page.locator("#btnGenerate").click()
    page.wait_for_function(
        """() => !document.querySelector("#btnGenerate")?.disabled &&
            document.querySelectorAll("#outputGrid .output-item").length > 0""",
        timeout=30000,
    )
    generated = page.evaluate(
        """async () => {
            const api = window.__ICONFORGE_TEST__;
            const files = api.getState().generatedFiles;
            const manifestFile = (await api.getExportFilesWithManifest())
                .find(file => file.name === "iconforge-export.json");
            const manifestText = await manifestFile.blob.text();
            const manifest = JSON.parse(manifestText);
            return {
                validation: (await api.validateGeneratedExport()).status,
                foregroundRoles: Array.from(new Set(
                    files.filter(file => file.role === "android-foreground").map(file => file.sourceRole)
                )),
                backgroundRoles: Array.from(new Set(
                    files.filter(file => file.role === "android-background").map(file => file.sourceRole)
                )),
                legacyRoles: Array.from(new Set(
                    files.filter(file => file.role === "android-legacy").map(file => file.sourceRole)
                )),
                manifestRoleArtwork: manifest.options.roleArtwork,
                manifestContainsImageBytes: manifestText.includes("data:image"),
                diagnosticsRoleMetric: api.buildGenerationDiagnostics().metrics
                    .find(metric => metric.label === "Role artwork")?.value || ""
            };
        }"""
    )

    expected_role_bytes = {
        "splash": True,
        "androidForeground": True,
        "androidBackground": True,
    }
    if configured["draftSchema"] != "iconforge-draft-v3":
        failures.append(f"advanced role draft did not migrate to v3: {configured['draftSchema']}")
    if not configured["draftHasMain"] or configured["draftRoleBytes"] != expected_role_bytes:
        failures.append(f"role draft did not retain opted-in local bytes: {configured}")
    if not configured["splashResolved"]["custom"] or configured["splashResolved"]["paddingPercent"] != 9:
        failures.append(f"splash role did not resolve custom crop/scale settings: {configured['splashResolved']}")
    if restored["visiblePreviews"] != 3 or restored["overflow"]:
        failures.append(f"restored role artwork UI was incomplete or overflowing: {restored}")
    if cancelled["generatedCount"] != 0 or not cancelled["controlsEnabled"]:
        failures.append(f"role-aware generation cancellation did not roll back cleanly: {cancelled}")
    if generated["validation"] != "pass":
        failures.append(f"role-aware Android export failed validation: {generated}")
    if generated["foregroundRoles"] != ["androidForeground"] or generated["legacyRoles"] != ["androidForeground"]:
        failures.append(f"Android foreground source was not used consistently: {generated}")
    if generated["backgroundRoles"] != ["androidBackground"]:
        failures.append(f"Android background source was not used consistently: {generated}")
    if generated["manifestContainsImageBytes"]:
        failures.append("role artwork bytes leaked into iconforge-export.json")
    if not generated["manifestRoleArtwork"]["enabled"] or "sample.webp" not in json.dumps(generated["manifestRoleArtwork"]):
        failures.append(f"role settings were not recorded for reforge: {generated['manifestRoleArtwork']}")
    if "androidForeground" not in generated["diagnosticsRoleMetric"]:
        failures.append(f"role diagnostics were incomplete: {generated['diagnosticsRoleMetric']}")

    return {
        "configured": configured,
        "restored": restored,
        "cancelled": cancelled,
        "generated": generated,
    }, failures


def check_accessibility_interactions(page, url: str) -> tuple[dict, list[str]]:
    page.goto(url, wait_until="networkidle")
    failures = []
    upload_tab = page.locator("#sourceTabUpload")
    page.keyboard.press("Tab")
    if page.evaluate("() => document.activeElement?.id") != "localeSelect":
        failures.append("first keyboard tab stop should be the interface locale selector")
    page.keyboard.press("Tab")
    if page.evaluate("() => document.activeElement?.id") != "sourceTabUpload":
        failures.append("selected Upload source tab should follow the header locale selector")
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
    emoji_buttons = page.locator("#emojiGrid .emoji-btn")
    if emoji_buttons.count() < 2:
        failures.append("emoji selector did not render enough choices")
        emoji_pressed_state = None
    else:
        emoji_buttons.nth(1).click()
        emoji_pressed_state = page.evaluate(
            """() => ({
                pressed: document.querySelectorAll("#emojiGrid .emoji-btn[aria-pressed='true']").length,
                selectedMatches: document.querySelector("#emojiGrid .emoji-btn.selected")?.getAttribute("aria-pressed")
            })"""
        )
        if emoji_pressed_state != {"pressed": 1, "selectedMatches": "true"}:
            failures.append(f"emoji pressed state was incorrect: {emoji_pressed_state}")

    page.locator("#emojiSearch").fill("rocket")
    page.locator("#emojiCategory").select_option("travel")
    emoji_discovery_state = page.evaluate(
        """() => ({
            matches: [...document.querySelectorAll("#emojiGrid .emoji-btn")].map(button => ({
                emoji: button.dataset.emoji,
                name: button.title,
                category: button.dataset.category
            })),
            status: document.querySelector("#emojiSearchStatus")?.textContent
        })"""
    )
    if emoji_discovery_state["matches"] != [{"emoji": "🚀", "name": "Rocket", "category": "travel"}]:
        failures.append(f"emoji local search/category filtering was incorrect: {emoji_discovery_state}")
    page.locator("#emojiSearch").fill("")
    page.locator("#emojiCategory").select_option("all")
    page.locator("#emojiCustomInput").fill("👩‍💻")
    page.locator("#btnUseCustomEmoji").click()
    custom_emoji_state = page.evaluate(
        """() => ({
            recentVisible: getComputedStyle(document.querySelector("#emojiRecentSection")).display !== "none",
            selectedRecent: document.querySelector("#emojiRecentGrid .emoji-btn.selected")?.dataset.emoji,
            pressed: document.querySelectorAll("#emojiRecentGrid .emoji-btn[aria-pressed='true']").length,
            stored: JSON.parse(localStorage.getItem("iconforge-emoji-recents-v1") || "[]"),
            previewHasPixels: (() => {
                const canvas = document.querySelector("#emojiPreviewCanvas");
                const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
                return data.some((value, index) => index % 4 === 3 && value > 0);
            })()
        })"""
    )
    if (
        not custom_emoji_state["recentVisible"]
        or custom_emoji_state["selectedRecent"] != "👩‍💻"
        or custom_emoji_state["pressed"] != 1
        or not custom_emoji_state["stored"]
        or custom_emoji_state["stored"][0] != "👩‍💻"
        or not custom_emoji_state["previewHasPixels"]
    ):
        failures.append(f"custom/recent emoji workflow was incorrect: {custom_emoji_state}")

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
    page.locator("#shapeOptions [data-shape='circle']").click()
    shape_pressed_state = page.evaluate(
        """() => ({
            pressed: document.querySelectorAll("#shapeOptions [aria-pressed='true']").length,
            circlePressed: document.querySelector("#shapeOptions [data-shape='circle']")?.getAttribute("aria-pressed")
        })"""
    )
    if shape_pressed_state != {"pressed": 1, "circlePressed": "true"}:
        failures.append(f"text shape pressed state was incorrect: {shape_pressed_state}")
    page.locator("#textInput").fill("IF")
    page.locator("#btnUseTextIcon").click()
    page.wait_for_function("() => !document.querySelector('#btnGenerate').disabled")
    page.wait_for_function(
        "() => ['ready', 'warning'].includes(document.querySelector('#legibilityStatus')?.dataset.state)"
    )
    page.locator("#legibilityMaskControls [data-review-mask='circle']").click()
    legibility_state = page.evaluate(
        """() => ({
            visible: getComputedStyle(document.querySelector("#legibilityReview")).display !== "none",
            cards: [...document.querySelectorAll("#legibilityGrid [data-review-size]")].map(card => ({
                size: Number(card.dataset.reviewSize),
                canvases: [...card.querySelectorAll("canvas")].map(canvas => ({
                    width: canvas.width,
                    height: canvas.height,
                    mask: canvas.dataset.reviewMask
                }))
            })),
            selectedMask: document.querySelectorAll("#legibilityMaskControls [aria-pressed='true']").length,
            status: document.querySelector("#legibilityStatus")?.dataset.state,
            warnings: document.querySelectorAll("#legibilityWarnings li").length,
            generationEnabled: !document.querySelector("#btnGenerate")?.disabled
        })"""
    )
    expected_review_sizes = [16, 32, 48, 192, 512]
    if (
        not legibility_state["visible"]
        or [card["size"] for card in legibility_state["cards"]] != expected_review_sizes
        or any(len(card["canvases"]) != 3 for card in legibility_state["cards"])
        or any(
            canvas["width"] != card["size"]
            or canvas["height"] != card["size"]
            or canvas["mask"] != "circle"
            for card in legibility_state["cards"]
            for canvas in card["canvases"]
        )
        or legibility_state["selectedMask"] != 1
        or not legibility_state["generationEnabled"]
    ):
        failures.append(f"small-size review workspace was incomplete: {legibility_state}")
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
        "emojiPressed": emoji_pressed_state,
        "emojiDiscovery": emoji_discovery_state,
        "customEmoji": custom_emoji_state,
        "shapePressed": shape_pressed_state,
        "focusStyle": focus_style,
        "errorFocus": error_focus,
        "legibilityReview": legibility_state,
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
    page.wait_for_function(
        "() => document.querySelector('#draftStatus')?.textContent.includes('disabled')"
    )
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
    if result.get("workflowCurrent") != "export" or result.get("workflowCurrentCount") != 1:
        failures.append(f"{preset}: workflow rail did not expose one Export step: {result.get('workflowCurrent')}")
    if result.get("outputActionViolations"):
        failures.append(f"{preset}: output action accessible names were ambiguous: {result['outputActionViolations'][:3]}")
    if result.get("zoom200Overflow") or result.get("zoom200PrimaryActionsVisible") is not True:
        failures.append(f"{preset}: 200% equivalent viewport overflowed or hid primary actions")
    result_groups = result.get("resultGroups") or []
    if not result_groups or sum(group.get("count", 0) for group in result_groups) != len(result["files"]):
        failures.append(f"{preset}: grouped result counts did not match generated files: {result_groups}")
    if result.get("collapsedGroupCount") != len(result_groups) or result.get("expandedGroupCount") != len(result_groups):
        failures.append(f"{preset}: expand/collapse controls did not affect every result group")
    if preset == "pwa":
        groups_by_key = {group["key"]: group for group in result_groups}
        if groups_by_key.get("pwa-icons", {}).get("open") is not True or groups_by_key.get("pwa-splash", {}).get("open") is not False:
            failures.append(f"pwa: large-group disclosure defaults were incorrect: {result_groups}")
        if result.get("filteredResultState") != {"visibleGroups": 1, "visibleItems": 40}:
            failures.append(f"pwa: filename filtering did not isolate startup images: {result.get('filteredResultState')}")
    zip_progress = result.get("zipProgress") or []
    if not zip_progress or zip_progress[-1].get("completed") != zip_progress[-1].get("total"):
        failures.append(f"{preset}: ZIP progress did not reach completion: {zip_progress[-1:]}")
    if result.get("zipCancellation") != {
        "cancelled": True,
        "progressEvents": 1,
        "generatedFilesPreserved": True,
    }:
        failures.append(f"{preset}: ZIP cancellation did not preserve generated files: {result.get('zipCancellation')}")
    support_report = result["supportReport"]
    if support_report.get("schema") != "iconforge-diagnostics" or support_report.get("schemaVersion") != 2:
        failures.append(f"{preset}: diagnostics schema contract was incorrect")
    operation = support_report.get("operation") or {}
    if operation.get("status") != "completed" or not operation.get("stages"):
        failures.append(f"{preset}: completed operation timings were missing: {operation}")
    if support_report.get("serviceWorker", {}).get("supported") is not True:
        failures.append(f"{preset}: service-worker diagnostics did not report browser support")
    if "data:image" in json.dumps(support_report):
        failures.append(f"{preset}: diagnostics leaked source image bytes")
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


def check_source_and_capability_paths(page) -> tuple[dict, list[str]]:
    page.wait_for_function(
        "() => window.__ICONFORGE_TEST__.getState().featureSupport.webpChecked"
        " && window.__ICONFORGE_TEST__.getState().featureSupport.avifChecked"
    )
    result = page.evaluate(
        """() => {
            const api = window.__ICONFORGE_TEST__;
            const sourceChecks = {
                valid: api.inspectSourceFile({ name: "icon.png", type: "image/png", size: 1024 }),
                invalid: api.inspectSourceFile({ name: "notes.txt", type: "text/plain", size: 10 }),
                large: api.inspectSourceFile({ name: "large.png", type: "image/png", size: 51 * 1024 * 1024 }),
                tooLarge: api.inspectSourceFile({ name: "huge.png", type: "image/png", size: 201 * 1024 * 1024 })
            };
            let unicodeSvg = "";
            let unsafeSvgError = "";
            try {
                unicodeSvg = api.validateSvgSourceText('<svg xmlns="http://www.w3.org/2000/svg"><text>界🚀</text></svg>', "unicode.svg");
            } catch (error) {
                unicodeSvg = `ERROR: ${error.message}`;
            }
            try {
                api.validateSvgSourceText('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "unsafe.svg");
            } catch (error) {
                unsafeSvgError = error.message;
            }
            const support = api.getState().featureSupport;
            return {
                sourceChecks,
                unicodeSvg,
                unsafeSvgError,
                formats: {
                    webp: {
                        checked: support.webpChecked,
                        supported: support.webpEncode,
                        visible: getComputedStyle(document.querySelector("#webpFormatOption")).display !== "none"
                    },
                    avif: {
                        checked: support.avifChecked,
                        supported: support.avifEncode,
                        visible: getComputedStyle(document.querySelector("#avifFormatOption")).display !== "none"
                    }
                },
                capabilities: {
                    workerApi: support.workerApi,
                    blobWorker: support.blobWorker,
                    offscreenCanvas: support.offscreenCanvas,
                    fileSystemAccess: support.fileSystemAccess,
                    fileHandling: support.fileHandling
                }
            };
        }"""
    )
    failures = []
    checks = result["sourceChecks"]
    if checks["valid"]["code"] != "SOURCE_ACCEPTED":
        failures.append(f"valid image source was rejected: {checks['valid']}")
    if checks["invalid"]["code"] != "SOURCE_TYPE_INVALID":
        failures.append(f"invalid source type was not rejected: {checks['invalid']}")
    if checks["tooLarge"]["code"] != "SOURCE_TOO_LARGE":
        failures.append(f"oversize source was not rejected before allocation: {checks['tooLarge']}")
    if not checks["large"]["warning"]:
        failures.append(f"large source warning was not reported: {checks['large']}")
    if "界🚀" not in result["unicodeSvg"]:
        failures.append(f"Unicode SVG source did not survive validation: {result['unicodeSvg']}")
    if "active SVG content" not in result["unsafeSvgError"]:
        failures.append(f"unsafe SVG source was not rejected: {result['unsafeSvgError']!r}")
    for name, state in result["formats"].items():
        if not state["checked"]:
            failures.append(f"{name}: encoder capability check did not complete")
        if state["visible"] != state["supported"]:
            failures.append(f"{name}: visibility {state['visible']} did not match support {state['supported']}")
    return result, failures


def check_supported_format_outputs(page, capability_report: dict) -> tuple[list[dict], list[str]]:
    supported = [
        name for name, state in capability_report["formats"].items()
        if state["supported"]
    ]
    if not supported:
        return [], []
    page.locator("#formatOptions input").evaluate_all(
        "elements => elements.forEach(element => { if (element.checked) element.click(); })"
    )
    page.locator("#sizeGrid input").evaluate_all(
        "elements => elements.forEach(element => { if (element.checked) element.click(); })"
    )
    page.locator('#sizeGrid input[value="16"]').evaluate("element => element.click()")
    for output_format in supported:
        page.locator(f'#formatOptions input[value="{output_format}"]').evaluate("element => element.click()")
    page.locator("#btnGenerate").click()
    page.wait_for_function(
        """() => {
            const button = document.querySelector("#btnGenerate");
            const status = document.querySelector("#status")?.textContent || "";
            return button && !button.disabled && /Generated/.test(status);
        }""",
        timeout=15000,
    )
    outputs = page.evaluate(
        """() => window.__ICONFORGE_TEST__.getState().generatedFiles.map(file => ({
            name: file.name,
            format: file.format,
            mime: file.blob.type,
            bytes: file.blob.size
        }))"""
    )
    failures = []
    for output_format in supported:
        matches = [item for item in outputs if item["format"] == output_format]
        if not matches:
            failures.append(f"{output_format}: supported encoder produced no output")
        elif any(item["bytes"] <= 0 or item["mime"] != f"image/{output_format}" for item in matches):
            failures.append(f"{output_format}: output contract mismatch: {matches}")
    return outputs, failures


def check_pwa_upgrade(
    browser,
    url: str,
    server: ThreadingHTTPServer,
    engine_name: str,
) -> tuple[dict, list[str]]:
    if engine_name != "chromium":
        return {
            "supported": False,
            "status": "unsupported-by-harness",
            "reason": "Production manifest diagnostics require the Chromium DevTools Protocol.",
        }, []

    previous_version = PREVIOUS_VERSION
    report = {
        "supported": True,
        "status": "fail",
        "fromVersion": previous_version,
        "toVersion": CURRENT_VERSION,
    }
    failures = []
    context = browser.new_context(viewport={"width": 1280, "height": 800})
    page = context.new_page()
    page.add_init_script("window.__ICONFORGE_ENABLE_TEST_API__ = true;")
    try:
        server.pwa_version = previous_version
        page.goto(url, wait_until="networkidle")
        cdp = context.new_cdp_session(page)
        cdp.send("Page.enable")
        manifest_result = cdp.send("Page.getAppManifest")
        manifest_errors = manifest_result.get("errors", [])
        report["manifestErrors"] = manifest_errors
        if manifest_errors:
            failures.append(f"production manifest diagnostics reported errors: {manifest_errors}")

        page.wait_for_function("() => navigator.serviceWorker?.ready", timeout=10000)
        page.reload(wait_until="networkidle")
        page.wait_for_function("() => Boolean(navigator.serviceWorker?.controller)", timeout=10000)
        page.wait_for_function(
            f"() => window.__ICONFORGE_TEST__?.APP_VERSION === {json.dumps(previous_version)}"
        )
        page.locator("#manifestName").fill("Upgrade Draft")
        page.wait_for_timeout(500)
        old_caches = page.evaluate("() => caches.keys()")
        report["oldCaches"] = old_caches
        if f"iconforge-{previous_version}" not in old_caches:
            failures.append(f"old shell cache was not installed: {old_caches}")

        server.pwa_version = CURRENT_VERSION
        page.evaluate(
            """async () => {
                const registration = await navigator.serviceWorker.getRegistration();
                await registration.update();
            }"""
        )
        page.wait_for_function(
            """() => {
                const notice = document.querySelector("#updateNotice");
                return Boolean(notice && !notice.hidden && document.querySelector("#btnReloadUpdate"));
            }""",
            timeout=15000,
        )
        before_reload = page.evaluate(
            """async () => {
                const registration = await navigator.serviceWorker.getRegistration();
                return {
                    waiting: Boolean(registration.waiting),
                    noticeText: document.querySelector("#updateNoticeText")?.textContent || "",
                    updateActionCount: document.querySelectorAll("#btnReloadUpdate").length,
                    controllerVersion: window.__ICONFORGE_TEST__?.APP_VERSION,
                    draftName: document.querySelector("#manifestName")?.value
                };
            }"""
        )
        report["beforeReload"] = before_reload
        if not before_reload["waiting"] or before_reload["controllerVersion"] != previous_version:
            failures.append(f"new worker did not wait for user-controlled activation: {before_reload}")
        if before_reload["updateActionCount"] != 1:
            failures.append(f"update notice exposed {before_reload['updateActionCount']} reload actions")

        with page.expect_navigation(wait_until="domcontentloaded", timeout=15000):
            page.locator("#btnReloadUpdate").click()
        page.wait_for_function(
            f"() => window.__ICONFORGE_TEST__?.APP_VERSION === {json.dumps(CURRENT_VERSION)}",
            timeout=10000,
        )
        page.wait_for_function(
            "() => document.querySelector('#manifestName')?.value === 'Upgrade Draft'",
            timeout=10000,
        )
        new_caches = page.evaluate("() => caches.keys()")
        report["newCaches"] = new_caches
        report["restoredDraft"] = page.locator("#manifestName").input_value()
        report["activeVersion"] = page.evaluate("() => window.__ICONFORGE_TEST__.APP_VERSION")
        if new_caches != [f"iconforge-{CURRENT_VERSION}"]:
            failures.append(f"obsolete caches remained after activation: {new_caches}")
        if report["restoredDraft"] != "Upgrade Draft":
            failures.append("eligible settings draft was not restored after update reload")

        context.set_offline(True)
        offline_page = context.new_page()
        try:
            offline_page.goto(url, wait_until="domcontentloaded", timeout=10000)
            report["offlineReopen"] = offline_page.locator("#btnGenerate").is_visible()
        finally:
            offline_page.close()
            context.set_offline(False)
        if not report["offlineReopen"]:
            failures.append("updated shell did not reopen offline")
        report["status"] = "pass" if not failures else "fail"
    except Exception as error:
        report["reason"] = str(error).splitlines()[0]
        failures.append(f"PWA upgrade harness failed: {report['reason']}")
    finally:
        server.pwa_version = None
        context.close()
    return report, failures


def check_offline_navigation(browser, url: str) -> tuple[dict, list[str]]:
    context = browser.new_context(viewport={"width": 1280, "height": 800})
    page = context.new_page()
    report = {"supported": False, "root": False, "index": False, "status": "unsupported"}
    failures = []
    try:
        page.goto(url, wait_until="networkidle")
        report["supported"] = page.evaluate("() => 'serviceWorker' in navigator")
        if not report["supported"]:
            return report, failures
        page.wait_for_function("() => navigator.serviceWorker?.ready", timeout=10000)
        page.wait_for_function("() => Boolean(navigator.serviceWorker?.controller)", timeout=10000)
        context.set_offline(True)
        offline_page = context.new_page()
        try:
            try:
                offline_page.goto(url, wait_until="domcontentloaded")
                report["root"] = offline_page.locator("h1").get_by_text("Icon Forge").is_visible()
                offline_page.goto(f"{url}index.html", wait_until="domcontentloaded")
                report["index"] = offline_page.locator("#btnGenerate").is_visible()
            except Exception as error:
                report["status"] = "unsupported-by-harness"
                report["reason"] = str(error).splitlines()[0]
                return report, failures
        finally:
            offline_page.close()
            context.set_offline(False)
        report["status"] = "pass" if report["root"] and report["index"] else "fail"
        if report["status"] == "fail":
            failures.append(f"offline shell did not render both navigation forms: {report}")
    finally:
        context.close()
    return report, failures


def main() -> int:
    server, url = start_server()
    console_messages: list[dict] = []
    page_errors: list[str] = []
    results = []
    failures = []
    accessibility = {}
    localization = {}
    role_artwork = {}
    reforge = {}
    engine_matrix = {}

    try:
        with sync_playwright() as p:
            chromium = p.chromium.launch(headless=True)
            accessibility_context = chromium.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
            accessibility_page = accessibility_context.new_page()
            accessibility_page.add_init_script("window.__ICONFORGE_ENABLE_TEST_API__ = true;")
            accessibility_page.on("console", lambda msg: console_messages.append({"type": msg.type, "text": msg.text}))
            accessibility_page.on("pageerror", lambda exc: page_errors.append(str(exc)))
            accessibility, accessibility_failures = check_accessibility_interactions(accessibility_page, url)
            failures.extend(accessibility_failures)
            localization, localization_failures = check_localization_boundary(accessibility_page, url)
            failures.extend(localization_failures)
            reforge, reforge_failures = check_reforge_import(accessibility_page, url)
            failures.extend(reforge_failures)
            accessibility_context.close()

            context = chromium.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
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
            context.close()

            role_context = chromium.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
            role_page = role_context.new_page()
            role_page.add_init_script("window.__ICONFORGE_ENABLE_TEST_API__ = true;")
            role_page.on("console", lambda msg: console_messages.append({"type": msg.type, "text": msg.text}))
            role_page.on("pageerror", lambda exc: page_errors.append(str(exc)))
            role_artwork, role_artwork_failures = check_role_artwork(role_page, url)
            failures.extend(role_artwork_failures)
            role_context.close()
            chromium.close()

            for engine_name in ("chromium", "firefox", "webkit"):
                browser_type = getattr(p, engine_name)
                browser = browser_type.launch(headless=True)
                engine_failures = []

                pwa_upgrade, pwa_upgrade_failures = check_pwa_upgrade(browser, url, server, engine_name)
                engine_failures.extend(pwa_upgrade_failures)

                fixture_context = browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
                fixture_page = fixture_context.new_page()
                fixture_page.add_init_script("window.__ICONFORGE_ENABLE_TEST_API__ = true;")
                fixture_report, fixture_failures = check_image_fixture_corpus(
                    fixture_page,
                    url,
                    include_goldens=engine_name == "chromium",
                )
                engine_failures.extend(fixture_failures)
                fixture_context.close()

                draft_context = browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
                draft_page = draft_context.new_page()
                draft_page.add_init_script("window.__ICONFORGE_ENABLE_TEST_API__ = true;")
                draft_page.on("console", lambda msg, engine=engine_name: console_messages.append({"engine": engine, "type": msg.type, "text": msg.text}))
                draft_page.on("pageerror", lambda exc, engine=engine_name: page_errors.append(f"{engine}: {exc}"))
                draft_recovery, draft_failures = check_draft_recovery(draft_page, url)
                engine_failures.extend(draft_failures)
                draft_context.close()

                resilience_context = browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
                resilience_page = resilience_context.new_page()
                resilience_page.add_init_script(
                    """window.__ICONFORGE_ENABLE_TEST_API__ = true;
                    window.Worker = class WorkerFailureProbe {
                        constructor() { throw new Error("forced worker initialization failure"); }
                    };"""
                )
                resilience_page.on("console", lambda msg, engine=engine_name: console_messages.append({"engine": engine, "type": msg.type, "text": msg.text}))
                resilience_page.on("pageerror", lambda exc, engine=engine_name: page_errors.append(f"{engine}: {exc}"))
                representative = run_preset(resilience_page, url, "web", source_text="界", worker_eligible=True)
                engine_failures.extend(validate_result(representative))
                capability_report, capability_failures = check_source_and_capability_paths(resilience_page)
                engine_failures.extend(capability_failures)
                worker_metric = next(
                    (
                        metric["value"] for metric in representative["diagnostics"]["metrics"]
                        if metric["label"] == "Worker fallback state"
                    ),
                    "",
                )
                expected_fallback = (
                    "blob worker unavailable"
                    if capability_report["capabilities"]["offscreenCanvas"]
                    else "OffscreenCanvas unavailable"
                )
                if expected_fallback.lower() not in worker_metric.lower():
                    engine_failures.append(
                        f"forced worker failure/unsupported path was not surfaced; "
                        f"expected {expected_fallback!r}, received {worker_metric!r}"
                    )
                format_outputs, format_failures = check_supported_format_outputs(resilience_page, capability_report)
                engine_failures.extend(format_failures)
                resilience_context.close()

                offline, offline_failures = check_offline_navigation(browser, url)
                engine_failures.extend(offline_failures)
                engine_matrix[engine_name] = {
                    "representative": {
                        "fileCount": len(representative["files"]),
                        "zipEntries": len(representative["zipNames"]),
                        "validation": representative["validation"]["status"],
                    },
                    "sourceChecks": capability_report["sourceChecks"],
                    "formats": capability_report["formats"],
                    "formatOutputs": format_outputs,
                    "capabilities": {
                        key: {
                            "supported": value,
                            "status": "supported" if value else "unsupported",
                        }
                        for key, value in capability_report["capabilities"].items()
                    },
                    "workerFallback": worker_metric,
                    "pwaUpgrade": pwa_upgrade,
                    "imageFixtures": fixture_report,
                    "draftRecovery": draft_recovery,
                    "offlineShell": offline,
                    "failures": engine_failures,
                }
                failures.extend(f"{engine_name}: {failure}" for failure in engine_failures)
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
        "localization": localization,
        "roleArtwork": role_artwork,
        "reforge": reforge,
        "engines": engine_matrix,
        "failures": failures,
    }
    print(json.dumps(summary, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
