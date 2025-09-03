import React, { useState, useRef, useCallback } from 'react';
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
  
  const liveSessionRef = useRef<any>(null); // Referencia a la sesión de Gemini Live
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

  const initializeGeminiSession = useCallback(async () => {
    try {
      if (!GEMINI_API_KEY) {
        toast({
          title: "Error de configuración",
          description: "Por favor, configura tu API key de Gemini.",
          variant: "destructive"
        });
        return null;
      }

      console.log('🔄 Inicializando Gemini Live API...');
      
      const genaiModule = await import('@google/genai');
      console.log('📦 Módulo Gemini disponibles:', Object.keys(genaiModule));
      
      // Usar any para acceder a los exports del módulo
      const GoogleAI = (genaiModule as any).GoogleGenerativeAI || 
                       (genaiModule as any).GoogleAI || 
                       (genaiModule as any).default ||
                       genaiModule;
      
      if (!GoogleAI) {
        throw new Error(`GoogleAI no disponible. Exports: ${Object.keys(genaiModule).join(', ')}`);
      }
      
      console.log('🤖 Creando cliente Google AI...');
      const genAI = new GoogleAI(GEMINI_API_KEY);
      
      console.log('📋 Obteniendo modelo...');
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-2.0-flash-exp'
      });

      console.log('💬 Iniciando chat...');
      const chat = model.startChat({
        history: [],
        systemInstruction: 'Eres un asistente de voz amigable que habla en español.'
      });

      console.log('🎙️ Intentando obtener sesión Live...');
      
      // Diferentes métodos posibles para Live Session
      let session;
      if (typeof chat.getLiveSession === 'function') {
        session = await chat.getLiveSession({
          audioInputConfig: { sampleRateHz: 16000, encoding: 'LINEAR16' },
          audioOutputConfig: { sampleRateHz: 24000, encoding: 'LINEAR16' },
          responseModalities: ['AUDIO', 'TEXT']
        });
      } else if (typeof model.startLiveSession === 'function') {
        session = await model.startLiveSession({
          audioInputConfig: { sampleRateHz: 16000, encoding: 'LINEAR16' },
          audioOutputConfig: { sampleRateHz: 24000, encoding: 'LINEAR16' }
        });
      } else {
        throw new Error('Live Session no disponible en este modelo');
      }

      console.log('✅ Sesión Live creada:', session);

      if (typeof session.on === 'function') {
        session.on('message', (message: any) => {
          console.log('📨 Mensaje:', message);
          
          if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.inlineData?.mimeType?.includes('audio') && part.inlineData.bytes) {
                playAudioResponse(part.inlineData.bytes);
              }
              if (part.text) {
                addMessage(part.text, 'assistant');
              }
            }
          }

          if (message.serverContent?.turnComplete) {
            setState('listening');
          }
        });

        session.on('error', (error: any) => {
          console.error('❌ Error:', error);
          toast({
            title: "Error de conexión",
            description: `Error: ${error.message}`,
            variant: "destructive"
          });
          setState('idle');
          stopAudioProcessing();
        });

        session.on('close', () => {
          console.log('🔌 Sesión cerrada');
          addMessage("🔌 Conexión cerrada", 'assistant');
          setState('idle');
          stopAudioProcessing();
        });
      }
      
      liveSessionRef.current = session;
      return session;
    } catch (error: any) {
      console.error('❌ Error:', error);
      toast({
        title: "Error de inicialización", 
        description: error.message,
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
      const session = await initializeGeminiSession();
      if (!session) {
        stopAudioProcessing();
        return;
      }

      // Enviar audio procesado a Gemini
      audioProcessorNodeRef.current.port.onmessage = (event) => {
        if (liveSessionRef.current) {
          const pcmData = new Int16Array(event.data);
          const uint8Array = new Uint8Array(pcmData.buffer);
          
          // Crear Part para el audio según el SDK de Gemini
          const audioPart = {
            inlineData: {
              bytes: uint8Array,
              mimeType: "audio/pcm;rate=16000",
            },
          };
          
          try {
            console.log('🎵 Enviando audio chunk...');
            liveSessionRef.current.send([audioPart]);
          } catch (error) {
            console.error('❌ Error enviando audio:', error);
          }
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
  }, [addMessage, initializeGeminiSession, toast, state]);

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