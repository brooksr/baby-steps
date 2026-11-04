package com.babysteps.internal

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Pure wire mapping shared with server mutation contracts; no credentials or Context. */
object InternalProtocol {
    fun command(op: JSONObject,meta: JSONObject,queued: JSONArray): JSONObject {
        op.optJSONObject("_internalCommand")?.let { return it }
        val name=op.getString("op")
        val collection=when(name) {
            "addEvent","updateEvent","deleteEvent" -> "events"
            "addProfile","saveProfile","archiveProfile","restoreProfile" -> "profiles"
            "saveShoppingItem","removeShoppingItem" -> "shopping"
            "saveTask","removeTask" -> "tasks"
            else -> error("Unsupported account operation: $name")
        }
        val source=op.optJSONObject(if(name=="updateEvent") "event" else if(name=="saveProfile") "profile" else "input")
        val id=op.optString("id").ifEmpty { source?.optString("id").orEmpty().ifEmpty { source?.optString("pendingId").orEmpty().ifEmpty { UUID.randomUUID().toString() } } }
        val action=when(name) { "archiveProfile" -> "archive"; "restoreProfile" -> "restore"; "deleteEvent","removeShoppingItem","removeTask" -> "remove"; else -> "save" }
        var revision=meta.optJSONObject("revisions")?.optInt("$collection:$id",0) ?: 0
        for(i in 0 until queued.length()) queued.optJSONObject(i)?.optJSONObject("_internalCommand")?.let {
            if(it.optString("collection")==collection && it.optString("id")==id) revision++
            if(collection=="profiles" && it.optString("collection")=="events" && it.optJSONObject("patch")?.optString("type")=="birth" && it.optJSONObject("patch")?.optString("babyId")==id) revision++
        }
        return JSONObject().put("action",action).put("collection",collection).put("expectedRevision",revision).put("id",id).put("operationId",UUID.randomUUID().toString()).apply {
            if(source!=null) put("patch",JSONObject(source.toString()).apply {
                remove("familyId"); remove("pendingId"); put("id",id)
                if(collection=="profiles" && !has("timezone")) put("timezone",java.time.ZoneId.systemDefault().id)
            })
        }
    }
    data class Logger(val id: String,val name: String)

    /** Who a parent's watch can log as, from its last bootstrap; empty for a caregiver account or an older Pi. */
    fun loggers(meta: JSONObject): List<Logger> {
        val list=meta.optJSONArray("loggers") ?: return emptyList()
        return (0 until list.length()).mapNotNull { list.optJSONObject(it) }.filter { it.optString("id").isNotEmpty() }
            .map { Logger(it.getString("id"),it.optString("name").ifEmpty { "Unnamed" }) }
    }

    /** The person entries go out as: the chosen one while still in the family, else the signed-in account. */
    fun logAs(meta: JSONObject,chosen: String): Logger? {
        val people=loggers(meta)
        return people.find { it.id==chosen } ?: people.find { it.id==meta.optString("actorProfileId") }
    }

    /** [logAs] is a profile id from [loggers]; one no longer offered falls back to the account rather than failing. */
    fun watchCommand(request: JSONObject,meta: JSONObject,child: String,logAs: String=""): JSONObject {
        request.optJSONObject("_internalCommand")?.let { return it }
        val profiles=meta.getJSONObject("data").getJSONArray("profiles")
        val children=(0 until profiles.length()).map { profiles.getJSONObject(it) }.filter { it.optString("kind","child")=="child" && !it.has("archivedAt") }
        val target=if(child.isNotEmpty()) children.find { it.optString("id")==child } else children.singleOrNull()
        require(target!=null) { "Choose the child in Settings and sync first" }
        val patch=JSONObject().put("babyId",target.getString("id")).put("startedAt",java.time.OffsetDateTime.parse(request.getString("timestamp")).toInstant().toString()).put("type",request.getString("type"))
        if(request.optString("type")=="diaper") patch.put("kind",request.getString("diaperType"))
        else {
            patch.put("method",request.getString("method"))
            if(request.has("amount")) patch.put("amountOz",request.getDouble("amount"))
            for(key in listOf("durationMinutes","side")) if(request.has(key)) patch.put(key,request.get(key))
        }
        if(logAs.isNotEmpty() && loggers(meta).any { it.id==logAs }) patch.put("caregiverId",logAs)
        return JSONObject().put("action","save").put("collection","events").put("expectedRevision",0).put("id",UUID.randomUUID().toString()).put("operationId",UUID.randomUUID().toString()).put("patch",patch)
    }

}
