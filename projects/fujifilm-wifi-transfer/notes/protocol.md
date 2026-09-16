# Protocol notes

Keep confirmed observations and assumptions clearly separated. Update this
after every capture.

## Prior art found (this saved us from re-deriving all of this blind)

Once we confirmed a wifi association could actually succeed (see the
Windows laptop breakthrough below), a search turned up existing
reverse-engineering work on exactly this protocol:

- [malc0mn/ptp-ip](https://github.com/malc0mn/ptp-ip) — Go implementation of
  PTP/IP with a **working Fuji X-T1 implementation**. This is the most
  useful source found: confirms Fuji's actual port numbers and vendor
  opcodes (see Confirmed section below).
- [grw1983/fuji-cam-wifi-tool](https://github.com/grw1983/fuji-cam-wifi-tool)
  and forks (hkr, mzealey) — reverse-engineered wifi remote control for Fuji
  X-series (shutter, ISO, aperture, white balance, streaming).
- [petabyt/fudge-legacy-android](https://github.com/petabyt/fudge-legacy-android)
  — has `lib/fuji.c`, another independent implementation.
- [fujihack/fujihack](https://github.com/fujihack/fujihack) — firmware-level
  RE (PTP/USB debugger patch), less relevant to the wifi transport itself
  but confirms an active RE community around these cameras.

Worth reading `malc0mn/ptp-ip`'s Fuji-specific source directly before
extending our own client further — no need to re-derive what's already
documented there.

## Assumptions (superseded — see Confirmed below)

- ~~Transport is PTP/IP (ISO 15740 Annex D), TCP port 15740~~ — **wrong**,
  see Confirmed.
- Discovery (the app "finding" the camera before opening the PTP/IP session)
  is a custom step on top of / before PTP/IP, since standard PTP/IP assumes
  you already know the host to connect to. Still unconfirmed — camera showed
  "please check the app and select the function again" even after a clean
  wifi association, meaning some app-level step still needs to happen before
  the camera opens any service.
- File listing and download use standard PTP operations (GetObjectHandles,
  GetObjectInfo, GetObject, GetThumb) with Fuji vendor-specific op codes
  layered in for anything RAW/proprietary. Still unconfirmed.

## Confirmed

- Camera AP SSID: `FUJIFILM-X-T10-1EB1`, open/no-password.
- Camera's IP once associated: `192.168.0.1` (also acts as DHCP server and
  default gateway).
- **Port(s): Fuji does NOT use standard PTP/IP's 15740.** Per malc0mn/ptp-ip:
  - `55740` — command/data connection (this is what our INIT handshake
    targets)
  - `55741` — event connection
  - `55742` — streamer/live view connection
  - Our first `diagnose.py` run scanned only 15740 and got nothing — that
    was scanning the wrong port entirely, not a sign the camera wasn't
    listening. `ptpip/client.py` and `diagnose.py` are now updated to use
    55740 by default.
- Vendor-specific opcodes (from malc0mn/ptp-ip): `0x902B` (Fuji-specific
  operation), `0xD212` (Fuji-specific property). Not yet exercised against
  our own camera.
- Init handshake still uses standard PTP/IP framing: GUID + friendly name,
  which is what `ptpip/client.py`'s `INIT_COMMAND_REQUEST` already builds.
- Discovery mechanism observed: still open — see below.

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

### adb logcat findings: two independent, stacked bugs

**Bug 1 — camera-side, confirmed via direct OS-level join (`adb shell cmd
wifi connect-network "FUJIFILM-X-T10-1EB1" open`, and via Settings UI).**
Every attempt fails identically:
```
WifiClientModeImpl: L2ConnectingState: Association rejection ssid:
"FUJIFILM-X-T10-1EB1" bssid: 00:c0:2d:b7:a0:c0 statusCode: 1 timedOut: true
```
Status code 1 = 802.11 "unspecified failure", rejected at the **association**
step — before authentication, before DHCP, before anything protocol-level.
This happens on every attempt, with a real BSSID from the first try onward,
so it's a real, consistent AP-side rejection, not a fluke. Best-supported
theory: the X-T10's decade-old embedded wifi stack can't parse the richer
association request frames modern phones send (HE/VHT capability elements,
extended capabilities bits, etc.) and either rejects outright or corrupts
state badly enough to hard-crash (matches Fujifilm's own countermeasure,
which patched *supported* cameras' network stacks for exactly this; the
X-T10 doesn't get it due to hardware limits). The `adb shell cmd wifi
connect-network` debug command goes through this same system-level connect
path (same crash) — it is not a usable workaround.

**Bug 2 — Android-side, confirmed via logcat capture of the app's own
attempt.** The app uses `ConnectivityManager.requestNetwork()` with a
`WifiNetworkSpecifier` using a **prefix pattern** match (`PatternMatcher{
PREFIX: FUJIFILM-}`), not a plain wifi join and not an exact-SSID specifier.
This is why app-initiated failures never crash the camera: the request dies
inside Android's own plumbing before any frame is ever sent to the camera.
Sequence observed:
```
WifiNetworkFactory: got request NetworkRequest [ ... Specifier: <WifiNetworkSpecifier [, SSID Match pattern=PatternMatcher{PREFIX: FUJIFILM-}, ...] Uid: 10511 RequestorPkg: com.fujifilm_dsc.app.remoteshooter ]
WifiNetworkFactory: ActiveRequest not for single access point or network.
[NetworkRequestDialogActivity launches]
WifiNetworkFactory: No callback registered for sending network request matches. Ignoring...
[~1s later, dialog finishes on its own]
WifiNetworkFactory: User dismissed notification, cancelling NetworkRequest [...]
```
No `WifiClientModeImpl`/`wpa_supplicant` activity follows — no association
is ever attempted. This looks like a genuine Android regression/race in
`WifiNetworkFactory`'s handling of *pattern-based* specifier requests
specifically (the log explicitly branches on "not for single access point
or network"), separate from Bug 1.

**App package/component names learned along the way** (useful for future
PCAPdroid scoping or adb filtering):
- App package: `com.fujifilm_dsc.app.remoteshooter` (not `com.fujifilm.xapp`
  — that's a different, unrelated Fujifilm app also installed on this
  phone).
- Wifi handoff happens via `com.fujifilm_dsc.app.remoteshooter.WiFiHandOverService`
  / `CommonWiFiHandOverVM`.

**Exact-SSID test result (via `android-wifi-test/`): confirmed and closed.**
An exact-SSID `WifiNetworkSpecifier` (`PatternMatcher{LITERAL: ...}` instead
of `PREFIX`) does skip Bug 2 entirely — no dialog, straight to
`WifiNetworkFactory: User initiated connect to network`. But it then hits
Bug 1 on every one of Android's 4 automatic retry attempts:
```
WifiClientModeImpl: L2ConnectingState: Association rejection ssid:
"FUJIFILM-X-T10-1EB1" bssid: 00:c0:2d:b7:a0:c0 statusCode: 1
```
(x4 over ~9s, then `WifiNetworkFactory: Connection failures, cancelling` /
`onUnavailable`.) Same BSSID, same status code, same camera crash as the
direct OS-level join. **Conclusion: this is a hard, camera-firmware-level
wall.** The camera's embedded wifi stack cannot complete an 802.11
association with this phone's radio regardless of which Android API
triggers the join — it is not an app bug or an Android specifier-matching
bug (that one, Bug 2, is real but separate and now confirmed bypassable).
No client-side software trick observed so far routes around it.

**Breakthrough: a Windows laptop (Intel Dual Band Wireless-AC 8275 — no
802.11ax/Wifi6+, i.e. an older/simpler radio and driver stack than the
Pixel) joined `FUJIFILM-X-T10-1EB1` cleanly, no crash.** This confirms the
theory from the "remaining options" list below: the camera's 802.11
association crash is specific to what the *client's* radio/driver sends,
not universal. Got a valid DHCP lease (`192.168.33.2`, gateway/DHCP server
`192.168.0.1`), camera did not lock up.

However: the camera's own screen showed "please check the app and select
the function again" — a plain wifi association is not sufficient on its own.
A first `diagnose.py 192.168.0.1` scan (of port 15740 only, before we found
the port info above) came back with everything closed — **expected now
that we know Fuji uses 55740, not 15740.** Next step is re-running
`diagnose.py`/`ptpip/client.py` against the correct port, and separately
figuring out what "select the function again" is asking for — likely some
discovery/pairing step the camera expects before it opens 55740 at all.

**Next steps, in order:**
1. Re-run `python diagnose.py 192.168.0.1` now that it checks 55740 first —
   see whether the port is actually open once associated.
2. If 55740 is open, try the INIT handshake (`ptpip/client.py`) directly —
   our GUID+friendly-name framing already matches what malc0mn/ptp-ip uses.
3. If closed, the camera really is gating it behind selecting a mode/function
   on its own screen (per the "select the function again" message) — read
   through malc0mn/ptp-ip's and fuji-cam-wifi-tool's source for what they do
   differently before a session opens (a specific UDP probe, a particular
   camera-menu precondition, etc.) rather than re-deriving it via capture.

**Deprioritized (only revisit if the above stalls):**
- USB cable / SD card transfer — Fujifilm's own documented fallback, still
  the fastest guaranteed path for actually getting photos off today.
- Monitor-mode capture of the association frame — no longer needed for
  *this* radio (it doesn't crash), but could still help if 55740 stays
  closed and prior-art source reading doesn't explain why.

## Open questions

- Does the X-T10 support "infrastructure mode" (camera joins your home wifi)
  or is it AP-only? Affects whether a laptop can join directly instead of
  needing a capture step at all.
- Is there a pairing/token exchange, or does the camera trust any client
  that's associated to its wifi?
- Does RAW download go through the same PTP GetObject path as JPEG, or a
  separate mechanism?
