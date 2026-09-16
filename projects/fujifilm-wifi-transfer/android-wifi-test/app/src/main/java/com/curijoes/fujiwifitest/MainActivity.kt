package com.curijoes.fujiwifitest

import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiNetworkSpecifier
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

private const val TAG = "FujiWifiTest"

/**
 * Minimal test harness for the exact-SSID WifiNetworkSpecifier hypothesis.
 *
 * The FUJIFILM Camera Remote app requests the camera's network with a
 * *prefix pattern* specifier (SSID starting with "FUJIFILM-"), and that
 * request dies inside Android's WifiNetworkFactory before any wifi frame
 * is ever sent (see notes/protocol.md in the parent project). This app
 * instead requests the *exact* SSID to see whether that takes a different,
 * working code path through to actual association.
 *
 * Watch this app's own log output here AND `adb logcat` at the same time -
 * we want to see both what this API reports back to us and what the
 * system's WifiClientModeImpl/wpa_supplicant actually do on the wire.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var connectivityManager: ConnectivityManager
    private lateinit var logView: TextView
    private lateinit var scrollView: ScrollView
    private var currentCallback: ConnectivityManager.NetworkCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        connectivityManager = getSystemService(ConnectivityManager::class.java)
        logView = findViewById(R.id.logView)
        scrollView = findViewById(R.id.scrollView)
        val ssidInput = findViewById<EditText>(R.id.ssidInput)
        ssidInput.setText("FUJIFILM-X-T10-1EB1")

        findViewById<Button>(R.id.connectButton).setOnClickListener {
            connect(ssidInput.text.toString())
        }
        findViewById<Button>(R.id.releaseButton).setOnClickListener {
            releaseRequest()
        }

        log("Ready. Confirm the SSID above, then tap Connect.")
    }

    private fun connect(ssid: String) {
        releaseRequest()
        log("Requesting exact-SSID network: \"$ssid\"")

        // Exact SSID match, as opposed to the app's PatternMatcher(PREFIX: ...)
        // approach - this is the thing we're actually testing.
        val specifier = WifiNetworkSpecifier.Builder()
            .setSsid(ssid)
            .build()

        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .setNetworkSpecifier(specifier)
            .build()

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                log("onAvailable: $network")
            }

            override fun onUnavailable() {
                log("onUnavailable (request could not be satisfied)")
            }

            override fun onLosing(network: Network, maxMsBeforeLost: Int) {
                log("onLosing: $network in ${maxMsBeforeLost}ms")
            }

            override fun onLost(network: Network) {
                log("onLost: $network")
            }

            override fun onCapabilitiesChanged(
                network: Network,
                capabilities: NetworkCapabilities
            ) {
                log("onCapabilitiesChanged: $capabilities")
            }
        }
        currentCallback = callback

        connectivityManager.requestNetwork(request, callback)
        log("requestNetwork() called - watch for the system network picker,")
        log("and watch adb logcat for WifiClientModeImpl/wpa_supplicant lines.")
    }

    private fun releaseRequest() {
        currentCallback?.let {
            connectivityManager.unregisterNetworkCallback(it)
            log("Released previous request.")
        }
        currentCallback = null
    }

    private fun log(message: String) {
        Log.d(TAG, message)
        runOnUiThread {
            logView.append("$message\n")
            scrollView.post { scrollView.fullScroll(View.FOCUS_DOWN) }
        }
    }

    override fun onDestroy() {
        releaseRequest()
        super.onDestroy()
    }
}
