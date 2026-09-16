# Capturing a transfer session

You need a pcap of the Fujifilm app talking to the X-T10 over the camera's
wifi AP. Two ways to get it, easiest first.

## Option A: on-phone capture, no root, no extra hardware (recommended)

The camera's AP is unencrypted-or-PSK, but that doesn't matter here because
we're not trying to eavesdrop on someone else's traffic — it's your own
phone's own traffic, so a local VPN-based capture app can see it in plaintext
before any wifi-layer encryption is even relevant.

1. Install **PCAPdroid** (F-Droid or Play Store) on the Android phone that
   runs the Fujifilm app. No root required.
2. In PCAPdroid, start a capture filtered to just the Fujifilm app's package
   (something like `com.fujifilm.fcamera` — check the exact package name in
   the phone's app info screen).
3. Connect the phone to the camera's wifi network as usual, open the
   Fujifilm app, and do a full session: browse thumbnails, download a couple
   of JPEGs, maybe try a RAW if the app supports it, then disconnect.
4. Stop the capture and export the `.pcap` (PCAPdroid has a share/export
   button). Get it off the phone (email to yourself, save to Drive, USB,
   whatever's easiest from the hotel).

This captures the app's traffic before it hits the wifi radio, so no
decryption step is needed regardless of what security the camera's AP uses.

### Known limitation: Option A can't see a failed connection

**PCAPdroid (and any Android VPN-based capture) only sees traffic on
interfaces that already have a working IP and are an active route.** If the
wifi join to the camera fails before DHCP completes — which is exactly
what's happening with the X-T10 connection-failure bug — there is nothing
for PCAPdroid to capture. You'll just get whatever background traffic was
flowing over cellular/another wifi at the time, which looks like real data
but is a dead end. Confirmed empirically: multiple Option A captures during
a failed connection contained zero camera-related traffic, only unrelated
app chatter (Play services, Spotify, WeChat, etc.) over the network that
actually stayed connected the whole time.

If the connection is currently **failing** rather than working, Option A is
the wrong tool — go straight to `adb logcat` (see
`notes/TROUBLESHOOTING.md`) or Option B below, since both operate at or
below the layer where the failure happens. Option A is still the right
choice once you have a *working* connection and want to capture the actual
transfer protocol.

## Option B: monitor-mode capture (fallback, needs extra hardware)

Do this if the connection is failing before an IP is even assigned (Option
A can't see this — see above), or if Option A doesn't work for some other
reason (e.g. the app detects and blocks the VPN service).

1. You need a wifi adapter capable of monitor mode on a laptop (built-in
   Intel/Broadcom cards on Linux often work; a small USB adapter like an
   Alfa AWUS036 is a safe bet if not).
2. Note the camera's AP channel and security (check camera wifi settings
   menu). If it's WPA2-PSK, note the passphrase too — Wireshark can decrypt
   with it later (Edit > Preferences > Protocols > IEEE 802.11 > add
   decryption key).
3. Put the adapter in monitor mode on that channel:
   `sudo airmon-ng start wlan0 <channel>` (or `iw dev wlan0 set monitor
   control` depending on distro/driver).
4. Capture with Wireshark or `tcpdump -i wlan0mon -w capture.pcapng`.
5. Do the same transfer session as in Option A while capturing.
6. If encrypted, add the decryption key in Wireshark before analyzing so it
   shows decoded IP/TCP frames instead of raw 802.11 data frames.

## What to look for once you have the pcap

- Any UDP broadcast/multicast traffic right when the app "finds" the camera
  — this is the discovery step and is probably not standard PTP/IP.
- A TCP connection to port **15740** — this would confirm PTP/IP as the
  transport for the actual file listing/transfer.
- If there's no 15740 traffic at all, note whatever port(s) *are* used
  instead (older/some Fuji models use a proprietary protocol over HTTP or a
  different fixed port) and update `notes/protocol.md`.

Drop the pcap path and I'll run `analyze_pcap.py` against it.
