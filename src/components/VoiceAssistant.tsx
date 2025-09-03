import React, { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Mic, Volume2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getLiveGenerativeModel, ResponseModality, startAudioConversation } from '@firebase/ai';
import { ai } from '@/lib/firebase';

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
  const audioConversationControllerRef = useRef<any>(null);

  const addMessage = useCallback((content: string, type: 'user' | 'assistant') => {
    const newMessage: Message = {
      id: Date.now().toString(),
      type,
      content,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newMessage]);
  }, []);

  const initializeGeminiLive = useCallback(async () => {
    try {
      console.log('🚀 Inicializando Gemini Live API con Firebase SDK');
      setState('processing');

      // Crear el modelo Live con configuración de audio
      const model = getLiveGenerativeModel(ai, {
        model: "gemini-2.0-flash-live-preview-04-09",
        generationConfig: {
          responseModalities: [ResponseModality.AUDIO],
        },
      });

      console.log('📱 Conectando sesión...');
      const session = await model.connect();
      sessionRef.current = session;

      console.log('🎤 Iniciando conversación de audio...');
      const audioController = await startAudioConversation(session);
      audioConversationControllerRef.current = audioController;

      setState('listening');
      addMessage("✅ Gemini Live conectado - ¡Habla ahora!", 'assistant');

      // Escuchar mensajes del servidor en background
      (async () => {
        try {
          const messageStream = session.receive();
          for await (const message of messageStream) {
            console.log('📨 Mensaje recibido:', message);
            
            switch (message.type) {
              case "serverContent":
                if (message.turnComplete) {
                  console.log('✅ Turno completado');
                  setState('listening');
                } else {
                  // El audio se reproduce automáticamente por startAudioConversation
                  if (message.modelTurn?.parts) {
                    setState('speaking');
                    const textParts = message.modelTurn.parts
                      .filter((part: any) => part.text)
                      .map((part: any) => part.text)
                      .join('');
                    
                    if (textParts) {
                      addMessage(textParts, 'assistant');
                    }
                  }
                }
                break;
              case "toolCall":
                console.log('🔧 Tool call:', message);
                break;
              case "toolCallCancellation":
                console.log('❌ Tool call cancelado:', message);
                break;
            }
          }
        } catch (error: any) {
          console.error('❌ Error en stream de mensajes:', error);
          toast({
            title: "Error",
            description: "Error en la comunicación con Gemini",
            variant: "destructive"
          });
        }
      })();

    } catch (error: any) {
      console.error('❌ Error inicializando Gemini Live:', error);
      toast({
        title: "Error",
        description: `Error al conectar: ${error.message}`,
        variant: "destructive"
      });
      setState('idle');
    }
  }, [addMessage, toast]);

  const cleanup = useCallback(async () => {
    try {
      if (audioConversationControllerRef.current) {
        console.log('🛑 Deteniendo conversación de audio...');
        await audioConversationControllerRef.current.stop();
        audioConversationControllerRef.current = null;
      }
      
      if (sessionRef.current) {
        console.log('🔌 Cerrando sesión...');
        // La sesión se cierra automáticamente cuando se detiene la conversación
        sessionRef.current = null;
      }
    } catch (error) {
      console.error('Error en cleanup:', error);
    }
  }, []);

  const handleToggleConversation = useCallback(async () => {
    if (state === 'idle') {
      await initializeGeminiLive();
      addMessage("🎤 Micrófono activado", 'user');
    } else {
      await cleanup();
      setState('idle');
      addMessage("🛑 Conversación finalizada", 'user');
    }
  }, [state, initializeGeminiLive, cleanup, addMessage]);

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