import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Mic, MicOff, Volume2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
// MODIFICACIÓN CRÍTICA: Se manejará la importación dinámicamente para evitar errores de constructor

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

      // MODIFICACIÓN CRÍTICA: Importación dinámica de comodín para evitar constructor error
      console.log('🔄 Conectando con Gemini Live API...');
      
      const GoogleGenAIModule = await import('@google/genai');
      console.log('📦 Módulo Gemini disponibles:', Object.keys(GoogleGenAIModule));
      
      // CORRECCIÓN: Acceder a la exportación por defecto si GoogleGenerativeAI no está directamente disponible
      const GoogleGenerativeAI = (GoogleGenAIModule as any).GoogleGenerativeAI || (GoogleGenAIModule as any).default.GoogleGenerativeAI || (GoogleGenAIModule as any).default;
      
      if (!GoogleGenerativeAI) {
        throw new Error(`GoogleGenerativeAI no disponible. Exports: ${Object.keys(GoogleGenAIModule).join(', ')}`);
      }
      
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-preview-native-audio-dialog',
      });
      
      // LA CORRECCIÓN CRÍTICA: La forma correcta de obtener la LiveSession
      const liveSession = await model.startChat({
        history: [],
        generationConfig: {
          responseMimeType: 'application/json',
        },
        safetySettings: [],
      }).then((chat: any) => chat.getLiveSession({
        audioInputConfig: {
          sampleRateHz: 16000,
          encoding: 'LINEAR16',
        },
        audioOutputConfig: {
          sampleRateHz: 24000,
          encoding: 'LINEAR16',
        },
        responseModalities: ['AUDIO', 'TEXT'],
        systemInstruction: {
          parts: [
            {
              text: "Eres un asistente de voz amigable y servicial que habla en español. Responde de manera concisa y natural con audio cuando sea posible."
            }
          ]
        }
      }));

      liveSession.on('open', () => {
        console.log('✅ Conexión establecida con Gemini Live API');
        addMessage("✅ Conexión establecida - Puedes empezar a hablar", 'assistant');
        setState('listening');
      });

      liveSession.on('message', (message) => {
        console.log('📨 Mensaje recibido de Gemini:', JSON.stringify(message, null, 2));
        
        if (message.serverContent?.modelTurn?.parts) {
          const parts = message.serverContent.modelTurn.parts;
          for (const part of parts) {
            if (part.inlineData?.mimeType?.includes('audio') && part.inlineData.bytes) {
              // Gemini Live API devuelve audio como Uint8Array en .bytes
              playAudioResponse(part.inlineData.bytes);
            }
            
            if (part.text) {
              addMessage(part.text, 'assistant');
            }
          }
        }

        if (message.serverContent?.turnComplete) {
          console.log('✅ Turno completado');
          // El estado se gestiona por playNextAudioChunk para evitar interrupciones
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
        if (event.code === 1000) {
          addMessage("✅ Conexión cerrada normalmente", 'assistant');
        } else {
          addMessage(`⚠️ Conexión cerrada (código: ${event.code})`, 'assistant');
        }
        setState('idle');
        stopAudioProcessing();
      });
      
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
        if (liveSessionRef.current && liveSessionRef.current.state === 'open') {
          const pcmData = new Int16Array(event.data); // Recibe Int16Array del AudioWorklet
          const uint8Array = new Uint8Array(pcmData.buffer);
          
          // La LiveSession espera un array de Part, donde el audio va en inlineData.bytes
          const audioPart: any = {
            inlineData: {
              bytes: uint8Array, // Enviar Uint8Array directamente
              mimeType: "audio/pcm;rate=16000",
            },
          };
          liveSessionRef.current.send([audioPart]); // Usar el método send de LiveSession
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