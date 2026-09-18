#!/usr/bin/env python3
"""
End-to-end loop for the Android capture app, no real player needed:

  emulator up -> build app + fakeplayer -> install -> grant notification access
  -> mock ingest server on the host (adb reverse) -> scripted "listen" in the
  fake player -> assert on the events the scrobbler uploaded.

    python tools/e2e.py                 # everything, headless emulator
    python tools/e2e.py --window        # show the emulator window
    python tools/e2e.py --no-build      # reuse the APKs already built
    python tools/e2e.py --connected     # also run the instrumented unit tests
    python tools/e2e.py --sample        # also wait for a 60 s position sample
    python tools/e2e.py --serial <id>   # use an attached device instead of the AVD
    python tools/e2e.py --kill          # shut the emulator down at the end

Requires ANDROID_HOME (or the default SDK location) with platform-tools,
emulator, cmdline-tools and the system image below, and JAVA_HOME for gradle.
Exit code 0 means every assertion passed.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import platform
import shlex
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = pathlib.Path(__file__).resolve().parent
ANDROID = HERE.parent
WIN = platform.system() == "Windows"

APP = "com.curijoes.audioscrobbler"
LISTENER = f"{APP}/{APP}.MediaListenerService"
DEBUG_RECEIVER = f"{APP}/.DebugConfigReceiver"
FAKE = "com.curijoes.fakeplayer"
FAKE_ACTIVITY = f"{FAKE}/.MainActivity"

AVD = "scrobbler-api36"
IMAGE = "system-images;android-36;google_apis;x86_64"
DEVICE_PROFILE = "pixel_6"
PORT = 8765
TOKEN = "e2e-token"

APP_APK = ANDROID / "app/build/outputs/apk/debug/app-debug.apk"
FAKE_APK = ANDROID / "fakeplayer/build/outputs/apk/debug/fakeplayer-debug.apk"


# --- environment ----------------------------------------------------------

def sdk_root() -> pathlib.Path:
    for var in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        if os.environ.get(var):
            return pathlib.Path(os.environ[var])
    if WIN:
        return pathlib.Path(os.environ["LOCALAPPDATA"]) / "Android/Sdk"
    if platform.system() == "Darwin":
        return pathlib.Path.home() / "Library/Android/sdk"
    return pathlib.Path.home() / "Android/Sdk"


SDK = sdk_root()
ADB = SDK / "platform-tools" / ("adb.exe" if WIN else "adb")
EMULATOR = SDK / "emulator" / ("emulator.exe" if WIN else "emulator")
AVDMANAGER = SDK / "cmdline-tools/latest/bin" / ("avdmanager.bat" if WIN else "avdmanager")
GRADLEW = ANDROID / ("gradlew.bat" if WIN else "gradlew")


def ensure_java_home() -> None:
    if os.environ.get("JAVA_HOME"):
        return
    candidates = []
    if WIN:
        candidates += [pathlib.Path(os.environ["LOCALAPPDATA"]) / "Programs/jdk-17", pathlib.Path("C:/Program Files/Android/Android Studio/jbr")]
    else:
        candidates += [pathlib.Path("/Applications/Android Studio.app/Contents/jbr/Contents/Home"), pathlib.Path("/usr/lib/jvm/java-17-openjdk-amd64")]
    for c in candidates:
        if (c / "bin").exists():
            os.environ["JAVA_HOME"] = str(c)
            return
    sys.exit("JAVA_HOME is not set and no JDK was found")


def log(msg: str) -> None:
    print(f"[e2e {time.strftime('%H:%M:%S')}] {msg}", flush=True)


def run(cmd: list[str], check: bool = True, capture: bool = True, timeout: int | None = 600, **kw) -> subprocess.CompletedProcess:
    r = subprocess.run(cmd, check=False, capture_output=capture, text=True, timeout=timeout, **kw)
    if check and r.returncode != 0:
        out = (r.stdout or "") + (r.stderr or "")
        raise RuntimeError(f"command failed ({r.returncode}): {' '.join(map(str, cmd))}\n{out[-4000:]}")
    return r


class Device:
    def __init__(self, serial: str | None):
        self.serial = serial

    def adb(self, *args: str, check: bool = True, timeout: int = 120) -> str:
        cmd = [str(ADB)] + (["-s", self.serial] if self.serial else []) + list(args)
        return run(cmd, check=check, timeout=timeout).stdout.strip()

    def shell(self, script: str, check: bool = True, timeout: int = 120) -> str:
        """One shell string, quoted for the device's /bin/sh."""
        return self.adb("shell", script, check=check, timeout=timeout)

    def am_start(self, component: str, action: str, **extras) -> str:
        parts = ["am", "start", "-W", "-n", component, "-a", action]
        for k, v in extras.items():
            if isinstance(v, bool):
                parts += ["--ez", k, "true" if v else "false"]
            elif isinstance(v, int):
                parts += ["--el" if abs(v) > 2**31 - 1 or k.endswith("_ms") else "--ei", k, str(v)]
            elif isinstance(v, float):
                parts += ["--ef", k, str(v)]
            else:
                parts += ["--es", k, str(v)]
        return self.shell(" ".join(shlex.quote(p) for p in parts))


