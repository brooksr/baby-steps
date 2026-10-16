package com.babysteps.internal

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Secrets are encrypted with a non-exportable Android Keystore key; no backups. */
class SecureCredentials(context: Context,namespace: String) {
    private val prefs=context.applicationContext.getSharedPreferences("$namespace-secrets",Context.MODE_PRIVATE)
    private val alias="babysteps-$namespace"
    private fun key(): SecretKey = synchronized(SecureCredentials::class.java) {
        val store=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias,null) as? SecretKey)?.let { return@synchronized it }
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun get(name: String): String? {
        val encoded=prefs.getString(name,null) ?: return null
        // Fail closed if the installation's key is unavailable. Re-enrollment is required.
        return runCatching {
            val parts=encoded.split(':'); val iv=Base64.decode(parts[0],Base64.NO_WRAP)
            val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,iv)) }
            String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),Charsets.UTF_8)
        }.getOrNull()
    }
    @Synchronized fun set(name: String,value: String?) {
        if(value==null) { check(prefs.edit().remove(name).commit()); return }
        val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE,key()) }
        val encoded=Base64.encodeToString(cipher.iv,Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.toByteArray()),Base64.NO_WRAP)
        check(prefs.edit().putString(name,encoded).commit())
    }
}
