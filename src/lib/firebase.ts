import { initializeApp } from 'firebase/app';
import { getAI, GoogleAIBackend } from '@firebase/ai';

// Configuración de Firebase - actualiza estos valores con tu proyecto real
const firebaseConfig = {
  apiKey: "AIzaSyCO4XPD1q024prR1VRNd6xAg-1igH07TTw",
  // Puedes usar valores dummy para testing si no tienes proyecto Firebase configurado
  authDomain: "dummy-project.firebaseapp.com",
  projectId: "dummy-project",
  storageBucket: "dummy-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};

// Inicializar Firebase
export const firebaseApp = initializeApp(firebaseConfig);

// Inicializar Firebase AI con backend de Google AI
export const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });