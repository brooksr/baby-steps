package com.babysteps.nurserysensor.classification

import android.content.Context
import com.babysteps.nurserysensor.audio.AudioClassifier
import com.babysteps.nurserysensor.audio.AudioLabel
import com.babysteps.nurserysensor.audio.AudioWindow
import com.babysteps.nurserysensor.audio.ClassificationResult
import com.google.mediapipe.tasks.audio.audioclassifier.AudioClassifier as MediaPipeClassifier
import com.google.mediapipe.tasks.audio.core.RunningMode
import com.google.mediapipe.tasks.components.containers.AudioData
import com.google.mediapipe.tasks.core.BaseOptions

/** CPU inference; one worker owns creation, calls and close. Model metadata handles framing.
 * No MediaPipe-created recorder: the foreground service remains the microphone owner.
 */
class YamnetClassifier(context: Context) : AudioClassifier {
    private val floats = FloatArray(DetectionDefaults.INPUT_SAMPLES)
    private val data = AudioData.create(AudioData.AudioDataFormat.builder().setNumOfChannels(1).setSampleRate(16000f).build(), floats.size)
    private val classifier = MediaPipeClassifier.createFromOptions(context,
        MediaPipeClassifier.AudioClassifierOptions.builder()
            .setBaseOptions(BaseOptions.builder().setModelAssetPath("yamnet.tflite").build())
            // Leave maxResults unset to return every category, including low-scoring
            // nursery labels. MediaPipe 1.0 rejects an explicitly negative limit.
            .setRunningMode(RunningMode.AUDIO_CLIPS).build())
    override fun classify(audio: AudioWindow): ClassificationResult {
        require(audio.sampleRate == 16000 && audio.samples.size == floats.size)
        try {
            audio.samples.forEachIndexed { index, value -> floats[index] = value / 32768f }
            data.load(floats)
            val categories = classifier.classify(data).classificationResults()
                .flatMap { it.classifications() }.flatMap { it.categories() }
            val scores = AudioLabel.entries.associateWith { 0.0 }.toMutableMap()
            categories.forEach { category ->
                val label = mapping(category.categoryName()) ?: return@forEach
                scores[label] = maxOf(scores.getValue(label), category.score().toDouble().coerceIn(0.0,1.0))
            }
            val relevant = scores.filterKeys { it != AudioLabel.UNKNOWN }.maxByOrNull { it.value }
            val best = categories.maxByOrNull { it.score() }
            val label = if ((relevant?.value ?: 0.0) >= .30) relevant!!.key else AudioLabel.UNKNOWN
            return ClassificationResult(label, if(label == AudioLabel.UNKNOWN) 0.0 else scores.getValue(label),
                scores, best?.categoryName(), best?.score()?.toDouble())
        } finally {
            floats.fill(0f); data.load(floats) // Erase both the conversion and MediaPipe input ring.
        }
    }
    override fun close() { floats.fill(0f); data.load(floats); classifier.close() }
    private fun mapping(name: String): AudioLabel? = when(name) {
        "Baby cry, infant cry" -> AudioLabel.BABY_CRY
        "Speech", "Child speech, kid speaking", "Conversation", "Whispering" -> AudioLabel.SPEECH
        "Snoring" -> AudioLabel.SNORING
        "Cough" -> AudioLabel.COUGH
        "Noise", "White noise", "Pink noise", "Mechanical fan", "Air conditioning", "Wind" -> AudioLabel.AMBIENT_NOISE
        else -> null // Don't relabel all out-of-scope sounds as ambient noise or force a prediction.
    }
}
