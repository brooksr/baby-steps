package com.babysteps.nurserysensor.reporting

import com.babysteps.nurserysensor.sync.SyncSettings
import org.junit.Assert.*
import org.junit.Test

class DeliveryEndpointTest {
    @Test fun onlyExplicitHttpsEndpointsWithoutUrlSecretsAreAccepted() {
        assertTrue(SyncSettings.validEndpoint("https://script.google.com/macros/s/deployment/exec"))
        assertTrue(SyncSettings.validEndpoint("https://nursery.example.com/events"))
        listOf("http://nursery.example.com","https://token@nursery.example.com/events","https://nursery.example.com?token=secret","https://nursery.example.com/#secret","not a url", "https:///missing-host").forEach { assertFalse(it,SyncSettings.validEndpoint(it)) }
    }
}
