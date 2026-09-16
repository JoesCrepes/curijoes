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

**Remaining options, roughly in order of practicality:**
1. Accept Fujifilm's own documented fallback for unsupported cameras: USB
   cable transfer, or pull the SD card with a reader. Boring but guaranteed.
2. Try pairing with a phone from roughly the X-T10's own era (~2015-2018).
   Untested theory: an older device's association request frame is simpler
   and might not trigger whatever the camera's fragile 802.11 parser chokes
   on. Cheap to try if an old phone is available.
3. Monitor-mode capture of the actual association request frame bytes
   (see `capture/CAPTURE_GUIDE.md` Option B) to identify the exact
   information element triggering the rejection. Now a much more targeted
   capture than earlier attempts (we know precisely when it happens), but
   this only satisfies curiosity at this point — even knowing the exact IE,
   there's no way to patch the camera's firmware to tolerate it.

## Open questions

- Does the X-T10 support "infrastructure mode" (camera joins your home wifi)
  or is it AP-only? Affects whether a laptop can join directly instead of
  needing a capture step at all.
- Is there a pairing/token exchange, or does the camera trust any client
  that's associated to its wifi?
- Does RAW download go through the same PTP GetObject path as JPEG, or a
  separate mechanism?
