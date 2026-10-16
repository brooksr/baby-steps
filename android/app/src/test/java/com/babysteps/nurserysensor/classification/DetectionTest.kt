package com.babysteps.nurserysensor.classification

import com.babysteps.nurserysensor.audio.AudioLabel
import com.babysteps.nurserysensor.audio.ClassificationResult
import org.junit.Assert.*
import org.junit.Test

class DetectionTest {
    private fun prediction(end: Long, vararg scores: Pair<AudioLabel,Double>): Prediction {
        val map=scores.toMap()
        val top=map.maxByOrNull { it.value }
        return Prediction(end,end,ClassificationResult(top?.key ?: AudioLabel.UNKNOWN,top?.value ?: 0.0,map),10)
    }
    @Test fun singleCrySpikeDoesNotBecomeEpisode() {
        val d=EpisodeDetector()
        assertTrue(d.accept(prediction(1000,AudioLabel.BABY_CRY to .8)).isEmpty())
        assertTrue(d.accept(prediction(2000)).isEmpty())
        assertTrue(d.flush().isEmpty())
    }
    @Test fun confirmedCryUsesHysteresisAndSupportedEnd() {
        val d=EpisodeDetector()
        d.accept(prediction(1000,AudioLabel.BABY_CRY to .5))
        d.accept(prediction(2000,AudioLabel.BABY_CRY to .6))
        d.accept(prediction(3000,AudioLabel.BABY_CRY to .25))
        assertTrue(d.accept(prediction(4000)).isEmpty())
        val e=d.accept(prediction(5000)).single()
        assertEquals(AudioLabel.BABY_CRY,e.label); assertEquals(25,e.startOffsetMs)
        assertEquals(3000,e.endOffsetMs); assertEquals(.6,e.maxScore,0.0)
        assertTrue(d.flush().isEmpty())
    }
    @Test fun overlappingSpeechAndCryRemainSeparate() {
        val d=EpisodeDetector()
        for(t in listOf(1000L,2000L)) d.accept(prediction(t,AudioLabel.BABY_CRY to .8,AudioLabel.SPEECH to .7))
        assertEquals(setOf(AudioLabel.BABY_CRY,AudioLabel.SPEECH),d.flush().map { it.label }.toSet())
    }
    @Test fun missingInferenceDoesNotStretchEpisodeAcrossGap() {
        val d=EpisodeDetector()
        d.accept(prediction(1000,AudioLabel.BABY_CRY to .8)); d.accept(prediction(2000,AudioLabel.BABY_CRY to .8))
        val e=d.accept(prediction(10000,AudioLabel.BABY_CRY to .8)).single()
        assertEquals(2000,e.endOffsetMs); assertTrue(d.flush().isEmpty())
    }
    @Test fun coughCanBeShortAndUnknownDoesNotCreateEvents() {
        val d=EpisodeDetector()
        d.accept(prediction(1000,AudioLabel.COUGH to .8))
        assertEquals(AudioLabel.COUGH,d.accept(prediction(2000)).single().label)
        assertTrue(d.accept(prediction(3000,AudioLabel.UNKNOWN to .9)).isEmpty())
        assertTrue(d.flush().isEmpty())
    }
    @Test fun assemblerHandlesPartialReadsAndDoesNotRetainBorrowedArrays() {
        val a=PcmWindowAssembler(4,4)
        val frames=mutableListOf<ShortArray>()
        val first=shortArrayOf(1,2)
        a.append(first) { frame,_ -> frames+=frame }; first.fill(0)
        a.append(shortArrayOf(3,4,5,6,7,8)) { frame,_ -> frames+=frame }
        assertArrayEquals(shortArrayOf(1,2,3,4),frames[0]); assertArrayEquals(shortArrayOf(5,6,7,8),frames[1])
    }
    @Test fun resetPreventsInferenceUsingPreSilencingContext() {
        val a=PcmWindowAssembler(4,4)
        a.append(shortArrayOf(99,99)) { _,_ -> fail() }; a.reset()
        var emitted: ShortArray?=null
        a.append(shortArrayOf(1,2,3,4)) { frame,_ -> emitted=frame }
        assertArrayEquals(shortArrayOf(1,2,3,4),emitted)
    }
    @Test fun realModelWindowIsExactly975msWithOneSecondHop() {
        val a=PcmWindowAssembler()
        val windows=mutableListOf<Pair<Int,Int>>()
        a.append(ShortArray(32000)) { frame,remaining -> windows+=frame.size to remaining }
        assertEquals(listOf(15600 to 16400,15600 to 400),windows)
    }
    @Test(expected=IllegalArgumentException::class) fun unorderedPredictionsAreRejected() {
        val d=EpisodeDetector(); d.accept(prediction(1000)); d.accept(prediction(1000))
    }
}
