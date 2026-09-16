# Fujifilm X-T10 Wifi Transfer — Reverse Engineering

The official "FUJIFILM Camera Remote" Android app is bad. The X-T10 talks to
it over the camera's own wifi access point (no Bluetooth involved), and the
underlying transport is almost certainly **PTP/IP** (ISO 15740 over TCP port
15740) — the same protocol libgphoto2 already speaks to a lot of Fuji, Canon,
and Nikon bodies. The goal here is a minimal replacement client (list photos,
pull JPEGs/RAWs, maybe trigger a shutter) without the official app.

## Status

Turns out just *connecting* to the camera is its own project — see
`notes/protocol.md` for the full investigation log. Short version: this is
Fujifilm's own documented "Camera Remote connection failure" bug
(unfixed on the X-T10), and it's actually two independent, stacked bugs:

1. **Camera-side:** the X-T10's AP rejects modern phones' 802.11
   association requests outright (status code 1), sometimes hard-crashing
   the camera. Confirmed via `adb logcat` during a direct OS-level wifi
   join.
2. **Android-side:** the app itself uses a `WifiNetworkSpecifier` with a
   *prefix pattern* SSID match, and that request dies inside Android's
   `WifiNetworkFactory` before ever reaching the camera (a separate,
   Android-platform bug). Confirmed via `adb logcat` during the app's own
   connection attempt. `android-wifi-test/` is a minimal test app built to
   check whether an *exact*-SSID specifier avoids this and actually reaches
   association.

Original protocol-mapping goals, once/if a connection actually works:

- [ ] Capture a phone <-> camera session during a real transfer.
- [ ] Confirm transport is PTP/IP on 15740 (vs. Fuji's older/newer proprietary
      HTTP-ish protocol some models use — this varies by generation).
- [ ] Map the discovery/pairing handshake (this is the part unlikely to be
      standard PTP/IP; the app has to find the camera before the PTP/IP
      session opens).
- [ ] Map any Fuji vendor-specific PTP op codes for RAW pull / thumbnails.
- [ ] Working minimal client: enumerate + download objects.

## Can't even get the app to connect?

Start with `notes/TROUBLESHOOTING.md` before assuming it's a protocol
problem — a no-internet AP getting dropped by Android's network switching is
by far the most common cause of "this used to work and now doesn't."
`diagnose.py` checks camera reachability and PTP/IP directly from a laptop,
no packet capture required.

## Layout

- `android-wifi-test/` — minimal Android app testing the exact-SSID
  `WifiNetworkSpecifier` hypothesis (see Status above). Real, buildable
  Gradle project with a generated wrapper; see its own README for
  build/run steps.
- `notes/TROUBLESHOOTING.md` — checklist for "app won't connect at all"
  before digging into protocol-level stuff.
- `diagnose.py` — network-layer connectivity/PTP-IP check against the
  camera's IP, runnable from a laptop on the camera's wifi, no capture
  needed.
- `capture/CAPTURE_GUIDE.md` — how to record a pcap of the app talking to the
  camera, written for a hotel-room setup (no special wifi hardware assumed).
- `notes/protocol.md` — living notes on what we actually observe, kept
  separate from assumptions so we don't confuse the two.
- `analyze_pcap.py` — loads a capture, filters to the interesting traffic,
  and prints decoded PTP/IP containers so packets don't have to be read by
  hand in Wireshark.
- `ptpip/container.py` — framing (de)serializer for standard PTP/IP
  containers, per the spec used by libgphoto2/libptp2.
- `ptpip/client.py` — minimal PTP/IP client skeleton (init handshake +
  OpenSession) to test directly against the camera, independent of whatever
  the capture shows for discovery.

## Setup

```
cd projects/fujifilm-wifi-transfer
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Next step

Do the capture per `capture/CAPTURE_GUIDE.md`, then:

```
python analyze_pcap.py path/to/capture.pcapng
```
