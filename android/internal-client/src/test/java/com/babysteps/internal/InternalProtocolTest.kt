package com.babysteps.internal

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class InternalProtocolTest {
    @Test fun retriesKeepTheirIdentityAndUseQueuedRevisions() {
        val meta=JSONObject().put("revisions",JSONObject().put("tasks:task",2))
        val input=JSONObject().put("op","saveTask").put("input",JSONObject().put("id","task").put("title","Example").put("notes",JSONObject.NULL))
        val first=InternalProtocol.command(input,meta,JSONArray())
        assertEquals(2,first.getInt("expectedRevision")); assertTrue(first.getJSONObject("patch").isNull("notes"))
        input.put("_internalCommand",first)
        assertEquals(first,InternalProtocol.command(input,meta,JSONArray()))
        val second=InternalProtocol.command(JSONObject(input.toString()).apply { remove("_internalCommand") },meta,JSONArray().put(input))
        assertEquals(3,second.getInt("expectedRevision")); assertNotEquals(first.getString("operationId"),second.getString("operationId"))
    }
    @Test fun watchPayloadHasCanonicalFieldsAndOriginalTimestamp() {
        val meta=JSONObject().put("data",JSONObject().put("profiles",JSONArray().put(JSONObject().put("id","baby").put("kind","child"))))
        val request=JSONObject().put("type","feed").put("method","bottle").put("amount",3.0).put("timestamp","2026-10-16T01:00:00-07:00")
        val command=InternalProtocol.watchCommand(request,meta,"")
        assertEquals("2026-10-16T08:00:00Z",command.getJSONObject("patch").getString("startedAt"))
        assertEquals(3.0,command.getJSONObject("patch").getDouble("amountOz"),0.0)
        assertEquals("baby",command.getJSONObject("patch").getString("babyId"))
        assertEquals(0,command.getInt("expectedRevision"))
    }
}
