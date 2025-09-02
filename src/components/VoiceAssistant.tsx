import React, { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Mic, MicOff, Volume2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface VoiceAssistantProps {}

type AssistantState = 'idle' | 'listening' | 'processing' | 'speaking';

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const VoiceAssistant: React.FC<VoiceAssistantProps> = () => {
  const [state, setState] = useState<AssistantState>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const { toast } = useToast();
  
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioBufferRef = useRef<Float32Array[]>([]);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  const GEMINI_API_KEY = 'AIzaSyA-nn8ICl5G00uklIG6zvh5tAq4U5qQUqU';

  const addMessage = useCallback((content: string, type: 'user' | 'assistant') => {
    const newMessage: Message = {
      id: Date.now().toString(),
      type,
      content,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newMessage]);
  }, []);

  const playAudioResponse = useCallback(async (audioData: string) => {
    try {
      setState('speaking');
      
      // Decodificar base64 a ArrayBuffer
      const binaryString = atob(audioData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Crear contexto de audio para decodificar
      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(bytes.buffer);
      
      // Reproducir usando Web Audio API
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      
      source.onended = () => {
        console.log('✅ Audio de Gemini terminado');
        setState('listening');
        audioContext.close();
      };
      
      console.log('🔊 Reproduciendo respuesta de Gemini...');
      source.start();
      addMessage("🔊 Gemini está respondiendo", 'assistant');
      
    } catch (error) {
      console.error('❌ Error reproduciendo audio:', error);
      setState('listening');
      addMessage("❌ Error reproduciendo respuesta de audio", 'assistant');
    }
  }, [addMessage]);

  // Buffer de audio para acumular datos antes de enviar
  const processAudioBuffer = useCallback(() => {
    if (audioBufferRef.current.length === 0 || !sessionRef.current) {
      console.log('⚠️ No hay buffer o sesión disponible');
      return;
    }

    try {
      // Validar que la sesión está disponible (SDK no tiene readyState como WebSocket)
      if (!sessionRef.current) {
        console.log('⚠️ Sesión no disponible');
        return;
      }
      
      // Combinar todos los chunks en un solo buffer
      const totalLength = audioBufferRef.current.reduce((sum, chunk) => sum + chunk.length, 0);
      
      // Optimizar: enviar chunks de tamaño adecuado (mínimo 0.1s = 1600 samples a 16kHz)
      if (totalLength < 1600) {
        console.log('⚠️ Buffer muy pequeño, esperando más datos');
        return;
      }
      
      // Limitar tamaño máximo para evitar problemas de memoria
      if (totalLength > 16000) { // máximo 1 segundo de audio
        console.log('⚠️ Buffer muy grande, tomando solo 1 segundo');
        audioBufferRef.current = audioBufferRef.current.slice(0, Math.ceil(16000 / 4096));
      }
      
      const combinedBuffer = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of audioBufferRef.current) {
        combinedBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      // Convertir a PCM 16-bit con mejor calidad
      const pcmData = new Int16Array(combinedBuffer.length);
      for (let i = 0; i < combinedBuffer.length; i++) {
        // Aplicar clipping suave para evitar distorsión
        const sample = combinedBuffer[i];
        pcmData[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
      }

      // Convertir a base64 de manera más robusta para chunks grandes
      const uint8Array = new Uint8Array(pcmData.buffer);
      let base64Audio = '';
      
      // Procesar en chunks para evitar stack overflow con arrays grandes
      const chunkSize = 8192;
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.slice(i, i + chunkSize);
        base64Audio += btoa(String.fromCharCode.apply(null, Array.from(chunk)));
      }

      // CORRECCIÓN CRÍTICA: Usar formato SDK correcto, no WebSocket crudo
      const audioPart = {
        inlineData: { 
          data: base64Audio, 
          mimeType: "audio/pcm" // SDK maneja la tasa internamente
        }
      };

      // Validar datos antes del envío
      if (!base64Audio || base64Audio.length === 0) {
        console.log('⚠️ Audio base64 vacío, saltando envío');
        audioBufferRef.current = [];
        return;
      }

      console.log('📤 Enviando parte de audio:', { 
        mimeType: audioPart.inlineData.mimeType,
        dataLength: base64Audio.length 
      });
      
      // El SDK espera un array de partes de contenido
      sessionRef.current.send([audioPart]);

      console.log(`📤 Enviado chunk de audio: ${combinedBuffer.length} samples (${base64Audio.length} bytes base64)`);
      
      // Limpiar buffer
      audioBufferRef.current = [];
      
    } catch (error) {
      console.error('❌ Error enviando audio:', error);
      // No limpiar buffer en caso de error temporal
    }
  }, []);

  const initializeGeminiSession = useCallback(async () => {
    try {
      const { GoogleGenAI, Modality } = await import('@google/genai');
      
      const ai = new GoogleGenAI({
        apiKey: GEMINI_API_KEY
      });
      
      // Usar modelo recomendado con audio nativo según documentación
      const model = 'gemini-2.0-flash-live-001';
      const config = {
        responseModalities: [Modality.AUDIO, Modality.TEXT],
        systemInstruction: "Eres un asistente de voz amigable que habla en español. Responde de manera concisa y natural con audio cuando sea posible."
      };
      
      console.log('🔄 Conectando con Gemini Live API...');
      
      const session = await ai.live.connect({
        model,
        config,
        callbacks: {
          onopen: () => {
            console.log('✅ Conexión establecida con Gemini Live API');
            addMessage("✅ Conexión establecida - Puedes empezar a hablar", 'assistant');
          },
          onmessage: (message) => {
            console.log('📨 Mensaje recibido de Gemini:', JSON.stringify(message, null, 2));
            
            try {
              // Manejar respuesta según estructura real de Gemini Live API
              if (message.serverContent?.modelTurn?.parts) {
                const parts = message.serverContent.modelTurn.parts;
                
                for (const part of parts) {
                  if (part.inlineData?.mimeType?.includes('audio')) {
                    console.log('🎵 Audio recibido de Gemini');
                    playAudioResponse(part.inlineData.data);
                  }
                  
                  if (part.text) {
                    console.log('💬 Texto de Gemini:', part.text);
                    addMessage(part.text, 'assistant');
                  }
                }
              }
              
              // Verificar si el turno está completo
              if (message.serverContent?.turnComplete) {
                console.log('✅ Turno completado');
                setState('listening'); // Volver a listening después de completar
              }
              
              // Manejar tipos de mensaje específicos
              if ((message as any).type === 'serverContent') {
                console.log('📨 Contenido del servidor:', message);
              }
              
              // Manejar respuesta de audio directo (fallback)
              if ((message as any).audio?.data) {
                console.log('🎵 Audio directo detectado');
                playAudioResponse((message as any).audio.data);
              }
              
              // Manejar texto directo (fallback)
              if ((message as any).text && typeof (message as any).text === 'string') {
                console.log('💬 Texto directo:', (message as any).text);
                addMessage((message as any).text, 'assistant');
              }
              
            } catch (parseError) {
              console.error('❌ Error procesando mensaje:', parseError);
            }
          },
          onerror: (error) => {
            console.error('❌ Error en Gemini:', error);
            toast({
              title: "Error de conexión",
              description: `Error: ${error.message}`,
              variant: "destructive"
            });
            setState('idle');
          },
          onclose: (event) => {
            console.log('🔌 Conexión cerrada:', event);
            console.log('Código de cierre:', event.code, 'Razón:', event.reason);
            
            if (event.code === 1006) {
              console.error('❌ Conexión cerrada anormalmente - posible problema de formato de datos');
              addMessage("❌ Error de conexión - datos inválidos", 'assistant');
            } else if (event.code === 1000) {
              addMessage("✅ Conexión cerrada normalmente", 'assistant');
            } else {
              addMessage(`⚠️ Conexión cerrada (código: ${event.code})`, 'assistant');
            }
            setState('idle');
          }
        }
      });
      
      sessionRef.current = session;
      return session;
      
    } catch (error) {
      console.error('❌ Error inicializando Gemini:', error);
      toast({
        title: "Error de inicialización",
        description: `No se pudo conectar: ${error.message}`,
        variant: "destructive"
      });
      return null;
    }
  }, [toast, addMessage, playAudioResponse, processAudioBuffer]);

  const startListening = useCallback(async () => {
    try {
      setState('listening');
      
      // Inicializar sesión de Gemini
      const session = await initializeGeminiSession();
      if (!session) {
        setState('idle');
        return;
      }
      
      // Obtener acceso al micrófono con configuración optimizada
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      streamRef.current = stream;
      addMessage("🎤 Micrófono activado - Habla ahora", 'user');
      
      // Crear contexto de audio
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      
      // Usar procesador simple con buffer acumulativo
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (event) => {
        // Verificar que la sesión sigue disponible
        if (!sessionRef.current) return;
        
        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);
        
        // Acumular en buffer
        audioBufferRef.current.push(new Float32Array(inputData));
        
        // Optimizar frecuencia: Enviar cada 0.5 segundos (8 chunks de 4096 samples a 16kHz)
        if (audioBufferRef.current.length >= 8) {
          processAudioBuffer();
        }
      };
      
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      // Procesar buffer cada 0.5 segundo como backup
      const intervalId = setInterval(() => {
        if (audioBufferRef.current.length > 0 && sessionRef.current) {
          processAudioBuffer();
        }
      }, 500);
      
      // Guardar intervalo para limpieza posterior
      (processor as any).intervalId = intervalId;
      
    } catch (error) {
      console.error('❌ Error iniciando grabación:', error);
      toast({
        title: "Error de micrófono",
        description: `No se pudo acceder al micrófono: ${error.message}`,
        variant: "destructive"
      });
      setState('idle');
    }
  }, [initializeGeminiSession, addMessage, toast, processAudioBuffer, state]);

  const stopListening = useCallback(() => {
    setState('idle');
    
    // Enviar último chunk si existe
    if (audioBufferRef.current.length > 0) {
      processAudioBuffer();
    }
    
    // Cerrar sesión de Gemini
    if (sessionRef.current) {
      try {
        sessionRef.current.close();
        sessionRef.current = null;
        console.log('🔌 Sesión de Gemini cerrada');
      } catch (error) {
        console.error('Error cerrando sesión:', error);
      }
    }
    
    // Limpiar stream de audio
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Limpiar contexto de audio
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    // Limpiar worklet si existe
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    
    // Limpiar buffer
    audioBufferRef.current = [];
    
    addMessage("🛑 Conversación finalizada", 'user');
  }, [addMessage, processAudioBuffer]);

  const handleToggleConversation = useCallback(() => {
    if (state === 'idle') {
      startListening();
    } else if (state === 'listening') {
      stopListening();
    }
  }, [state, startListening, stopListening]);

  const getStatusConfig = (currentState: AssistantState) => {
    switch (currentState) {
      case 'listening':
        return { 
          text: 'Escuchando...', 
          icon: <Mic className="w-4 h-4" />, 
          className: 'status-listening' 
        };
      case 'processing':
        return { 
          text: 'Procesando...', 
          icon: <Loader2 className="w-4 h-4 animate-spin" />, 
          className: 'status-processing' 
        };
      case 'speaking':
        return { 
          text: 'Hablando...', 
          icon: <Volume2 className="w-4 h-4" />, 
          className: 'status-speaking' 
        };
      default:
        return { 
          text: 'Listo para hablar', 
          icon: <Mic className="w-4 h-4" />, 
          className: 'status-indicator' 
        };
    }
  };

  const statusConfig = getStatusConfig(state);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 space-y-8">
      {/* Header */}
      <div className="text-center space-y-4 animate-float">
        <h1 className="text-5xl font-bold bg-gradient-to-r from-purple-600 to-blue-500 bg-clip-text text-transparent">
          Asistente de Voz
        </h1>
        <h2 className="text-2xl font-medium text-muted-foreground">
          Powered by Gemini AI
        </h2>
        <p className="text-lg text-muted-foreground max-w-2xl">
          Haz clic en el botón para comenzar a hablar. El asistente te responderá en tiempo real.
        </p>
      </div>

      {/* Status Indicator */}
      <Badge className={statusConfig.className}>
        {statusConfig.icon}
        {statusConfig.text}
      </Badge>

      {/* Main Voice Button */}
      <div className="relative">
        <Button
          onClick={handleToggleConversation}
          disabled={state === 'processing' || state === 'speaking'}
          size="lg"
          className={`
            voice-button w-32 h-32 rounded-full text-xl font-semibold
            bg-gradient-to-r from-purple-600 to-blue-500 hover:from-purple-700 hover:to-blue-600
            ${state === 'listening' ? 'listening' : ''}
          `}
        >
          {state === 'listening' ? (
            <MicOff className="w-12 h-12" />
          ) : state === 'processing' || state === 'speaking' ? (
            <Loader2 className="w-12 h-12 animate-spin" />
          ) : (
            <Mic className="w-12 h-12" />
          )}
        </Button>
      </div>

      {/* Button Label */}
      <p className="text-lg font-medium text-muted-foreground">
        {state === 'idle' ? 'Iniciar Conversación' : 
         state === 'listening' ? 'Detener Conversación' :
         state === 'processing' ? 'Procesando...' : 'Hablando...'}
      </p>

      {/* Messages/Transcription Area */}
      {messages.length > 0 && (
        <Card className="glass-card w-full max-w-2xl p-6">
          <h3 className="text-xl font-semibold mb-4">Conversación</h3>
          <div className="transcription-area space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`p-3 rounded-lg ${
                  message.type === 'user' 
                    ? 'bg-primary/10 text-primary border-l-4 border-primary' 
                    : 'bg-secondary/50 text-secondary-foreground border-l-4 border-secondary'
                }`}
              >
                <div className="flex justify-between items-start">
                  <p className="text-sm">
                    <strong>{message.type === 'user' ? 'Usuario:' : 'Asistente:'}</strong> {message.content}
                  </p>
                  <span className="text-xs text-muted-foreground ml-2">
                    {message.timestamp.toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default VoiceAssistant;