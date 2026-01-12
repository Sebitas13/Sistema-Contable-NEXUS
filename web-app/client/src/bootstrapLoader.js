// Bootstrap Loader - Carga dinámica para evitar problemas de build
export function loadBootstrap() {
  if (typeof window !== 'undefined') {
    // Cargar Bootstrap JS dinámicamente solo en el navegador
    const script = document.createElement('script');
    script.src = '/src/assets/bootstrap/js/bootstrap.bundle.min.js';
    script.async = true;
    document.head.appendChild(script);
  }
}
