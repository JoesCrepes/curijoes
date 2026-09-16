# Fujifilm X-T10 Wifi Transfer — Reverse Engineering

The official "FUJIFILM Camera Remote" Android app is bad. The X-T10 talks to
it over the camera's own wifi access point (no Bluetooth involved), and the
underlying transport is almost certainly **PTP/IP** (ISO 15740 over TCP port
15740) — the same protocol libgphoto2 already speaks to a lot of Fuji, Canon,
and Nikon bodies. The goal here is a minimal replacement client (list photos,
pull JPEGs/RAWs, maybe trigger a shutter) without the official app.

## Status

Nothing confirmed against real hardware yet. This is a scaffold to capture
against once we're back near the camera:

- [ ] Confirm the camera's AP details (SSID/security) and whether it's a pure
      AP or also supports "join an existing network" mode.
- [ ] Capture a phone <-> camera session during a real transfer.
- [ ] Confirm transport is PTP/IP on 15740 (vs. Fuji's older/newer proprietary
      HTTP-ish protocol some models use — this varies by generation).
- [ ] Map the discovery/pairing handshake (this is the part unlikely to be
      standard PTP/IP; the app has to find the camera before the PTP/IP
      session opens).
- [ ] Map any Fuji vendor-specific PTP op codes for RAW pull / thumbnails.
- [ ] Working minimal client: enumerate + download objects.

## Layout

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
