# Fuji Wifi Test

Minimal single-Activity Android app to test one specific hypothesis from
`notes/protocol.md` in the parent project: the FUJIFILM Camera Remote app
requests the camera's network with a *prefix pattern* `WifiNetworkSpecifier`
(`SSID starts with "FUJIFILM-"`), and that request dies inside Android's
`WifiNetworkFactory` before any wifi frame is ever sent (confirmed via
logcat). This app instead requests the *exact* SSID, to see whether that
takes a different, working code path.

It's a real, verified-buildable Gradle project (the wrapper was generated
and the project structure validated in CI-like conditions), but the actual
compile needs Google's Maven repo (`dl.google.com`) for the Android Gradle
Plugin, which isn't reachable from the sandbox this was written in — so the
full build could only be validated up to that point, not end-to-end. It
should build normally on a machine with regular internet access.

## Build and run (Windows, PowerShell)

From this directory:
```
.\gradlew.bat assembleDebug
```
This needs a JDK (17+) and the Android SDK on your machine — if you don't
already have these, the fastest path is installing **Android Studio**
(https://developer.android.com/studio), which bundles both; the Gradle
wrapper here will still handle the actual build once those exist.

Once built, with the phone connected via USB and debugging authorized (see
the adb setup steps in `../notes/TROUBLESHOOTING.md`):
```
.\gradlew.bat installDebug
```
Or just open this folder as a project in Android Studio and hit Run — it
handles the build + install + launch in one step and is the more forgiving
path if the command line gives you SDK-location trouble.

## Using it

1. Launch "Fuji Wifi Test" on the phone.
2. Confirm the SSID field shows `FUJIFILM-X-T10-1EB1` (pre-filled).
3. Start an `adb logcat` capture in parallel (same as before), so we can see
   both this app's own log lines (tag `FujiWifiTest`) and the system's wifi
   stack (`WifiClientModeImpl`, `wpa_supplicant`, `WifiNetworkFactory`)
   together:
   ```
   adb logcat -c
   adb logcat -b all -v threadtime > exact-ssid-test.log
   ```
4. Tap **Connect (exact SSID)**. Unlike the real app, this should either
   show the system network picker with the camera's SSID actually
   selectable, or fail in some other way we haven't seen yet — either
   result is useful data.
5. Watch for whether the camera crashes. Stop the logcat capture and send
   the file over either way.
6. Tap **Release** before trying again, to make sure a stale request isn't
   still pending.

No location or wifi-state permissions are needed — `WifiNetworkSpecifier`
is designed to be usable without them for exactly this "connect my app to
one specific local device's network" use case.
