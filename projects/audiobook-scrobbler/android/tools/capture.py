#!/usr/bin/env python3
"""
Record what real players (Audible, Libby, Libro.fm, ...) actually publish.

Installs the debug app on an attached phone, grants notification access,
points the app at a mock ingest server on this PC (through `adb reverse`),
switches on capture-every-app, and writes every event the listener uploads
to a JSONL file while printing a live summary. Ctrl+C to stop.

    python tools/capture.py                     # attached USB device, build + install
    python tools/capture.py --no-build          # reuse the APK already built
    python tools/capture.py --serial <id>       # pick a device when several are attached
    python tools/capture.py --apps com.audible.application   # allow-list instead of capture-all
    python tools/capture.py --leave             # keep the phone pointed at the mock server on exit

Phone side: enable Developer options -> USB debugging, plug in, accept the
"Allow USB debugging?" prompt. The phone needs Wi-Fi or mobile data on for
WorkManager's network constraint; the actual bytes go over USB.

Output: tools/captures/<timestamp>.jsonl (one event per line, exactly as
posted) and <timestamp>.summary.json (per app: raw metadata keys seen, sample
values, event type counts). Use the summary to set `app_field_maps` on the
server and to build a fake-player fixture.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import signal
import sys
import threading
import time
from collections import Counter, defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import e2e  # noqa: E402  (shared adb/gradle helpers)

CAPTURES = e2e.HERE / "captures"
LEAVE_MSG = "left configured against the mock server; open the app and set the real server URL, or run capture.py again with --restore-url <url>"


def pick_device(serial: str | None) -> e2e.Device:
    devs = e2e.list_devices()
    online = [s for s, st in devs if st == "device"]
    if serial:
        if serial not in online:
            sys.exit(f"{serial} is not online. adb devices: {devs}")
        return e2e.Device(serial)
    phones = [s for s in online if not s.startswith("emulator-")]
    if not phones:
        unauthorized = [s for s, st in devs if st == "unauthorized"]
        if unauthorized:
            sys.exit(f"phone {unauthorized[0]} is attached but unauthorized: accept the USB debugging prompt on it and re-run")
        sys.exit(f"no phone attached (adb devices: {devs}). Enable USB debugging and plug it in, or pass --serial for an emulator.")
    if len(phones) > 1:
        sys.exit(f"several devices attached, pass --serial: {phones}")
    d = e2e.Device(phones[0])
    e2e.log(f"using {phones[0]}: {d.shell('getprop ro.product.model')} Android {d.shell('getprop ro.build.version.release')} (API {d.shell('getprop ro.build.version.sdk')})")
    return d


class Recorder:
    def __init__(self, path: pathlib.Path) -> None:
        self.path = path
        self.f = path.open("a", encoding="utf-8")
        self.lock = threading.Lock()
        self.count = 0
        self.posts = 0
        self.types: dict[str, Counter] = defaultdict(Counter)
        self.keys: dict[str, dict[str, set]] = defaultdict(lambda: defaultdict(set))
        self.first_seen: set[str] = set()

    def add(self, events: list[dict]) -> None:
        with self.lock:
            self.posts += 1
            for e in events:
                self.f.write(json.dumps(e, ensure_ascii=False) + "\n")
                self.count += 1
                app = e.get("app_package", "?")
                self.types[app][e.get("event_type", "?")] += 1
                raw = e.get("raw") or {}
                for k, v in raw.items():
                    if k == "queue":
                        continue
                    vs = self.keys[app][k]
                    if len(vs) < 5:
                        vs.add(str(v)[:80])
                if app not in self.first_seen:
                    self.first_seen.add(app)
                    e2e.log(f"NEW APP {app}: raw keys = {sorted(raw.keys())}")
                    for k in sorted(raw.keys()):
                        e2e.log(f"    {k} = {str(raw[k])[:100]!r}")
                pos = e.get("position_ms")
                e2e.log(
                    f"{e.get('event_type'):8} {app.split('.')[-1]:14} ch={e.get('chapter_idx')} "
                    f"pos={None if pos is None else pos // 1000}s dur={None if e.get('duration_ms') is None else e['duration_ms'] // 1000}s "
                    f"x{e.get('playback_speed')} | ALBUM={raw.get('android.media.metadata.ALBUM')!r} "
                    f"TITLE={raw.get('android.media.metadata.TITLE')!r} DISPLAY_TITLE={raw.get('android.media.metadata.DISPLAY_TITLE')!r} "
                    f"ARTIST={raw.get('android.media.metadata.ARTIST')!r}"
                    + (f" queue={len(e['queue'])}" if e.get("queue") else "")
                )
            self.f.flush()

    def summary(self) -> dict:
        with self.lock:
            return {
                "events": self.count,
                "posts": self.posts,
                "apps": {
                    app: {
                        "event_types": dict(self.types[app]),
                        "raw_keys": {k: sorted(v) for k, v in sorted(self.keys[app].items())},
                    }
                    for app in sorted(self.types)
                },
            }

    def close(self) -> None:
        self.f.close()


def make_handler(rec: Recorder):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _json(self, code: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self._json(200, {"actions": []} if self.path.startswith("/api/actions") else {"error": "not found"})

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            if self.path == "/api/ingest":
                evs = body.get("events", [])
                rec.add(evs)
                self._json(200, {"accepted": len(evs), "ignored_app": 0, "no_identity": 0, "books_created": 0, "reads_touched": 0})
            else:
                self._json(200, {"ok": True})

    return Handler


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--serial")
    ap.add_argument("--no-build", action="store_true")
    ap.add_argument("--no-install", action="store_true", help="app is already installed and up to date")
    ap.add_argument("--apps", help="comma-separated allow-list; default is capture every media app")
    ap.add_argument("--port", type=int, default=e2e.PORT)
    ap.add_argument("--out", help="JSONL path (default tools/captures/<timestamp>.jsonl)")
    ap.add_argument("--leave", action="store_true", help="don't reset the app's server URL on exit")
    ap.add_argument("--restore-url", help="server URL to put back into the app on exit (default: clear it)")
    ap.add_argument("--restore-token", default="")
    ap.add_argument("--duration", type=float, help="stop after N seconds instead of waiting for Ctrl+C")
    ap.add_argument("--stop-file", help="also stop as soon as this file exists (for unattended runs)")
    args = ap.parse_args()

    e2e.ensure_java_home()
    d = pick_device(args.serial)
    if not args.no_install:
        if not args.no_build:
            e2e.log("gradle :app:assembleDebug")
            e2e.run([str(e2e.GRADLEW), ":app:assembleDebug", "-q"], capture=False, cwd=e2e.ANDROID, timeout=1800)
        e2e.log(f"installing {e2e.APP_APK.name}")
        d.adb("install", "-r", "-g", str(e2e.APP_APK), timeout=300)

    CAPTURES.mkdir(exist_ok=True)
    out = pathlib.Path(args.out) if args.out else CAPTURES / (time.strftime("%Y%m%d-%H%M%S") + ".jsonl")
    rec = Recorder(out)
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(rec))
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    d.adb("reverse", f"tcp:{args.port}", f"tcp:{args.port}")
    cfg = (
        f"am broadcast -W -n {e2e.DEBUG_RECEIVER} -a {e2e.APP}.DEBUG_CONFIG "
        f"--es server_url http://127.0.0.1:{args.port} --es token {e2e.TOKEN} --es device_name capture "
        f"--ez reset true --ez upload_now true "
        + (f"--es allowed_apps {args.apps} --ez capture_all false" if args.apps else "--ez capture_all true")
    )
    if "configured=true" not in d.shell(cfg):
        sys.exit("debug config broadcast failed (is this a debug build?)")
    d.shell("logcat -c", check=False)
    # Bind the listener only now: its first act is a snapshot of every open
    # session, which must land after the reset above, not be wiped by it.
    e2e.grant_listener(d)

    e2e.log(f"recording to {out}")
    e2e.log("play something in Audible / Libby / Libro.fm on the phone. Pause, seek, skip chapters, switch books. Ctrl+C here to stop.")
    e2e.log("(the app uploads a few seconds after each change; keep the phone on Wi-Fi so WorkManager's network constraint is met)")

    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    deadline = time.time() + args.duration if args.duration else None
    next_hint = time.time() + 30
    while not stop.is_set() and (deadline is None or time.time() < deadline):
        time.sleep(1)
        if args.stop_file and pathlib.Path(args.stop_file).exists():
            break
        if not rec.count and time.time() >= next_hint:
            next_hint = time.time() + 30
            sessions = d.shell("dumpsys media_session | grep -E 'package=|state=' | head -n 12", check=False)
            e2e.log("no events yet. media sessions on the phone:\n" + (sessions or "  (none)"))

    e2e.log("stopping")
    d.shell(f"am broadcast -W -n {e2e.DEBUG_RECEIVER} -a {e2e.APP}.DEBUG_CONFIG --ez upload_now true", check=False)
    time.sleep(4)  # last flush
    srv.shutdown()
    rec.close()
    summary = rec.summary()
    out.with_suffix(".summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    e2e.log(f"{summary['events']} events from {len(summary['apps'])} app(s) in {summary['posts']} uploads -> {out} and {out.with_suffix('.summary.json').name}")
    for app, info in summary["apps"].items():
        e2e.log(f"  {app}: {info['event_types']}")
        e2e.log(f"     keys: {', '.join(info['raw_keys'])}")

    d.adb("reverse", "--remove", f"tcp:{args.port}", check=False)
    if args.leave:
        e2e.log(LEAVE_MSG)
    else:
        url = args.restore_url or ""
        d.shell(
            f"am broadcast -W -n {e2e.DEBUG_RECEIVER} -a {e2e.APP}.DEBUG_CONFIG --es server_url '{url}' --es token '{args.restore_token}' "
            f"--ez capture_all false --es allowed_apps {','.join(sorted(summary['apps'])) or 'com.audible.application'}",
            check=False,
        )
        e2e.log("app reset: " + (f"server {url}" if url else "server URL cleared") + f", allow-list = {sorted(summary['apps'])}")
    logcat = d.shell("logcat -d -s MediaListener:* AndroidRuntime:E | tail -n 20", check=False)
    if "AndroidRuntime" in logcat or "emit failed" in logcat:
        e2e.log("logcat had errors:\n" + logcat)
    return 0


if __name__ == "__main__":
    sys.exit(main())