# --- emulator ---------------------------------------------------------------

def list_devices() -> list[tuple[str, str]]:
    out = run([str(ADB), "devices"]).stdout.splitlines()[1:]
    return [tuple(line.split("\t")[:2]) for line in out if "\t" in line]


def ensure_avd() -> None:
    avds = run([str(EMULATOR), "-list-avds"]).stdout.split()
    if AVD in avds:
        return
    if not (SDK / "system-images/android-36/google_apis/x86_64").exists():
        sys.exit(f"system image {IMAGE} is not installed; run:\n  {SDK / 'cmdline-tools/latest/bin/android'} sdk install system-images/android-36/google_apis/x86_64")
    log(f"creating AVD {AVD}")
    run([str(AVDMANAGER), "create", "avd", "-n", AVD, "-k", IMAGE, "-d", DEVICE_PROFILE, "--force"], input="no\n")


def boot_emulator(window: bool) -> Device:
    ensure_avd()
    log(f"booting emulator {AVD} ({'window' if window else 'headless'})")
    args = [str(EMULATOR), "-avd", AVD, "-no-audio", "-no-boot-anim", "-gpu", "swiftshader_indirect", "-netdelay", "none", "-netspeed", "full"]
    if not window:
        args.append("-no-window")
    subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
    deadline = time.time() + 360
    serial = None
    while time.time() < deadline:
        for s, state in list_devices():
            if s.startswith("emulator-") and state == "device":
                serial = s
        if serial:
            d = Device(serial)
            if d.shell("getprop sys.boot_completed", check=False) == "1":
                log(f"emulator {serial} booted")
                d.shell("settings put global window_animation_scale 0; settings put global transition_animation_scale 0; settings put global animator_duration_scale 0", check=False)
                return d
        time.sleep(3)
    sys.exit("emulator did not boot in time")


def ensure_device(serial: str | None, window: bool) -> Device:
    devs = [(s, st) for s, st in list_devices() if st == "device"]
    if serial:
        if serial not in [s for s, _ in devs]:
            sys.exit(f"device {serial} is not online: {devs}")
        return Device(serial)
    emus = [s for s, _ in devs if s.startswith("emulator-")]
    if emus:
        log(f"using running emulator {emus[0]}")
        return Device(emus[0])
    if devs:
        log(f"using attached device {devs[0][0]}")
        return Device(devs[0][0])
    return boot_emulator(window)


# --- build / install --------------------------------------------------------

def build(connected: bool) -> None:
    tasks = [":app:assembleDebug", ":fakeplayer:assembleDebug"]
    if connected:
        tasks.append(":app:assembleDebugAndroidTest")
    log("gradle " + " ".join(tasks))
    run([str(GRADLEW)] + tasks + ["-q"], capture=False, cwd=ANDROID, timeout=1800)


