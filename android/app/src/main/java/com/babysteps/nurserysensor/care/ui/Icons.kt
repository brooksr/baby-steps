package com.babysteps.nurserysensor.care.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * The Lucide icons the Babysteps web app draws (lucide-react 0.468, ISC), as
 * stroke vectors: 2 wide with round ends, the way Lucide draws them. Generated
 * from the web app's `node_modules/lucide-react/dist/esm/icons`; shapes other
 * than paths are converted to path data.
 */
object Lucide {
    private fun icon(name: String,vararg paths: String)=ImageVector.Builder(name,24.dp,24.dp,24f,24f).apply {
        for(d in paths) addPath(PathParser().parsePathString(d).toNodes(),fill=null,stroke=SolidColor(Color.Black),
            strokeLineWidth=2f,strokeLineCap=StrokeCap.Round,strokeLineJoin=StrokeJoin.Round)
    }.build()

    val home=icon("home","M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8","M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z")
    val list=icon("list","M3 12h.01","M3 18h.01","M3 6h.01","M8 12h13","M8 18h13","M8 6h13")
    val chart=icon("chart","M3 3v16a2 2 0 0 0 2 2h16","M18 17V9","M13 17V5","M8 17v-3")
    val clipboardCheck=icon("clipboardCheck","M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1z","M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2","m9 14 2 2 4-4")
    val cart=icon("cart","M7 21a1 1 0 1 0 2 0a1 1 0 1 0 -2 0","M18 21a1 1 0 1 0 2 0a1 1 0 1 0 -2 0","M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12")
    val listTodo=icon("listTodo","M4 5h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1z","m3 17 2 2 4-4","M13 6h8","M13 12h8","M13 18h8")
    val settings=icon("settings","M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z","M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0")
    val milk=icon("milk","M8 2h8","M9 2v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 7 10.212V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9.789a4 4 0 0 0-.672-2.219l-.656-.984A4 4 0 0 1 15 4.788V2","M7 15a6.472 6.472 0 0 1 5 0 6.47 6.47 0 0 0 5 0")
    val droplets=icon("droplets","M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z","M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97")
    val wind=icon("wind","M12.8 19.6A2 2 0 1 0 14 16H2","M17.5 8a2.5 2.5 0 1 1 2 4H2","M9.8 4.4A2 2 0 1 1 11 8H2")
    val dumbbell=icon("dumbbell","M14.4 14.4 9.6 9.6","M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z","m21.5 21.5-1.4-1.4","M3.9 3.9 2.5 2.5","M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z")
    val bath=icon("bath","M10 4 8 6","M17 19v2","M2 12h20","M7 19v2","M9 5 7.621 3.621A2.121 2.121 0 0 0 4 5v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5")
    val bed=icon("bed","M2 4v16","M2 8h18a2 2 0 0 1 2 2v10","M2 17h20","M6 8v9")
    val pill=icon("pill","m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z","m8.5 8.5 7 7")
    val calendar=icon("calendar","M8 2v4","M16 2v4","M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z","M3 10h18")
    val ruler=icon("ruler","M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z","m14.5 12.5 2-2","m11.5 9.5 2-2","m8.5 6.5 2-2","m17.5 15.5 2-2")
    val thermometer=icon("thermometer","M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z")
    val smile=icon("smile","M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0","M8 14s1.5 2 4 2 4-2 4-2","M9 9L9.01 9","M15 9L15.01 9")
    val fileText=icon("fileText","M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z","M14 2v4a2 2 0 0 0 2 2h4","M10 9H8","M16 13H8","M16 17H8")
    val heart=icon("heart","M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z")
    val award=icon("award","m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526","M6 8a6 6 0 1 0 12 0a6 6 0 1 0 -12 0")
    val syringe=icon("syringe","m18 2 4 4","m17 7 3-3","M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5","m9 11 4 4","m5 19-3 3","m14 4 6 6")
    val utensils=icon("utensils","m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8","M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7","m2.1 21.8 6.4-6.3","m19 5-7 7")
    val toilet=icon("toilet","M7 12h13a1 1 0 0 1 1 1 5 5 0 0 1-5 5h-.598a.5.5 0 0 0-.424.765l1.544 2.47a.5.5 0 0 1-.424.765H5.402a.5.5 0 0 1-.424-.765L7 18","M8 18a5 5 0 0 1-5-5V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8")
    val waves=icon("waves","M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1","M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1","M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1")
    val pencil=icon("pencil","M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z","m15 5 4 4")
    val trash=icon("trash","M3 6h18","M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6","M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2","M10 11L10 17","M14 11L14 17")
    val plus=icon("plus","M5 12h14","M12 5v14")
    val x=icon("x","M18 6 6 18","m6 6 12 12")
    val check=icon("check","M20 6 9 17l-5-5")
    val chevronLeft=icon("chevronLeft","m15 18-6-6 6-6")
    val chevronRight=icon("chevronRight","m9 18 6-6-6-6")
    val chevronDown=icon("chevronDown","m6 9 6 6 6-6")
    val navigation=icon("navigation","M3 11L22 2L13 21L11 13L3 11Z")
    val phone=icon("phone","M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z")
    val siren=icon("siren","M7 18v-6a5 5 0 1 1 10 0v6","M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z","M21 12h1","M18.5 4.5 18 5","M2 12h1","M12 2v1","m4.929 4.929.707.707","M12 12v6")
    val triangleAlert=icon("triangleAlert","m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3","M12 9v4","M12 17h.01")
    val hourglass=icon("hourglass","M5 22h14","M5 2h14","M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22","M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2")
    val moon=icon("moon","M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z")
    val sun=icon("sun","M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0","M12 2v2","M12 20v2","m4.93 4.93 1.41 1.41","m17.66 17.66 1.41 1.41","M2 12h2","M20 12h2","m6.34 17.66-1.41 1.41","m19.07 4.93-1.41 1.41")
    val sparkles=icon("sparkles","M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z","M20 3v4","M22 5h-4","M4 17v2","M5 18H3")
    val lightbulb=icon("lightbulb","M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5","M9 18h6","M10 22h4")
    val baby=icon("baby","M9 12h.01","M15 12h.01","M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5","M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1")
    val stethoscope=icon("stethoscope","M11 2v2","M5 2v2","M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1","M8 15a6 6 0 0 0 12 0v-3","M18 10a2 2 0 1 0 4 0a2 2 0 1 0 -4 0")
    val userRound=icon("userRound","M7 8a5 5 0 1 0 10 0a5 5 0 1 0 -10 0","M20 21a8 8 0 0 0-16 0")
    val heartHandshake=icon("heartHandshake","M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z","M12 5 9.04 7.96a2.17 2.17 0 0 0 0 3.08c.82.82 2.13.85 3 .07l2.07-1.9a2.82 2.82 0 0 1 3.79 0l2.96 2.66","m18 15-2-2","m15 18-2-2")
    val archive=icon("archive","M3 3h18a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-18a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1z","M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8","M10 12h4")
    val archiveRestore=icon("archiveRestore","M3 3h18a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-18a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1z","M4 8v11a2 2 0 0 0 2 2h2","M20 8v11a2 2 0 0 1-2 2h-2","m9 15 3-3 3 3","M12 12v9")
    val rotateCcw=icon("rotateCcw","M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8","M3 3v5h5")
    val download=icon("download","M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4","M7 10L12 15L17 10","M12 15L12 3")
    val upload=icon("upload","M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4","M17 8L12 3L7 8","M12 3L12 15")
    val bookOpen=icon("bookOpen","M12 7v14","M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z")
    val play=icon("play","M6 3L20 12L6 21L6 3Z")
    val square=icon("square","M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z")
    val circleAlert=icon("circleAlert","M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0","M12 8L12 12","M12 16L12.01 16")
    val maximize=icon("maximize","M15 3L21 3L21 9","M9 21L3 21L3 15","M21 3L14 10","M3 21L10 14")
    val radio=icon("radio","M4.9 19.1C1 15.2 1 8.8 4.9 4.9","M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5","M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0","M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5","M19.1 4.9C23 8.8 23 15.1 19.1 19")
    val cloud=icon("cloud","M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z")
    val circleSlash=icon("circleSlash","M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0","M9 15L15 9")
    val logOut=icon("logOut","M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4","M16 17L21 12L16 7","M21 12L9 12")
    val send=icon("send","M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z","m21.854 2.147-10.94 10.939")
    val search=icon("search","M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0","m21 21-4.3-4.3")
    val refresh=icon("refresh","M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8","M21 3v5h-5","M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16","M8 16H3v5")
    val cloudOff=icon("cloudOff","m2 2 20 20","M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193","M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07")
    val ear=icon("ear","M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 1 1-7 0","M15 8.5a2.5 2.5 0 0 0-5 0v1a2 2 0 1 1 0 4")
    val mic=icon("mic","M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z","M19 10v2a7 7 0 0 1-14 0v-2","M12 19L12 22")
    val fileChart=icon("fileChart","M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z","M14 2v4a2 2 0 0 0 2 2h4","M8 18v-1","M12 18v-6","M16 18v-3")
}
