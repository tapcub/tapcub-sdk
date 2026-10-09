package com.tapcub.core

import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.fail
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Runs packages/shared/test-vectors/sdk against the Kotlin core. Mini-program-only vectors are skipped
 * with the same filter as packages/app-sdk/test/vectors.test.mjs.
 */
class VectorTest {
    private val miniProgramOnly = Regex("\\\$mp_|mp_uuid|tapcub-mp|mp_weixin|mp_alipay|mp_bytedance|withShareParams|requiredPrivacyApis")

    private fun vectorDir(): File {
        val dir = System.getProperty("tapcub.vectorDir") ?: System.getenv("TC_VECTOR_DIR") ?: "../../shared/test-vectors/sdk"
        return File(dir)
    }

    @Test
    fun sharedVectors() {
        val files = vectorDir().listFiles { f -> f.name.endsWith(".json") }?.sortedBy { it.name }
            ?: fail("vector dir not found: ${vectorDir().absolutePath}")
        var ran = 0
        var skipped = 0
        val failed = ArrayList<String>()
        for (f in files) {
            val raw = f.readText()
            val v = Json.parseObject(raw) ?: fail("${f.name}: invalid JSON")
            val isApp = v["suite"] == "app" || !miniProgramOnly.containsMatchIn(raw)
            if (!isApp) {
                skipped++
                continue
            }
            ran++
            try {
                val out = VectorRunner.run(v)
                if (out.isNotEmpty()) failed.add("${f.name}: ${v["name"]}\n  " + out.joinToString("\n  "))
            } catch (e: Exception) {
                failed.add("${f.name}: $e")
            }
        }
        println("[vectors] kotlin ran $ran / skipped $skipped mini-program-only / failed ${failed.size}")
        if (failed.isNotEmpty()) fail<Unit>(failed.joinToString("\n\n"))
        assertTrue(ran >= 83, "expected at least 83 App vectors, ran $ran")
    }
}
