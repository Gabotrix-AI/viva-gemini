import React, { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Mic, Volume2, Loader2 } from 'lucide-react';
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
  
  const websocketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioProcessorRef = useRef<AudioWorkletNode | null>(null);
  const isConnectedRef = useRef(false);

  // API Key - reemplazar con tu clave real
  const GEMINI_API_KEY = 'AIzaSyCO4XPD1q024prR1VRNd6xAg-1igH07TTw';

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
    try {
      if (!audioContextRef.current) return;
      
      const audioBuffer = await audioContextRef.current.decodeAudioData(audioData.buffer);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      
      setState('speaking');
      source.onended = () => setState('listening');
      source.start(0);
    } catch (error) {
      console.error('Error reproduciendo audio:', error);
    }
  }, []);

  const initializeWebSocket = useCallback(() => {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;
    
    websocketRef.current = new WebSocket(wsUrl);
    
    websocketRef.current.onopen = () => {
      console.log('🔗 WebSocket conectado');
      isConnectedRef.current = true;
      
      // Enviar setup básico
      const setupMessage = {
        setup: {
          model: "models/gemini-2.0-flash-exp",
          generationConfig: {
            responseModalities: ["AUDIO"]
          }
        }
      };
      
      console.log('📤 Enviando setup:', setupMessage);
      websocketRef.current?.send(JSON.stringify(setupMessage));
      
      // Marcar como listo después de 1 segundo
      setTimeout(() => {
        addMessage("✅ Conexión establecida - Puedes empezar a hablar", 'assistant');
        setState('listening');
      }, 1000);
    };
    
    websocketRef.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('📨 Respuesta completa:', JSON.stringify(message, null, 2));
        
        // Manejar respuestas de configuración
        if (message.setupComplete) {
          console.log('✅ Setup confirmado por Gemini');
          return;
        }
        
        // Manejar contenido del servidor
        if (message.serverContent) {
          console.log('🎯 Contenido del servidor recibido');
          
          // Buscar partes de audio
          if (message.serverContent.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.inlineData?.mimeType?.includes('audio') && part.inlineData.data) {
                console.log('🔊 Audio recibido de Gemini');
                const audioData = new Uint8Array(
                  atob(part.inlineData.data).split('').map(char => char.charCodeAt(0))
                );
                playAudioResponse(audioData);
              }
            }
          }
          
          // Manejar transcripciones si las hay
          if (message.serverContent.turnComplete) {
            console.log('✅ Turno completado');
            setState('listening');
          }
        }
      } catch (error) {
        console.error('Error procesando mensaje:', error);
      }
    };
    
    websocketRef.current.onerror = (error) => {
      console.error('❌ Error WebSocket:', error);
      toast({
        title: "Error de conexión",
        description: "Error en la conexión con Gemini",
        variant: "destructive"
      });
    };
    
    websocketRef.current.onclose = (event) => {
      console.log('🔌 WebSocket cerrado:', event.code, event.reason);
      isConnectedRef.current = false;
      setState('idle');
      if (event.code !== 1000) {
        toast({
          title: "Conexión perdida",
          description: `Código: ${event.code}. ${event.reason || 'Conexión cerrada inesperadamente'}`,
          variant: "destructive"
        });
      }
    };
  }, [addMessage, playAudioResponse, toast]);

  const setupAudio = useCallback(async () => {
    try {
      // Configurar AudioContext
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000
      });
      
      // Cargar AudioWorklet
      await audioContextRef.current.audioWorklet.addModule('/audio-processor.js');
      
      // Obtener micrófono
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      
      // Configurar procesamiento de audio
      const source = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
      audioProcessorRef.current = new AudioWorkletNode(audioContextRef.current, 'audio-processor');
      source.connect(audioProcessorRef.current);
      
      // Enviar audio a Gemini
      audioProcessorRef.current.port.onmessage = (event) => {
        if (!isConnectedRef.current || !websocketRef.current) return;
        
        const pcmData = new Int16Array(event.data);
        const hasAudio = pcmData.some(sample => Math.abs(sample) > 1000);
        
        if (hasAudio) {
          const base64Audio = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
          
          const audioMessage = {
            clientContent: {
              turns: [{
                parts: [{
                  inlineData: {
                    mimeType: "audio/pcm;rate=16000;channels=1",
                    data: base64Audio
                  }
                }]
              }],
              turnComplete: false
            }
          };
          
          websocketRef.current.send(JSON.stringify(audioMessage));
        }
      };
      
    } catch (error) {
      console.error('Error configurando audio:', error);
      throw error;
    }
  }, []);

  const cleanup = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    if (audioProcessorRef.current) {
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current = null;
    }
    
    if (websocketRef.current) {
      websocketRef.current.close();
      websocketRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    isConnectedRef.current = false;
  }, []);

  const handleToggleConversation = useCallback(async () => {
    if (state === 'idle') {
      setState('processing');
      
      try {
        await setupAudio();
        initializeWebSocket();
        addMessage("🎤 Micrófono activado", 'user');
      } catch (error: any) {
        console.error('Error iniciando conversación:', error);
        toast({
          title: "Error",
          description: `No se pudo iniciar: ${error.message}`,
          variant: "destructive"
        });
        setState('idle');
        cleanup();
      }
    } else {
      cleanup();
      setState('idle');
      addMessage("🛑 Conversación finalizada", 'user');
    }
  }, [state, setupAudio, initializeWebSocket, addMessage, cleanup, toast]);

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
          text: 'Conectando...', 
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
          <CardTitle className="text-2xl font-bold">Asistente de Voz con Gemini Live API</CardTitle>
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
            className={`px-4 py-2 text-md flex items-center space-x-2 ${statusConfig.className}`}
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