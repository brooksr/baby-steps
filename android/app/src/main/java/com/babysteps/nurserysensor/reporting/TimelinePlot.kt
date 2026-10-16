package com.babysteps.nurserysensor.reporting

import com.babysteps.nurserysensor.audio.AudioStatistics

data class TimelinePoint(val offsetMs: Long,val levelDbfs: Double?,val validMs: Long)
data class TimelinePlot(val startMs: Long,val endMs: Long,val stepMs: Long,val points: List<TimelinePoint>) {
    companion object {
        /** Bounded rendering; energy-weighted averages, explicit missing/silenced gaps. */
        fun build(bins: List<SoundBin>,elapsedMs: Long,rangeMs: Long,maxPoints: Int=360): TimelinePlot {
            require(elapsedMs>=0 && rangeMs>0 && maxPoints>1)
            val end=maxOf(1000L,elapsedMs)
            val start=(end-rangeMs).coerceAtLeast(0)
            val step=maxOf(1000L,((end-start+maxPoints-1)/maxPoints+999)/1000*1000)
            val grouped=bins.filter { it.offsetMs>=start && it.offsetMs<end }.groupBy { (it.offsetMs-start)/step }
            val points=(0L..((end-start-1)/step)).map { index ->
                val values=grouped[index].orEmpty()
                val valid=values.sumOf { it.validMs }
                val level=if(valid==0L) null else AudioStatistics.powerDbfs(values.sumOf { (it.meanSquare?:0.0)*it.validMs }/valid)
                TimelinePoint(start+index*step,level,valid)
            }
            return TimelinePlot(start,end,step,points)
        }
    }
}
