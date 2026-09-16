# "Can't connect at all" — before blaming the protocol

If this used to work and now doesn't, the most likely culprit is Android
itself getting more aggressive about wifi-with-no-internet over the years,
not anything wrong with the camera or a protocol change. Camera APs have no
internet uplink by definition, and every Android version since ~9 has
gotten pushier about auto-abandoning networks like that. Work through this
list before assuming it's a deep protocol issue.

## Quick checks (no tools needed)

1. **Confirm the camera's AP is actually up first.** On the X-T10 this means
   you explicitly entered wireless communication mode (via the wifi
   button/icon on playback, not just "the camera is on"). Check your phone's
   system wifi list — is the camera's SSID even visible? If not, this is a
   camera-menu issue, not a networking one.
2. **Turn off mobile data** while connecting, or at minimum disable
   "Switch to mobile data automatically" / "Adaptive connectivity" /
   "Smart network switch" (naming varies by Android skin: Settings > Network
   & internet > Wi-Fi > Wi-Fi preferences). Android will silently drop a
   no-internet wifi network in favor of cellular if this is on — this is the
   single most common cause of "it randomly stopped working."
3. **If prompted "This network has no internet access, stay connected?"**
   — say yes explicitly. On some versions this dialog times out and
   auto-answers "no" if you're slow.
4. **Disable per-network MAC randomization** for the camera's SSID (tap the
   SSID in wifi settings > network details > Privacy > use device MAC
   instead of randomized). Some cameras allow-list or otherwise get confused
   by a MAC that changes every association.
5. **Turn off Private DNS** (Settings > Network & internet > Private DNS)
   temporarily. Some Private DNS configs cause the OS to mark a
   no-DNS-server network as unusable and refuse to route app traffic to it
   even once associated.
6. **Check app permissions**: Location (needed for wifi APIs pre-Android 13)
   and, on Android 12+, "Nearby devices" / local network access. If the app
   was installed years ago and permissions changed under it, a previously
   granted permission can end up revoked on OS upgrade.
7. **Try associating manually first**: connect to the camera's SSID from
   Android's own wifi settings (not through the app), confirm it says
   "Connected, no internet" and stays connected for 30+ seconds without
   dropping. If system wifi itself can't hold the connection, the app has no
   chance — this isolates OS/radio vs. app.

## Lightweight diagnostics (still no packet capture needed)

If plain association works but the app still fails, `diagnose.py` in this
project checks the network layer directly — run it from a laptop joined to
the camera's wifi (most camera APs allow a second simultaneous client; if
yours doesn't, you'll need to disconnect the phone first, which still tells
you something if it changes the result):

```
python diagnose.py <camera-ip>
```

It checks: can we reach the gateway, is TCP 15740 (PTP/IP) open, are any
other common ports open (80/8080 for a possible config page, 5353 for
mDNS), and whether a raw PTP/IP INIT handshake succeeds. If PTP/IP responds
cleanly from a laptop but the app still won't connect, that strongly points
at something Android-side blocking *the app specifically* (permissions,
network security config, a stale pairing token cached by the app) rather
than the camera or protocol.

## Cheap alternative to a full packet capture: `adb logcat`

If you have a USB cable and can enable USB debugging (Settings > About
phone > tap Build number x7, then Settings > Developer options > USB
debugging) — no root required — you can watch the app's own error output
live:

```
adb logcat | grep -i fuji
```

Attempt a connection while this runs. Stack traces / exceptions here often
say exactly where it's failing (a `SocketTimeoutException` means it never
got initial reply — network problem; a specific PTP error code means it got
further than expected — good sign for a future replacement client). This is
much lower effort than a full pcap and worth doing even in addition to one.
