const API_URL = import.meta.env.VITE_API_URL;

// URLs específicas para diferentes servicios
export const API_URLS = {
  MAIN: API_URL,
  AI: import.meta.env.VITE_AI_ENGINE_URL,
  ALTERNATIVE_AI: import.meta.env.VITE_AI_ENGINE_URL_ALT
};

export default API_URL;
