import React, { useEffect, useRef, useState } from 'react';

/**
 * CountUp - Anima un número desde su valor anterior hasta el nuevo.
 *
 * Uso diario: al refrescar el dashboard, los importes "suben" y el ojo detecta
 * al instante qué cambió. Respeta prefers-reduced-motion (salta directo al
 * valor). El formateo se delega a `format` para reutilizar formatCurrency, etc.
 */
export default function CountUp({ value = 0, duration = 900, format = (v) => Math.round(v).toLocaleString() }) {
    const [display, setDisplay] = useState(value);
    const fromRef = useRef(value);
    const rafRef = useRef(null);

    useEffect(() => {
        const to = Number(value) || 0;
        const from = Number(fromRef.current) || 0;

        // Accesibilidad: sin animación si el usuario la desactivó.
        const reduce = typeof window !== 'undefined' &&
            window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce || from === to) {
            setDisplay(to);
            fromRef.current = to;
            return;
        }

        const start = performance.now();
        const tick = (now) => {
            const t = Math.min(1, (now - start) / duration);
            // easeOutCubic para una desaceleración natural.
            const eased = 1 - Math.pow(1 - t, 3);
            setDisplay(from + (to - from) * eased);
            if (t < 1) {
                rafRef.current = requestAnimationFrame(tick);
            } else {
                fromRef.current = to;
            }
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [value, duration]);

    return <>{format(display)}</>;
}
