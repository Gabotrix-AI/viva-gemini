import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  
  const liveSessionRef = useRef<any | null>(null); // Referencia a la sesión de Gemini Live
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioProcessorNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioQueueRef = useRef<Uint8Array[]>([]); // Cola para chunks de audio de Gemini
  const isPlayingRef = useRef(false); // Para controlar la reproducción de audio

  // AVISO DE SEGURIDAD: Esta clave está hardcodeada para este ejercicio.
  // En un entorno de producción, DEBES usar variables de entorno o un proxy seguro.
  const GEMINI_API_KEY = 'AIzaSyCO4XPD1q024prR1VRNd6xAg-1igH07TTw'; // ¡REEMPLAZA CON TU CLAVE REAL!

  const addMessage = useCallback((content: string, type: 'user' | 'assistant') => {
    const newMessage: Message = {
      id: Date.now().toString(),
      type,
      content,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newMessage]);
  }, []);

  const playAudioResponse = useCallback(async (audioData: Uint8Array) => {
    if (!audioContextRef.current) {
      console.error('❌ AudioContext no disponible para reproducción.');
      return;
    }

    audioQueueRef.current.push(audioData);
    if (!isPlayingRef.current) {
      isPlayingRef.current = true;
      playNextAudioChunk();
    }
  }, []);

  const playNextAudioChunk = useCallback(async () => {
    if (audioQueueRef.current.length > 0 && audioContextRef.current) {
      const audioData = audioQueueRef.current.shift();
      if (!audioData) return; // Asegurarse de que hay datos

      try {
        // La decodificación de audio debe ser de un ArrayBuffer, no directamente de Uint8Array
        const audioBuffer = await audioContextRef.current.decodeAudioData(audioData.buffer);
        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
        
        source.onended = () => {
          // Cuando un chunk termina, reproducir el siguiente
          playNextAudioChunk();
        };
        source.start(0);
        setState('speaking');
      } catch (error) {
        console.error('❌ Error decodificando/reproduciendo audio:', error);
        isPlayingRef.current = false; // Detener reproducción si hay error
        setState('listening'); // Volver a escuchar
      }
    } else {
      isPlayingRef.current = false;
      setState('listening'); // Volver a escuchar cuando la cola está vacía
    }
  }, []);

  const initializeGeminiLiveSession = useCallback(async () => {
    try {
      if (!GEMINI_API_KEY) {
        toast({
          title: "Error de configuración",
          description: "Por favor, configura tu API key de Gemini.",
          variant: "destructive"
        });
        return null;
      }

      console.log('🔄 Conectando con Gemini Live API...');
      
      const GoogleGenAIModule = await import('@google/genai');
      console.log('📦 Módulo Gemini disponibles:', Object.keys(GoogleGenAIModule));
      
      // CORRECCIÓN CRÍTICA: Usar GoogleGenAI y Live del nuevo SDK @google/genai
      const { GoogleGenAI, Live } = GoogleGenAIModule as any;
      
      if (!GoogleGenAI || !Live) {
        throw new Error(`GoogleGenAI o Live no disponibles. Exports: ${Object.keys(GoogleGenAIModule).join(', ')}`);
      }
      
      // Crear cliente de Gemini
      const client = new GoogleGenAI(GEMINI_API_KEY);
      
      // Crear sesión Live
      const liveSession = new Live({
        client,
        model: 'gemini-2.0-flash-exp',
        config: {
          responseModalities: ['audio', 'text']
        }
      });

      liveSession.on('open', () => {
        console.log('✅ Conexión establecida con Gemini Live API');
        addMessage("✅ Conexión establecida - Puedes empezar a hablar", 'assistant');
        setState('listening');
      });

      liveSession.on('message', (message) => {
        console.log('📨 Mensaje recibido de Gemini:', JSON.stringify(message, null, 2));
        
        if (message.data?.parts) {
          const parts = message.data.parts;
          for (const part of parts) {
            if (part.inlineData?.mimeType?.includes('audio') && part.inlineData.data) {
              // Convertir base64 a Uint8Array
              const audioData = new Uint8Array(atob(part.inlineData.data).split('').map(char => char.charCodeAt(0)));
              playAudioResponse(audioData);
            }
            
            if (part.text) {
              addMessage(part.text, 'assistant');
            }
          }
        }

        if (message.turnComplete) {
          console.log('✅ Turno completado');
          setState('listening');
        }
      });

      liveSession.on('error', (error) => {
        console.error('❌ Error en Gemini Live API:', error);
        toast({
          title: "Error de conexión",
          description: `Error: ${error.message}`,
          variant: "destructive"
        });
        setState('idle');
        stopAudioProcessing();
      });

      liveSession.on('close', (event) => {
        console.log('🔌 Conexión cerrada:', event);
        addMessage("✅ Conversación terminada", 'assistant');
        setState('idle');
        stopAudioProcessing();
      });

      // Conectar la sesión
      await liveSession.connect();
      
      liveSessionRef.current = liveSession;
      return liveSession;
      
    } catch (error: any) {
      console.error('❌ Error inicializando Gemini Live API:', error);
      toast({
        title: "Error de inicialización",
        description: `No se pudo conectar: ${error.message}`,
        variant: "destructive"
      });
      setState('idle');
      return null;
    }
  }, [addMessage, playAudioResponse, toast, GEMINI_API_KEY]);

  const startListening = useCallback(async () => {
    try {
      if (state !== 'idle') return; // Evitar iniciar si ya está activo

      setState('processing'); // Estado intermedio mientras se inicializa

      // Inicializar AudioContext si no existe
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        // Cargar AudioWorklet module
        await audioContextRef.current.audioWorklet.addModule('/audio-processor.js');
      }

      // Obtener acceso al micrófono
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      addMessage("🎤 Micrófono activado", 'user');

      // Crear fuente de audio desde el micrófono
      const source = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
      
      // Crear AudioWorkletNode
      audioProcessorNodeRef.current = new AudioWorkletNode(audioContextRef.current, 'audio-processor');
      source.connect(audioProcessorNodeRef.current);
      audioProcessorNodeRef.current.connect(audioContextRef.current.destination); // Conectar para que el usuario se escuche a sí mismo (opcional)

      // Inicializar sesión de Gemini Live API
      const session = await initializeGeminiLiveSession();
      if (!session) {
        stopAudioProcessing();
        return;
      }

      // Enviar audio procesado a Gemini
      audioProcessorNodeRef.current.port.onmessage = (event) => {
        if (liveSessionRef.current && liveSessionRef.current.connected) {
          const pcmData = new Int16Array(event.data);
          
          // Convertir PCM a base64 para el nuevo SDK
          const base64Audio = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
          
          // Enviar usando la nueva estructura del SDK @google/genai
          liveSessionRef.current.send({
            parts: [{
              inlineData: {
                mimeType: "audio/pcm;rate=16000;channels=1",
                data: base64Audio
              }
            }]
          });
        }
      };

    } catch (error: any) {
      console.error('❌ Error iniciando grabación:', error);
      toast({
        title: "Error de micrófono",
        description: `No se pudo acceder al micrófono: ${error.message}`,
        variant: "destructive"
      });
      setState('idle');
      stopAudioProcessing();
    }
  }, [addMessage, initializeGeminiLiveSession, toast, state]);

  const stopAudioProcessing = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioProcessorNodeRef.current) {
      audioProcessorNodeRef.current.disconnect();
      audioProcessorNodeRef.current = null;
    }
    if (liveSessionRef.current) {
      try {
        liveSessionRef.current.close();
      } catch (error) {
        console.error('Error cerrando sesión de Gemini:', error);
      }
      liveSessionRef.current = null;
    }
    // No cerrar AudioContext aquí para permitir reproducción de audio en cola
    // if (audioContextRef.current) {
    //   audioContextRef.current.close();
    //   audioContextRef.current = null;
    // }
    isPlayingRef.current = false;
    audioQueueRef.current = [];
  }, []);

  const handleToggleConversation = useCallback(() => {
    if (state === 'idle') {
      startListening();
    } else {
      stopAudioProcessing();
      setState('idle');
      addMessage("🛑 Conversación finalizada", 'user');
    }
  }, [state, startListening, stopAudioProcessing, addMessage]);

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
          text: 'Iniciar Conversación', 
          icon: <Mic className="w-4 h-4" />, 
          className: 'status-indicator' 
        };
    }
  };

  const statusConfig = getStatusConfig(state);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-md shadow-lg rounded-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Asistente de Voz con Gemini AI</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center space-y-6">
          <Button 
            onClick={handleToggleConversation} 
            className={`w-48 h-48 rounded-full flex items-center justify-center text-white text-lg font-semibold shadow-xl 
              ${state === 'listening' ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'}
            `}
          >
            {state === 'idle' ? 'Iniciar Conversación' : 'Detener Conversación'}
          </Button>
          <Badge 
            variant="outline" 
            className={`px-4 py-2 text-md flex items-center space-x-2 
              ${statusConfig.className}
            `}
          >
            {statusConfig.icon}
            <span>{statusConfig.text}</span>
          </Badge>
          <div className="w-full h-64 overflow-y-auto border rounded-md p-4 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200">
            {messages.map((msg) => (
              <div key={msg.id} className={`mb-2 ${msg.type === 'user' ? 'text-right' : 'text-left'}`}>
                <span className={`inline-block p-2 rounded-lg ${msg.type === 'user' ? 'bg-blue-100 dark:bg-blue-800' : 'bg-green-100 dark:bg-green-800'}`}>
                  {msg.content}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default VoiceAssistant;