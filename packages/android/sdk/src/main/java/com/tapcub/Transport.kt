package com.tapcub

import com.tapcub.core.Transport
import com.tapcub.core.TransportResponse
import java.net.HttpURLConnection
import java.net.URL

/**
 * HttpURLConnection on a dedicated `tapcub-net` thread; results are handed back to the worker thread, so the
 * worker never blocks on the network. The core sends one batch at a time, so ordering and backoff hold.
 */
internal class HttpTransport(private val worker: Worker, private val net: Worker) : Transport {
    override fun get(url: String, cb: (Result<TransportResponse>) -> Unit) {
        net.execute {
            val r = runCatching { request(url, "GET", null, emptyMap()) }
            worker.execute { cb(r) }
        }
    }

    override fun post(url: String, body: String, headers: Map<String, String>, cb: (Result<TransportResponse>) -> Unit) {
        net.execute {
            val r = runCatching { request(url, "POST", body, headers) }
            worker.execute { cb(r) }
        }
    }

    private fun request(url: String, method: String, body: String?, headers: Map<String, String>): TransportResponse {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.requestMethod = method
            c.connectTimeout = 10_000
            c.readTimeout = 15_000
            c.useCaches = false
            c.instanceFollowRedirects = true
            for ((k, v) in headers) c.setRequestProperty(k, v)
            if (body != null) {
                val bytes = body.toByteArray(Charsets.UTF_8)
                c.doOutput = true
                c.setFixedLengthStreamingMode(bytes.size)
                c.outputStream.use { it.write(bytes) }
            }
            val status = c.responseCode
            val stream = if (status >= 400) c.errorStream else c.inputStream
            val text = stream?.use { s -> s.readBytes().toString(Charsets.UTF_8) }
            return TransportResponse(status, text)
        } finally {
            c.disconnect()
        }
    }
}
