# Configuración de Gemini Live API

## ✅ Cambios realizados

1. **Instaladas dependencias de Firebase**:
   - `firebase@latest`
   - `@firebase/ai@latest`

2. **Creado archivo de configuración**: `src/lib/firebase.ts`
   - Configura Firebase App e inicializa Firebase AI

3. **Reescrito VoiceAssistant.tsx**:
   - Ahora usa Firebase SDK correctamente
   - Utiliza `getLiveGenerativeModel` y `startAudioConversation`
   - Maneja audio automáticamente sin WebSocket manual

4. **Eliminado**: `public/audio-processor.js` (ya no necesario)

## 🔧 Configuración requerida

### Actualizar API Key
En `src/lib/firebase.ts`, actualiza el `apiKey` con tu clave real de Google AI.

### Configuración Firebase (opcional)
Si tienes un proyecto Firebase, actualiza también:
- `authDomain`
- `projectId` 
- `storageBucket`
- `messagingSenderId`
- `appId`

## 🎯 Cómo funciona ahora

1. Presiona "Iniciar Conversación"
2. Firebase SDK se conecta automáticamente a Gemini Live
3. `startAudioConversation` maneja micrófono y audio automáticamente
4. El componente escucha respuestas y actualiza la UI

## 🚀 Ventajas de esta implementación

- ✅ Usa la API oficial de Firebase
- ✅ Manejo automático de audio (entrada y salida)
- ✅ Detección automática de actividad de voz
- ✅ Gestión de estado simplificada
- ✅ Sin WebSocket manual ni procesamiento de audio personalizado