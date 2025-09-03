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
      
      // URL corregida con v1beta (no v1alpha)
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;
      
      const websocket = new WebSocket(wsUrl);
      
      const liveSession = {
        ws: websocket,
        connected: false,
        setupSent: false,
        setupComplete: false,
        send: (data: any) => {
          if (websocket.readyState === WebSocket.OPEN) {
            console.log('📤 Enviando mensaje:', JSON.stringify(data, null, 2));
            websocket.send(JSON.stringify(data));
          }
        },
        close: () => {
          websocket.close();
        }
      };

      websocket.onopen = () => {
        console.log('✅ Conexión WebSocket establecida');
        liveSession.connected = true;
        
        // Setup message simplificado y corregido
        const setupMessage = {
          setup: {
            model: "models/gemini-2.0-flash-exp",
            generationConfig: {
              responseModalities: ["AUDIO", "TEXT"]
            }
          }
        };
        
        console.log('📤 Enviando setup:', JSON.stringify(setupMessage, null, 2));
        liveSession.send(setupMessage);
        liveSession.setupSent = true;
        
        // Timeout para considerar setup completo si no recibimos confirmación
        setTimeout(() => {
          if (liveSession.connected && !liveSession.setupComplete) {
            console.log('⚠️ Timeout en setup - asumiendo completado');
            addMessage("✅ Conexión establecida - Puedes empezar a hablar", 'assistant');
            setState('listening');
            liveSession.setupComplete = true;
          }
        }, 3000);
      };

      websocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('📨 Mensaje completo recibido:', JSON.stringify(message, null, 2));
          
          // Manejar confirmación de configuración
          if (message.setupComplete) {
            console.log('✅ Setup completado exitosamente');
            liveSession.setupComplete = true;
            addMessage("✅ Conexión establecida - Puedes empezar a hablar", 'assistant');
            setState('listening');
            return;
          }
          
          // Manejar errores de configuración
          if (message.error) {
            console.error('❌ Error en setup:', message.error);
            toast({
              title: "Error de configuración",
              description: `Error: ${message.error.message || 'Configuración inválida'}`,
              variant: "destructive"
            });
            setState('idle');
            stopAudioProcessing();
            return;
          }
          
          // Manejar contenido del servidor
          if (message.serverContent?.modelTurn?.parts) {
            const parts = message.serverContent.modelTurn.parts;
            for (const part of parts) {
              if (part.inlineData?.mimeType?.includes('audio') && part.inlineData.data) {
                const audioData = new Uint8Array(atob(part.inlineData.data).split('').map(char => char.charCodeAt(0)));
                playAudioResponse(audioData);
              }
              
              if (part.text) {
                addMessage(part.text, 'assistant');
              }
            }
          }

          if (message.serverContent?.turnComplete) {
            console.log('✅ Turno completado');
            setState('listening');
          }
        } catch (error) {
          console.error('❌ Error parseando mensaje:', error, 'Mensaje raw:', event.data);
        }
      };

      websocket.onerror = (error) => {
        console.error('❌ Error WebSocket:', error);
        toast({
          title: "Error de conexión",
          description: "Error en la conexión WebSocket. Verifica tu API key.",
          variant: "destructive"
        });
        setState('idle');
        stopAudioProcessing();
      };

      websocket.onclose = (event) => {
        console.log('🔌 Conexión cerrada. Código:', event.code, 'Razón:', event.reason, 'WasClean:', event.wasClean);
        liveSession.connected = false;
        
        // Solo mostrar mensaje si el setup se había enviado correctamente
        if (liveSession.setupSent && event.wasClean) {
          addMessage("✅ Conversación terminada", 'assistant');
        } else if (!event.wasClean) {
          console.error('❌ Conexión cerrada inesperadamente');
          toast({
            title: "Error de conexión",
            description: `Conexión cerrada inesperadamente. Código: ${event.code}`,
            variant: "destructive"
          });
        }
        
        setState('idle');
        stopAudioProcessing();
      };
      
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
      console.log('🎤 startListening - Estado actual:', state);
      
      if (state !== 'idle') {
        console.log('⚠️ Ya está activo, cancelando');
        return; // Evitar iniciar si ya está activo
      }

      console.log('🔄 Cambiando estado a processing...');
      setState('processing'); // Estado intermedio mientras se inicializa

      // Inicializar AudioContext si no existe
      if (!audioContextRef.current) {
        console.log('🔊 Inicializando AudioContext...');
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        // Cargar AudioWorklet module
        console.log('📡 Cargando AudioWorklet...');
        await audioContextRef.current.audioWorklet.addModule('/audio-processor.js');
        console.log('✅ AudioWorklet cargado');
      }

      // Obtener acceso al micrófono
      console.log('🎤 Solicitando acceso al micrófono...');
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      console.log('✅ Micrófono obtenido');
      addMessage("🎤 Micrófono activado", 'user');

      // Crear fuente de audio desde el micrófono
      const source = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
      
      // Crear AudioWorkletNode
      audioProcessorNodeRef.current = new AudioWorkletNode(audioContextRef.current, 'audio-processor');
      source.connect(audioProcessorNodeRef.current);
      // NO conectar a destination para evitar feedback del micrófono

      // Inicializar sesión de Gemini Live API
      console.log('🔗 Inicializando sesión de Gemini...');
      const session = await initializeGeminiLiveSession();
      if (!session) {
        console.error('❌ No se pudo inicializar la sesión');
        stopAudioProcessing();
        return;
      }
      console.log('✅ Sesión de Gemini inicializada');

      // Enviar audio procesado a Gemini
      audioProcessorNodeRef.current.port.onmessage = (event) => {
        if (liveSessionRef.current && liveSessionRef.current.connected) {
          const pcmData = new Int16Array(event.data);
          
          // Verificar si hay audio real (no solo silencio)
          const hasAudio = pcmData.some(sample => Math.abs(sample) > 100);
          
          if (hasAudio) {
            // Convertir PCM a base64 para el nuevo SDK
            const base64Audio = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
            
            // Enviar audio usando el formato oficial de la API con mimeType consistente
            liveSessionRef.current.send({
              clientContent: {
                turns: [{
                  parts: [{
                    inlineData: {
                      mimeType: "audio/pcm;rate=16000",
                      data: base64Audio
                    }
                  }]
                }],
                turnComplete: false
              }
            });
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
    console.log('🎯 handleToggleConversation - Estado actual:', state);
    
    if (state === 'idle') {
      console.log('🚀 Iniciando conversación...');
      startListening();
    } else {
      console.log('🛑 Deteniendo conversación...');
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