def install(d: Device) -> None:
    for apk in (APP_APK, FAKE_APK):
        if not apk.exists():
            sys.exit(f"missing {apk}; run without --no-build")
        log(f"installing {apk.name}")
        d.adb("install", "-r", "-g", str(apk), timeout=300)


def grant_listener(d: Device) -> None:
    # Re-bind the listener every run: an app update or a fresh install leaves it unbound.
    d.shell(f"cmd notification disallow_listener {LISTENER}", check=False)
    d.shell(f"cmd notification allow_listener {LISTENER}")
    # The secure setting mirrors the grant asynchronously.
    enabled = ""
    for _ in range(20):
        enabled = d.shell("settings get secure enabled_notification_listeners")
        if APP in enabled:
            break
        time.sleep(0.5)
    else:
        sys.exit(f"notification listener not enabled: {enabled!r}")
    d.shell(f"pm grant {APP} android.permission.POST_NOTIFICATIONS", check=False)
    d.shell(f"pm grant {FAKE} android.permission.POST_NOTIFICATIONS", check=False)


def configure(d: Device, port: int, reset: bool = True) -> None:
    d.adb("reverse", f"tcp:{port}", f"tcp:{port}")
    out = d.shell(
        f"am broadcast -W -n {DEBUG_RECEIVER} -a {APP}.DEBUG_CONFIG "
        f"--es server_url http://127.0.0.1:{port} --es token {TOKEN} --es device_name e2e "
        f"--es allowed_apps {FAKE} --ez capture_all false --ez reset {'true' if reset else 'false'}"
    )
    if "configured=true" not in out:
        sys.exit(f"debug config broadcast failed:\n{out}")


# --- mock server --------------------------------------------------------------

class Inbox:
    def __init__(self) -> None:
        self.events: list[dict] = []
        self.posts = 0
        self.bad_auth = 0
        self.lock = threading.Lock()

    def snapshot(self) -> list[dict]:
        with self.lock:
            return list(self.events)


