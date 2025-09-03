// public/audio-processor.js
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sampleRate = 16000; // Frecuencia de muestreo deseada para Gemini
    this.channelCount = 1; // Mono
    this.bufferSize = 4096; // Tamaño del buffer de procesamiento
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length === 0) {
      return true; // No hay datos de entrada
    }

    const inputChannelData = input[0]; // Tomar el primer canal (mono)

    // Remuestreo (simplificado: asume que el AudioContext ya está a 16kHz o se maneja externamente)
    // En un escenario real, si el sampleRate del AudioContext es diferente, se necesitaría un algoritmo de remuestreo.
    // Para este ejemplo, asumimos que el audio ya llega a 16kHz o que el navegador lo maneja.
    const resampledData = inputChannelData;

    // Convertir a Int16Array (LINEAR16)
    const pcm16 = new Int16Array(resampledData.length);
    for (let i = 0; i < resampledData.length; i++) {
      // Normalizar de [-1, 1] a [-32768, 32767]
      pcm16[i] = Math.max(-1, Math.min(1, resampledData[i])) * 0x7FFF;
    }

    // Enviar el buffer procesado al hilo principal
    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);

    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);