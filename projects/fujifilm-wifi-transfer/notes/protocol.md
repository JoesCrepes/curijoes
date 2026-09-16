# Protocol notes

Keep confirmed observations and assumptions clearly separated. Update this
after every capture.

## Assumptions (unverified)

- Transport is PTP/IP (ISO 15740 Annex D), TCP port 15740, same as
  libgphoto2's `ptpip` camlib uses for tethered Fuji/Canon/Nikon bodies over
  wifi.
- Discovery (the app "finding" the camera before opening the PTP/IP session)
  is a custom step on top of / before PTP/IP, since standard PTP/IP assumes
  you already know the host to connect to.
- File listing and download use standard PTP operations (GetObjectHandles,
  GetObjectInfo, GetObject, GetThumb) with Fuji vendor-specific op codes
  layered in for anything RAW/proprietary.

## Confirmed (fill in from capture)

- Camera AP SSID / security type:
- Phone's IP once associated:
- Camera's IP once associated:
- Discovery mechanism observed:
- Port(s) actually used:
- PTP/IP container types observed (INIT_COMMAND_REQUEST, OpenSession, etc.):
- Any vendor-specific opcodes observed:

## Reference: standard PTP/IP container types

For cross-checking against `analyze_pcap.py` output. These are the generic
PTP/IP packet types (as used by libgphoto2/libptp2), not Fuji-specific:

| Value | Name                     |
|-------|--------------------------|
| 1     | INIT_COMMAND_REQUEST     |
| 2     | INIT_COMMAND_ACK         |
| 3     | INIT_EVENT_REQUEST       |
| 4     | INIT_EVENT_ACK           |
| 5     | INIT_FAIL                |
| 6     | CMD_REQUEST              |
| 7     | CMD_RESPONSE             |
| 8     | EVENT                    |
| 9     | START_DATA_PACKET        |
| 10    | DATA_PACKET              |
| 11    | CANCEL_TRANSACTION       |
| 12    | END_DATA_PACKET          |
| 13    | PROBE_REQUEST (ping)     |
| 14    | PROBE_RESPONSE (pong)    |

## Connection-failure investigation log

- SSID confirmed: `FUJIFILM-X-T10-1EB1`.
- Joining that SSID directly from Android's system wifi settings (bypassing
  the app entirely) produces a connection error on the phone **and hard
  crashes the camera** (requires battery pull to recover).
- Critically: **failing to connect via the Fujifilm app does not crash the
  camera.** Only the direct OS-level join does. This means the app is doing
  something different from a plain wifi association/DHCP negotiation —
  either avoiding a step that trips up the camera's embedded network stack,
  or handling the failure more gracefully on its own end. This is the
  strongest lead so far on the actual bug and worth chasing before anything
  else (via `adb logcat` on wifi/DHCP tags during a manual join attempt, and
  by testing whether a laptop joining the same SSID also crashes the camera
  — see `notes/TROUBLESHOOTING.md`).
- Confirmed empirically that PCAPdroid (VPN-based capture) cannot see any of
  this: three separate captures during failed connection attempts contained
  zero camera-related traffic, because the wifi join never got far enough to
  get an IP/become an active route for the VPN tunnel to ride on. See the
  "known limitation" note in `capture/CAPTURE_GUIDE.md`.

## Open questions

- Does the X-T10 support "infrastructure mode" (camera joins your home wifi)
  or is it AP-only? Affects whether a laptop can join directly instead of
  needing a capture step at all.
- Is there a pairing/token exchange, or does the camera trust any client
  that's associated to its wifi?
- Does RAW download go through the same PTP GetObject path as JPEG, or a
  separate mechanism?
