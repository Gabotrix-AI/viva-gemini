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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
      // Decodificar base64 a ArrayBuffer
      const binaryString = atob(audioData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Crear blob de audio con formato correcto
      const audioBlob = new Blob([bytes], { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(audioBlob);
      
      const audio = new Audio(audioUrl);
      audio.onloadeddata = () => console.log('Audio cargado, duración:', audio.duration);
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        console.log('Audio terminado');
      };
      audio.onerror = (e) => {
        console.error('Error en reproducción:', e);
        URL.revokeObjectURL(audioUrl);
      };
      
      console.log('Reproduciendo audio de Gemini...');
      await audio.play();
      addMessage("🔊 Gemini respondió", 'assistant');
    } catch (error) {
      console.error('Error reproduciendo audio:', error);
      addMessage("❌ Error reproduciendo respuesta", 'assistant');
    }
  }, [addMessage]);

  const initializeGeminiSession = useCallback(async () => {
    try {
      const { GoogleGenAI, Modality } = await import('@google/genai');
      
      const ai = new GoogleGenAI({
        apiKey: GEMINI_API_KEY
      });
      
      // Usar el modelo recomendado para audio bidireccional
      const model = 'gemini-live-2.5-flash-preview';
      const config = {
        responseModalities: [Modality.AUDIO, Modality.TEXT],
        systemInstruction: "Eres un asistente de voz amigable. Responde de manera concisa y útil en español. Mantén tus respuestas breves pero informativas."
      };
      
      const session = await ai.live.connect({
        model,
        callbacks: {
          onopen: () => {
            console.log('✅ Conexión establecida con Gemini Live API');
            addMessage("Conexión establecida con Gemini", 'assistant');
          },
          onmessage: (message) => {
            console.log('📨 Mensaje recibido:', message);
            
            // Manejar diferentes tipos de respuesta
            if (message.data) {
              console.log('🎵 Reproduciendo audio de Gemini');
              playAudioResponse(message.data);
            }
            
            if (message.text) {
              console.log('💬 Texto de Gemini:', message.text);
              addMessage(message.text, 'assistant');
            }
          },
          onerror: (error) => {
            console.error('❌ Error en Gemini:', error);
            toast({
              title: "Error de conexión",
              description: "Error en la comunicación con Gemini: " + error.message,
              variant: "destructive"
            });
            setState('idle');
          },
          onclose: (event) => {
            console.log('🔌 Conexión cerrada:', event.reason);
            addMessage("Conexión con Gemini cerrada", 'assistant');
          }
        },
        config
      });
      
      sessionRef.current = session;
      return session;
    } catch (error) {
      console.error('Error inicializando Gemini:', error);
      toast({
        title: "Error de inicialización",
        description: "No se pudo inicializar el asistente de voz: " + error.message,
        variant: "destructive"
      });
      return null;
    }
  }, [toast, addMessage, playAudioResponse]);

  const startListening = useCallback(async () => {
    try {
      setState('listening');
      
      // Inicializar sesión de Gemini si no existe
      if (!sessionRef.current) {
        const session = await initializeGeminiSession();
        if (!session) {
          setState('idle');
          return;
        }
      }
      
      // Obtener acceso al micrófono con configuración óptima para streaming
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      
      streamRef.current = stream;
      
      // Configurar MediaRecorder para streaming continuo
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      
      // Enviar chunks de audio en tiempo real cada 250ms
      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0 && sessionRef.current) {
          await processAudioForGemini(event.data);
        }
      };
      
      // Iniciar grabación con chunks pequeños para streaming continuo
      mediaRecorder.start(250); // Enviar audio cada 250ms para verdadero tiempo real
      
      addMessage("Conversación iniciada - Hablando en tiempo real...", 'user');
      
    } catch (error) {
      console.error('Error iniciando grabación:', error);
      toast({
        title: "Error de micrófono",
        description: "No se pudo acceder al micrófono",
        variant: "destructive"
      });
      setState('idle');
    }
  }, [initializeGeminiSession, addMessage, toast]);

  const stopListening = useCallback(() => {
    setState('idle');
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    addMessage("Conversación finalizada", 'user');
  }, [addMessage]);

  const processAudioForGemini = useCallback(async (audioBlob: Blob) => {
    try {
      // Convertir WebM a PCM para Gemini
      const arrayBuffer = await audioBlob.arrayBuffer();
      
      // Crear AudioContext para procesar el audio
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Convertir a mono y resamplear a 16kHz si es necesario
      const channelData = audioBuffer.getChannelData(0);
      const targetSampleRate = 16000;
      const targetLength = Math.floor(channelData.length * targetSampleRate / audioBuffer.sampleRate);
      
      // Crear PCM de 16 bits
      const pcmData = new Int16Array(targetLength);
      for (let i = 0; i < targetLength; i++) {
        const sourceIndex = Math.floor(i * audioBuffer.sampleRate / targetSampleRate);
        pcmData[i] = Math.max(-32768, Math.min(32767, channelData[sourceIndex] * 32767));
      }
      
      // Convertir a base64
      const uint8Array = new Uint8Array(pcmData.buffer);
      let base64Audio = '';
      const chunkSize = 8192;
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.slice(i, i + chunkSize);
        base64Audio += btoa(String.fromCharCode.apply(null, Array.from(chunk)));
      }
      
      console.log('Enviando audio PCM a Gemini, tamaño:', pcmData.length);
      
      if (sessionRef.current) {
        await sessionRef.current.sendRealtimeInput({
          audio: {
            data: base64Audio,
            mimeType: "audio/pcm;rate=16000"
          }
        });
      }
      
      audioContext.close();
    } catch (error) {
      console.error('Error procesando audio:', error);
    }
  }, []);

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