const API_URL = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '');

// URLs específicas para diferentes servicios
export const API_URLS = {
  MAIN: API_URL,
  AI: (import.meta.env.VITE_AI_ENGINE_URL || 'http://localhost:8000').replace(/\/$/, ''),
  ALTERNATIVE_AI: (import.meta.env.VITE_AI_ENGINE_URL_ALT || 'http://localhost:8003').replace(/\/$/, '')
};

export default API_URL;
