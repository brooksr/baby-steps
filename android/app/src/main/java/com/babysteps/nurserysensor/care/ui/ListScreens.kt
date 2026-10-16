package com.babysteps.nurserysensor.care.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.babysteps.nurserysensor.care.data.CareRepository
import com.babysteps.nurserysensor.care.domain.Dates
import com.babysteps.nurserysensor.care.domain.Family
import com.babysteps.nurserysensor.care.domain.Shopping
import com.babysteps.nurserysensor.care.domain.Tasks
import com.babysteps.nurserysensor.care.model.SHOPPING_CATEGORIES
import com.babysteps.nurserysensor.care.model.SHOPPING_CATEGORY_LABELS
import com.babysteps.nurserysensor.care.model.TaskItem
import com.babysteps.nurserysensor.care.model.isoString
import org.json.JSONObject
import java.time.Instant

@Composable
private fun ListRow(title: String,detail: String,checkIcon: ImageVector,checked: Boolean,tone: String="normal",onCheck: () -> Unit,actions: @Composable RowScope.() -> Unit) {
    val p=LocalPalette.current
    Row(Modifier.fillMaxWidth().clip(Radius).background(if(tone=="done") p.panelBlue else p.panel).border(1.dp,if(tone=="overdue") p.danger.copy(alpha=0.5f) else p.line,Radius)
        .padding(horizontal=10.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(34.dp).clip(RoundedCornerShape(8.dp)).background(if(checked) p.blue500 else p.panelBlue).border(1.dp,if(checked) p.blue500 else p.lineStrong,RoundedCornerShape(8.dp)).clickable(onClick=onCheck),
            contentAlignment=Alignment.Center) { Icon(checkIcon,null,tint=if(checked) (if(p.dark) p.page else Color.White) else p.muted,modifier=Modifier.size(18.dp)) }
        Column(Modifier.weight(1f)) { Ink(title,size=15); Text(detail,style=body(12,600),color=if(tone=="overdue") p.danger else p.muted) }
        actions()
    }
}

/** `components/ShoppingList.tsx`: the list, and — since nothing bought is thrown away — the household's catalogue. */
@Composable
fun ShoppingScreen(ui: Ui) {
    val context=LocalContext.current
    val items=ui.tracker.shopping
    var draft by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("pantry") }
    var isFood by remember { mutableStateOf(false) }
    var showAll by remember { mutableStateOf(false) }
    val active=Shopping.active(items); val bought=Shopping.bought(items)
    val need=items.count { it.status=="need" }; val cart=items.count { it.status=="cart" }; val done=items.count { it.status=="done" }
    val exact=Shopping.find(items,draft)
    val suggestions=Shopping.suggest(items,draft)

    fun save(input: JSONObject)=CareRepository.saveShoppingItem(context,input)
    fun add(input: JSONObject) { draft=""; isFood=false; save(JSONObject().put("addedBy",ui.profile.id).put("status","need").also { o -> input.keys().forEach { o.put(it,input.get(it)) } }) }

    Panel {
        Heading("Shopping","${need+cart} to buy · $done on file",level=1)
        TextInput("Item",draft,{ draft=it },placeholder="Add an item")
        Row(horizontalArrangement=Arrangement.spacedBy(10.dp),verticalAlignment=Alignment.Bottom) {
            Select("Aisle",SHOPPING_CATEGORIES.map { it to (SHOPPING_CATEGORY_LABELS[it] ?: it) },category,Modifier.weight(1f)) { category=it }
            PrimaryButton("Add",icon=Lucide.plus,enabled=draft.isNotBlank()) {
                // A name already on file keeps its own aisle and food flag.
                add(if(exact!=null) JSONObject().put("id",exact.id) else JSONObject().put("category",category).put("isFood",isFood).put("name",draft.trim()))
            }
        }
        if(exact==null) SwitchRow("Food or drink",isFood) { isFood=it }
        if(suggestions.isNotEmpty()) ChipRow { suggestions.forEach { s -> Chip(s.name) { add(JSONObject().put("id",s.id)) } } }
    }

    Panel {
        Heading("To buy","${active.size} item${if(active.size==1) "" else "s"}")
        val aisles=Shopping.aisles(items)
        if(aisles.isEmpty()) EmptyState("Nothing on the list. Start typing above — everything bought before is one tap.")
        aisles.forEach { (label,list) ->
            Text(label,style=display(16),color=LocalPalette.current.ink)
            list.forEach { item ->
                val by=Family.nameOf(ui.profiles,item.addedBy)
                ListRow(item.name,listOfNotNull(item.quantity,if(item.status=="cart") "in the cart" else null,by?.let { "added by $it" }).joinToString(" · ").ifEmpty { SHOPPING_CATEGORY_LABELS[item.category] ?: item.category },
                    if(item.status=="cart") Lucide.check else Lucide.cart,item.status=="cart",onCheck={
                        save(if(item.status=="cart") JSONObject().put("id",item.id).put("status","done").put("completedAt",isoString(Instant.now())) else JSONObject().put("id",item.id).put("status","cart")) }) {
                    // Off the list, not out of the catalogue: still there to re-add next week.
                    IconAction(Lucide.x,"Take ${item.name} off the list") { save(JSONObject().put("id",item.id).put("status","done")) }
                }
            }
        }
    }

    Panel {
        Heading("Bought before","${bought.size}")
        if(bought.isEmpty()) EmptyState("Nothing bought yet.")
        (if(showAll) bought else bought.take(12)).forEach { item ->
            ListRow(item.name,SHOPPING_CATEGORY_LABELS[item.category] ?: item.category,Lucide.rotateCcw,false,"done",onCheck={ save(JSONObject().put("id",item.id).put("status","need").put("completedAt",JSONObject.NULL)) }) {
                IconAction(Lucide.trash,"Forget ${item.name}") { CareRepository.removeShoppingItem(context,item.id) }
            }
        }
        if(bought.size>12) SecondaryButton(if(showAll) "Show recent only" else "Show all ${bought.size}",Modifier.fillMaxWidth()) { showAll=!showAll }
    }
}

/** `components/Todos.tsx`. A task with no date is not late — it just needs doing. */
@Composable
fun TodosScreen(ui: Ui) {
    val context=LocalContext.current
    val tasks=ui.tracker.tasks
    var title by remember { mutableStateOf("") }
    var due by remember { mutableStateOf<Instant?>(null) }
    var assignee by remember { mutableStateOf("") }
    var editingId by remember { mutableStateOf<String?>(null) }
    var showAll by remember { mutableStateOf(false) }
    val parents=Family.parents(ui.profiles)
    val groups=Tasks.groups(tasks); val done=Tasks.done(tasks)
    val open=tasks.count { it.status=="open" }; val overdue=tasks.count { it.status=="open" && Tasks.bucket(it)=="overdue" }; val today=tasks.count { it.status=="open" && Tasks.bucket(it)=="today" }
    val editingTask=tasks.find { it.id==editingId }

    fun reset() { title=""; due=null; assignee=""; editingId=null }
    fun edit(t: TaskItem) { title=t.title; due=t.due; assignee=t.assigneeId ?: ""; editingId=t.id }
    fun save(input: JSONObject)=CareRepository.saveTask(context,input)
    fun dueText(t: TaskItem)=t.due?.let { d -> val local=d.atZone(Dates.zone); if(local.hour==0 && local.minute==0) Dates.shortDate(d) else "${Dates.shortDate(d)} · ${Dates.clock(d)}" }

    Panel {
        Heading("To-do","$open open"+(if(overdue>0) " · $overdue overdue" else "")+(if(today>0) " · $today today" else ""),level=1)
        TextInput("Task",title,{ title=it },placeholder="What needs doing?")
        DateTimeInput("Due",due,{ due=it },hint="optional",clearable=true)
        if(parents.isNotEmpty()) Select("For",listOf("" to "Anyone")+parents.map { it.id to it.name },assignee) { assignee=it }
        Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            PrimaryButton(if(editingTask!=null) "Save task" else "Add",Modifier.weight(1f),icon=if(editingTask!=null) Lucide.check else Lucide.plus,enabled=title.isNotBlank()) {
                val input=JSONObject().put("title",title.trim()).put("status",editingTask?.status ?: "open")
                    .put("assigneeId",assignee.ifEmpty { null } ?: JSONObject.NULL).put("dueAt",due?.let(::isoString) ?: JSONObject.NULL)
                if(editingTask!=null) input.put("id",editingTask.id) else input.put("createdBy",ui.profile.id)
                save(input); reset()
            }
            if(editingTask!=null) SecondaryButton("Cancel",Modifier.weight(1f),icon=Lucide.x) { reset() }
        }
        FieldNote("A task with no date is not late — it just needs doing. Give one a date only when it actually has to happen then, and leave it on \"Anyone\" unless it is really one person's job.")
    }

    if(groups.isEmpty()) Panel { EmptyState("Nothing open. Add the next thing either of you needs to remember.") }
    groups.forEach { (bucket,list) ->
        Panel {
            Heading(Tasks.BUCKET_LABELS[bucket] ?: bucket,"${list.size}")
            list.forEach { t ->
                val who=Family.nameOf(ui.profiles,t.assigneeId)
                ListRow(t.title,listOfNotNull(dueText(t),who,t.notes).joinToString(" · ").ifEmpty { "Anyone, no date" },Lucide.check,false,if(bucket=="overdue") "overdue" else "normal",
                    onCheck={ save(JSONObject().put("id",t.id).put("status","done").put("completedAt",isoString(Instant.now()))) }) {
                    IconAction(Lucide.pencil,"Edit ${t.title}",LocalPalette.current.blue700) { edit(t) }
                    IconAction(Lucide.trash,"Delete ${t.title}") { CareRepository.removeTask(context,t.id) }
                }
            }
        }
    }

    if(done.isNotEmpty()) Panel {
        Heading("Done","${done.size}")
        (if(showAll) done else done.take(10)).forEach { t ->
            ListRow(t.title,t.completedAt?.let { "done ${Dates.shortDate(com.babysteps.nurserysensor.care.model.parseInstant(it) ?: Instant.now())}" } ?: "done",Lucide.rotateCcw,false,"done",
                onCheck={ save(JSONObject().put("id",t.id).put("status","open").put("completedAt",JSONObject.NULL)) }) {
                IconAction(Lucide.pencil,"Edit ${t.title}",LocalPalette.current.blue700) { edit(t) }
                IconAction(Lucide.trash,"Delete ${t.title}") { CareRepository.removeTask(context,t.id) }
            }
        }
        if(done.size>10) SecondaryButton(if(showAll) "Show recent only" else "Show all ${done.size}",Modifier.fillMaxWidth()) { showAll=!showAll }
    }
}
