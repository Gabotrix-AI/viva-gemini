// public/audio-processor.js
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sampleRate = 16000; // Frecuencia de muestreo deseada para Gemini
    this.channelCount = 1; // Mono
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length === 0) {
      return true; // No hay datos de entrada
    }

    const inputChannelData = input[0]; // Tomar el primer canal (mono)

    // Convertir a Int16Array (LINEAR16)
    // Asegurarse de que el AudioContext esté a 16kHz. Si no, se necesitaría un remuestreo aquí.
    // Para simplificar, asumimos que el AudioContext ya está configurado a 16kHz.
    const pcm16 = new Int16Array(inputChannelData.length);
    for (let i = 0; i < inputChannelData.length; i++) {
      // Normalizar de [-1, 1] a [-32768, 32767]
      pcm16[i] = Math.max(-1, Math.min(1, inputChannelData[i])) * 0x7FFF;
    }

    // Enviar el buffer procesado al hilo principal
    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);

    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);