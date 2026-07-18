import { useEffect, useState } from 'react';

/**
 * useGLQuality - Decide si el fondo WebGL debe renderizarse y con qué calidad.
 *
 * Filosofía: la experiencia inmersiva nunca debe costar batería, fluidez ni
 * accesibilidad. Este hook centraliza todas las salvaguardas para que
 * AmbientCanvas (y cualquier escena 3D) pueda confiar en un único veredicto.
 *
 * Devuelve:
 *  - enabled: boolean  -> false = usar fallback CSS estático (sin WebGL)
 *  - dpr: [min, max]   -> device pixel ratio limitado (<= 1.5) para no fundir GPUs
 *  - paused: boolean   -> true cuando la pestaña está oculta (ahorro de recursos)
 *  - particleCount: número de partículas recomendado según la potencia estimada
 */
export function useGLQuality() {
    const [state, setState] = useState(() => computeInitialState());

    useEffect(() => {
        // 1. prefers-reduced-motion: respeto absoluto a la accesibilidad.
        const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        // 2. Pantallas pequeñas: en móviles priorizamos rendimiento -> fallback CSS.
        const smallQuery = window.matchMedia('(max-width: 768px)');

        const recompute = () => setState(prev => ({
            ...prev,
            enabled: resolveEnabled(motionQuery.matches, smallQuery.matches),
        }));

        // 3. Visibilidad de pestaña: pausamos el render loop cuando no se ve.
        const handleVisibility = () => setState(prev => ({
            ...prev,
            paused: document.visibilityState === 'hidden',
        }));

        addQueryListener(motionQuery, recompute);
        addQueryListener(smallQuery, recompute);
        document.addEventListener('visibilitychange', handleVisibility);
        handleVisibility();

        return () => {
            removeQueryListener(motionQuery, recompute);
            removeQueryListener(smallQuery, recompute);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, []);

    return state;
}

function computeInitialState() {
    if (typeof window === 'undefined') {
        return { enabled: false, dpr: [1, 1], paused: false, particleCount: 0 };
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const small = window.matchMedia('(max-width: 768px)').matches;
    const enabled = resolveEnabled(reduceMotion, small);

    // Estimación de potencia: núcleos lógicos + memoria del dispositivo.
    const cores = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory || 4;
    const strong = cores >= 8 && memory >= 8;

    return {
        enabled,
        dpr: [1, Math.min(window.devicePixelRatio || 1, 1.5)],
        paused: document.visibilityState === 'hidden',
        particleCount: strong ? 2600 : 1600,
    };
}

function resolveEnabled(reduceMotion, small) {
    if (reduceMotion || small) return false;
    return hasWebGL();
}

let _webglSupport = null;
function hasWebGL() {
    if (_webglSupport !== null) return _webglSupport;
    try {
        const canvas = document.createElement('canvas');
        _webglSupport = !!(window.WebGLRenderingContext &&
            (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch {
        _webglSupport = false;
    }
    return _webglSupport;
}

// Compatibilidad Safari < 14 (addEventListener no existía en MediaQueryList).
function addQueryListener(query, handler) {
    if (query.addEventListener) query.addEventListener('change', handler);
    else query.addListener(handler);
}
function removeQueryListener(query, handler) {
    if (query.removeEventListener) query.removeEventListener('change', handler);
    else query.removeListener(handler);
}

export default useGLQuality;
