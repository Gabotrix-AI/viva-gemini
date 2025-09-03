import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Mic, Volume2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useConversation } from '@11labs/react';

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
  const [apiKey, setApiKey] = useState('');
  const { toast } = useToast();
  
  const conversation = useConversation({
    onConnect: () => {
      console.log('✅ Conectado a ElevenLabs');
      addMessage("✅ Conexión establecida - Puedes empezar a hablar", 'assistant');
      setState('listening');
    },
    onDisconnect: () => {
      console.log('🔌 Desconectado de ElevenLabs');
      addMessage("✅ Conversación terminada", 'assistant');
      setState('idle');
    },
    onMessage: (message) => {
      console.log('📨 Mensaje de ElevenLabs:', message);
      
      if (message.type === 'user_transcript') {
        addMessage(message.message, 'user');
      } else if (message.type === 'agent_response') {
        addMessage(message.message, 'assistant');
        setState('speaking');
      }
    },
    onError: (error) => {
      console.error('❌ Error ElevenLabs:', error);
      toast({
        title: "Error de conexión",
        description: `Error: ${error.message}`,
        variant: "destructive"
      });
      setState('idle');
    }
  });

  const addMessage = useCallback((content: string, type: 'user' | 'assistant') => {
    const newMessage: Message = {
      id: Date.now().toString(),
      type,
      content,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newMessage]);
  }, []);

  const handleToggleConversation = useCallback(async () => {
    if (state === 'idle') {
      if (!apiKey) {
        toast({
          title: "API Key requerida",
          description: "Por favor ingresa tu API key de ElevenLabs",
          variant: "destructive"
        });
        return;
      }

      setState('processing');
      
      try {
        // Solicitar acceso al micrófono primero
        await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Usar directamente con agentId público o URL firmada
        await conversation.startSession({ 
          agentId: "tu_agent_id_aqui" // Reemplazar con tu agent ID
        });
        
      } catch (error: any) {
        console.error('Error iniciando conversación:', error);
        toast({
          title: "Error",
          description: `No se pudo iniciar: ${error.message}`,
          variant: "destructive"
        });
        setState('idle');
      }
    } else {
      await conversation.endSession();
      setState('idle');
    }
  }, [state, apiKey, conversation, toast]);

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
          <CardTitle className="text-2xl font-bold">Asistente de Voz con ElevenLabs</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center space-y-6">
          {!apiKey && (
            <div className="w-full space-y-2">
              <label className="text-sm font-medium">API Key de ElevenLabs:</label>
              <input
                type="password"
                placeholder="Ingresa tu API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full p-2 border rounded"
              />
            </div>
          )}
          
          <Button 
            onClick={handleToggleConversation}
            disabled={!apiKey}
            className={`w-48 h-48 rounded-full flex items-center justify-center text-white text-lg font-semibold shadow-xl 
              ${state === 'listening' ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'}
              ${!apiKey ? 'opacity-50 cursor-not-allowed' : ''}
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