def make_handler(inbox: Inbox):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):  # quiet
            pass

        def _json(self, code: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _authed(self) -> bool:
            if self.headers.get("Authorization") == f"Bearer {TOKEN}":
                return True
            with inbox.lock:
                inbox.bad_auth += 1
            self._json(401, {"error": "unauthorized"})
            return False

        def do_GET(self):
            if not self._authed():
                return
            if self.path.startswith("/api/actions"):
                self._json(200, {"actions": []})
            else:
                self._json(404, {"error": "not found"})

        def do_POST(self):
            if not self._authed():
                return
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            if self.path == "/api/ingest":
                evs = body.get("events", [])
                with inbox.lock:
                    inbox.events.extend(evs)
                    inbox.posts += 1
                self._json(200, {"accepted": len(evs), "ignored_app": 0, "no_identity": 0, "books_created": 0, "reads_touched": 0})
            elif self.path.startswith("/api/actions/"):
                self._json(200, {"ok": True})
            else:
                self._json(404, {"error": "not found"})

    return Handler


def start_server(port: int) -> tuple[ThreadingHTTPServer, Inbox]:
    inbox = Inbox()
    srv = ThreadingHTTPServer(("127.0.0.1", port), make_handler(inbox))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, inbox


# --- scenario ---------------------------------------------------------------

class Check:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.passed = 0

    def ok(self, cond: bool, what: str) -> None:
        if cond:
            self.passed += 1
            log(f"  ok   {what}")
        else:
            self.failures.append(what)
            log(f"  FAIL {what}")


def wait_for(inbox: Inbox, pred, timeout: float, what: str) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if pred(inbox.snapshot()):
            return True
        time.sleep(1)
    log(f"timed out waiting for {what}")
    return False


def types(evs: list[dict]) -> list[str]:
    return [e["event_type"] for e in evs]


def raw(e: dict, key: str):
    return (e.get("raw") or {}).get(f"android.media.metadata.{key}")


def scenario_basic(d: Device, inbox: Inbox, c: Check, sample: bool) -> None:
    log("scenario (audible layout): load / play / pause / chapter / seek / stop")
    fp = lambda action, **kw: d.am_start(FAKE_ACTIVITY, f"{FAKE}.{action}", **kw)  # noqa: E731
    fp("LOAD", title="The Hobbit", author="J. R. R. Tolkien", narrator="Andy Serkis", chapters=4, chapter_ms=30_000, layout="audible")
    time.sleep(2)
    fp("PLAY")
    if sample:
        log("waiting 70 s for the periodic position sample")
        time.sleep(70)
    else:
        time.sleep(3)
    fp("PAUSE")
    time.sleep(1.5)
    fp("CHAPTER", idx=2)
    time.sleep(1.5)
    fp("PLAY")
    time.sleep(2)
    fp("SEEK", position_ms=20_000)
    time.sleep(1.5)
    fp("STOP")

    wait_for(inbox, lambda evs: "stop" in types(evs), 90, "the stop event to be uploaded")
    time.sleep(3)  # stragglers
    evs = sorted(inbox.snapshot(), key=lambda e: e["occurred_at"])
    log("received: " + ", ".join(f"{e['event_type']}@ch{e.get('chapter_idx')}:{(e.get('position_ms') or 0)//1000}s" for e in evs))

    c.ok(inbox.bad_auth == 0, "every request carried the bearer token")
    c.ok(len(evs) > 0, "events arrived at /api/ingest")
    c.ok(all(e["app_package"] == FAKE for e in evs), "all events come from the fake player")
    c.ok(len({e["id"] for e in evs}) == len(evs), "event ids are unique (no double upload)")
    for t in ("metadata", "queue", "play", "pause", "position", "stop"):
        c.ok(t in types(evs), f"got a {t} event")
    ts = [e["occurred_at"] for e in evs]
    c.ok(ts == sorted(ts), "occurred_at is monotonic")

    metas = [e for e in evs if e["event_type"] == "metadata"]
    # Audible's real layout: TITLE = book, AUTHOR = ALBUM = author, ARTIST = chapter, MEDIA_ID = ASIN.
    c.ok(all(raw(e, "TITLE") == "The Hobbit" and raw(e, "AUTHOR") == "J. R. R. Tolkien" and raw(e, "ALBUM") == "J. R. R. Tolkien" for e in metas), "metadata carries book (TITLE) and author (AUTHOR/ALBUM) the Audible way")
    c.ok(all(raw(e, "DISPLAY_TITLE") is None for e in metas), "no DISPLAY_TITLE, like Audible")
    c.ok(any(raw(e, "ARTIST") == "Chapter 1" and e.get("chapter_idx") == 0 for e in metas), "first metadata is chapter 1 / idx 0 (chapter name in ARTIST)")
    c.ok(any(raw(e, "ARTIST") == "Chapter 3" and e.get("chapter_idx") == 2 for e in metas), "chapter jump produced metadata for chapter 3 / idx 2")
    c.ok(all(str(raw(e, "MEDIA_ID") or "").startswith("B0") for e in metas), "MEDIA_ID is an ASIN")
    c.ok(all(e.get("duration_ms") == 30_000 for e in metas), "duration is the chapter length")
    c.ok(all(e.get("chapter_count") == 4 for e in evs if e.get("chapter_count") is not None), "chapter_count is 4")

    queues = [e for e in evs if e["event_type"] == "queue"]
    c.ok(bool(queues) and len(queues[0].get("queue") or []) == 4, "queue event lists 4 chapters")
    c.ok(bool(queues) and [q.get("title") for q in queues[0]["queue"]] == [f"Chapter {i}" for i in range(1, 5)], "queue titles are Chapter 1..4")
    c.ok(bool(queues) and all(q.get("media_id") == raw(metas[0], "MEDIA_ID") for q in queues[0]["queue"]), "queue items carry the ASIN as media_id")

    plays = [e for e in evs if e["event_type"] == "play"]
    pauses = [e for e in evs if e["event_type"] == "pause"]
    c.ok(len(plays) == 2, f"two play events (got {len(plays)})")
    c.ok(len(pauses) == 1, f"one pause event (got {len(pauses)})")
    c.ok(all(e.get("is_playing") for e in plays) and not any(e.get("is_playing") for e in pauses), "is_playing flags match play/pause")
    c.ok(all(abs((e.get("playback_speed") or 0) - 1.0) < 0.01 for e in plays), "playback speed 1.0 while playing")
    if pauses:
        p = pauses[0].get("position_ms") or 0
        lo, hi = (69_000, 76_000) if sample else (2_000, 7_000)
        c.ok(lo <= p <= hi, f"pause position reflects listened time ({p} ms)")
        c.ok(pauses[0].get("chapter_idx") == 0, "pause happened in chapter idx 0")

    positions = [e for e in evs if e["event_type"] == "position"]
    c.ok(any(e.get("chapter_idx") == 2 and 20_000 <= (e.get("position_ms") or 0) <= 24_000 for e in positions), "seek to 20 s in chapter 3 logged as a position event")
    if sample:
        c.ok(any(e.get("is_playing") and e.get("chapter_idx") == 0 and 50_000 <= (e.get("position_ms") or 0) <= 75_000 for e in positions), "periodic 60 s sample arrived while playing")

    stops = [e for e in evs if e["event_type"] == "stop"]
    c.ok(len(stops) == 1 and stops[0].get("chapter_idx") == 2, "one stop event, in chapter idx 2")


def scenario_finish(d: Device, inbox: Inbox, c: Check) -> None:
    log("scenario: play a 2-chapter book to the end (auto chapter roll-over)")
    before = len(inbox.snapshot())
    fp = lambda action, **kw: d.am_start(FAKE_ACTIVITY, f"{FAKE}.{action}", **kw)  # noqa: E731
    fp("LOAD", title="A Short One", author="Anon", chapters=2, chapter_ms=3_000)
    time.sleep(1.5)
    fp("PLAY")
    time.sleep(9)

    wait_for(inbox, lambda evs: any(e["event_type"] == "stop" and raw(e, "TITLE") == "A Short One" for e in evs), 60, "the end-of-book stop")
    time.sleep(3)
    evs = sorted(inbox.snapshot()[before:], key=lambda e: e["occurred_at"])
    log("received: " + ", ".join(f"{e['event_type']}@ch{e.get('chapter_idx')}:{(e.get('position_ms') or 0)//1000}s" for e in evs))
    metas = [e for e in evs if e["event_type"] == "metadata" and raw(e, "TITLE") == "A Short One"]
    c.ok(any(e.get("chapter_idx") == 0 for e in metas) and any(e.get("chapter_idx") == 1 for e in metas), "metadata for both chapters (player rolled over on its own)")
    stops = [e for e in evs if e["event_type"] == "stop" and raw(e, "TITLE") == "A Short One"]
    c.ok(len(stops) == 1 and stops[0].get("chapter_idx") == 1 and (stops[0].get("position_ms") or 0) >= 2_900, "stopped at the end of the last chapter")
    c.ok(all(e.get("chapter_count") == 2 for e in evs if raw(e, "TITLE") == "A Short One" and e.get("chapter_count") is not None), "chapter_count is 2 for the second book")


def scenario_libby(d: Device, inbox: Inbox, c: Check) -> None:
    log("scenario (libby layout): absolute position, book-wide duration, no queue")
    before = len(inbox.snapshot())
    fp = lambda action, **kw: d.am_start(FAKE_ACTIVITY, f"{FAKE}.{action}", **kw)  # noqa: E731
    fp("LOAD", title="The Body", author="Bill Bryson", chapters=3, chapter_ms=10_000, layout="libby")
    time.sleep(1.5)
    fp("PLAY")
    time.sleep(2.5)
    fp("PAUSE")
    time.sleep(1.5)
    fp("CHAPTER", idx=2)
    time.sleep(1.5)
    fp("STOP")
    wait_for(inbox, lambda evs: any(e["event_type"] == "stop" and raw(e, "TITLE") == "The Body" for e in evs[before:]), 60, "the libby stop")
    time.sleep(2)
    evs = sorted([e for e in inbox.snapshot()[before:] if raw(e, "TITLE") == "The Body"], key=lambda e: e["occurred_at"])
    log("received: " + ", ".join(f"{e['event_type']}@ch{e.get('chapter_idx')}:{(e.get('position_ms') or 0)//1000}s" for e in evs))
    metas = [e for e in evs if e["event_type"] == "metadata"]
    c.ok(bool(metas) and all(raw(e, "ALBUM") == "The Body" and raw(e, "DISPLAY_TITLE") == "The Body" and raw(e, "ARTIST") == "Bill Bryson" for e in metas), "book in TITLE/ALBUM/DISPLAY_TITLE, author in ARTIST")
    c.ok(any(raw(e, "DISPLAY_SUBTITLE") == "Chapter 3" for e in metas), "chapter name in DISPLAY_SUBTITLE")
    c.ok(all(e.get("chapter_idx") is None for e in evs), "no chapter index (no queue)")
    c.ok(all(e.get("duration_ms") == 30_000 for e in evs if e.get("duration_ms") is not None), "duration is the whole book")
    c.ok(not any(e["event_type"] == "queue" for e in evs), "no queue event")
    pauses = [e for e in evs if e["event_type"] == "pause"]
    c.ok(bool(pauses) and 1_500 <= (pauses[0].get("position_ms") or 0) <= 6_000, "pause position is absolute (chapter 1)")
    stops = [e for e in evs if e["event_type"] == "stop"]
    c.ok(bool(stops) and 20_000 <= (stops[0].get("position_ms") or 0) <= 21_000, "position after jumping to chapter 3 is absolute (20 s in)")


def scenario_librofm(d: Device, inbox: Inbox, c: Check) -> None:
    log("scenario (librofm layout): per-track queue, all items titled with the book")
    before = len(inbox.snapshot())
    fp = lambda action, **kw: d.am_start(FAKE_ACTIVITY, f"{FAKE}.{action}", **kw)  # noqa: E731
    fp("LOAD", title="Guards! Guards!", author="Terry Pratchett", chapters=5, chapter_ms=20_000, layout="librofm")
    time.sleep(1.5)
    fp("CHAPTER", idx=3)
    time.sleep(1.5)
    fp("PLAY")
    time.sleep(2)
    fp("STOP")
    wait_for(inbox, lambda evs: any(e["event_type"] == "stop" and raw(e, "TITLE") == "Guards! Guards!" for e in evs[before:]), 60, "the librofm stop")
    time.sleep(2)
    evs = [e for e in inbox.snapshot()[before:] if raw(e, "TITLE") == "Guards! Guards!"]
    log("received: " + ", ".join(f"{e['event_type']}@ch{e.get('chapter_idx')}:{(e.get('position_ms') or 0)//1000}s" for e in evs))
    queues = [e for e in evs if e["event_type"] == "queue"]
    c.ok(bool(queues) and len(queues[0]["queue"]) == 5 and all(q.get("title") == "Guards! Guards!" for q in queues[0]["queue"]), "queue of 5 tracks all titled with the book")
    c.ok(bool(queues) and len({q.get("media_id") for q in queues[0]["queue"]}) == 5, "each track has its own media_id")
    stops = [e for e in evs if e["event_type"] == "stop"]
    c.ok(bool(stops) and stops[0].get("chapter_idx") == 3 and stops[0].get("chapter_count") == 5, "chapter idx 3 of 5 from the active queue item")
    c.ok(bool(stops) and raw(stops[0], "MEDIA_ID") == (queues[0]["queue"][3].get("media_id") if queues else None), "MEDIA_ID is the current track's id")
    c.ok(all(e.get("duration_ms") == 20_000 for e in evs if e.get("duration_ms") is not None), "duration is the track length")


def scenario_release(d: Device, inbox: Inbox, c: Check) -> None:
    log("scenario: session destroyed while playing")
    before = len(inbox.snapshot())
    fp = lambda action, **kw: d.am_start(FAKE_ACTIVITY, f"{FAKE}.{action}", **kw)  # noqa: E731
    fp("LOAD", title="Gone", author="Anon", chapters=3, chapter_ms=60_000)
    time.sleep(1.5)
    fp("PLAY")
    time.sleep(2)
    fp("RELEASE")
    wait_for(inbox, lambda evs: any(e["event_type"] == "stop" and raw(e, "TITLE") == "Gone" for e in evs[before:]), 60, "the stop emitted on session destroy")
    time.sleep(2)
    evs = inbox.snapshot()[before:]
    c.ok(any(e["event_type"] == "stop" and raw(e, "TITLE") == "Gone" for e in evs), "session release while playing produced a stop event")


def diagnostics(d: Device) -> None:
    log("--- logcat (MediaListener / FakePlayer / DebugConfig / crashes) ---")
    print(d.shell("logcat -d -s MediaListener:* FakePlayer:* DebugConfig:* AndroidRuntime:E WM-WorkerWrapper:* | tail -n 80", check=False))
    log("--- media sessions ---")
    print(d.shell("dumpsys media_session | head -n 40", check=False))


# --- main ---------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--serial", help="adb serial of a device/emulator to use")
    ap.add_argument("--window", action="store_true", help="show the emulator window")
    ap.add_argument("--no-build", action="store_true", help="skip gradle, use existing APKs")
    ap.add_argument("--connected", action="store_true", help="also run connectedDebugAndroidTest")
    ap.add_argument("--sample", action="store_true", help="wait for the 60 s periodic position sample (adds ~70 s)")
    ap.add_argument("--skip-e2e", action="store_true", help="only build/install/connected tests, no scenarios")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--kill", action="store_true", help="shut down the emulator afterwards")
    args = ap.parse_args()

    ensure_java_home()
    for p in (ADB, EMULATOR):
        if not p.exists():
            sys.exit(f"missing {p}; is ANDROID_HOME right? ({SDK})")

    if not args.no_build:
        build(args.connected)
    d = ensure_device(args.serial, args.window)

    rc = 0
    if args.connected:
        # First: the gradle task installs the app + test APKs and uninstalls both when done.
        log("gradle :app:connectedDebugAndroidTest")
        r = run([str(GRADLEW), ":app:connectedDebugAndroidTest", "-q"], check=False, capture=False, cwd=ANDROID, timeout=1800,
                env={**os.environ, "ANDROID_SERIAL": d.serial or ""})
        if r.returncode != 0:
            log("connected tests FAILED (see app/build/reports/androidTests/connected/)")
            rc = 1
        else:
            log("connected tests passed")

    install(d)

    if not args.skip_e2e:
        srv, inbox = start_server(args.port)
        try:
            d.shell("logcat -c", check=False)
            d.shell(f"am force-stop {FAKE}", check=False)
            configure(d, args.port)
            grant_listener(d)  # after configure: the listener's initial snapshot must survive the reset
            time.sleep(1)
            c = Check()
            scenario_basic(d, inbox, c, args.sample)
            scenario_finish(d, inbox, c)
            scenario_libby(d, inbox, c)
            scenario_librofm(d, inbox, c)
            scenario_release(d, inbox, c)
            d.shell(f"am force-stop {FAKE}", check=False)
            log(f"{c.passed} checks passed, {len(c.failures)} failed; {inbox.posts} ingest POSTs")
            if c.failures:
                for f in c.failures:
                    log(f"  FAILED: {f}")
                diagnostics(d)
                rc = 1
        finally:
            srv.shutdown()
            d.adb("reverse", "--remove", f"tcp:{args.port}", check=False)

    if args.skip_e2e:
        grant_listener(d)

    if args.kill and d.serial and d.serial.startswith("emulator-"):
        d.adb("emu", "kill", check=False)
    return rc


if __name__ == "__main__":
    sys.exit(main())
