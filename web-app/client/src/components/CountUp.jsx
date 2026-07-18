import React, { useEffect, useRef, useState, useMemo } from 'react';

/**
 * CountUp - Anima un número con efecto de brillo y escala sutil.
 *
 * Al actualizar el valor destino, la cifra se interpola con easeOutCubic,
 * emite un pulso de brillo (verde = incremento, rojo = decremento) y una
 * micro-escala elástica. Respeta prefers-reduced-motion.
 *
 * props:
 *  - value:    número destino
 *  - duration: ms de la interpolación (defecto 900)
 *  - format:   función de formateo (recibe float, devuelve string)
 */
export default function CountUp({ value = 0, duration = 900, format = (v) => Math.round(v).toLocaleString() }) {
    const [display, setDisplay] = useState(value);
    const fromRef = useRef(value);
    const rafRef = useRef(null);
    const prevRef = useRef(value);
    const [flash, setFlash] = useState(null); // 'up' | 'down' | null

    // Detect change direction for glow effect
    const direction = useMemo(() => {
        const to = Number(value) || 0;
        const prev = Number(prevRef.current) || 0;
        if (to > prev) return 'up';
        if (to < prev) return 'down';
        return null;
    }, [value]);

    useEffect(() => {
        const to = Number(value) || 0;
        const from = Number(fromRef.current) || 0;

        // Accesibilidad: sin animación si el usuario la desactivó.
        const reduce = typeof window !== 'undefined' &&
            window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce || from === to) {
            setDisplay(to);
            fromRef.current = to;
            prevRef.current = to;
            return;
        }

        // Trigger flash
        if (from !== to) {
            setFlash(direction);
            const timer = setTimeout(() => setFlash(null), 600);

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
                    prevRef.current = to;
                }
            };
            rafRef.current = requestAnimationFrame(tick);

            return () => {
                cancelAnimationFrame(rafRef.current);
                clearTimeout(timer);
            };
        }
    }, [value, duration, direction]);

    // Determine glow color and animation
    const glowStyle = useMemo(() => {
        if (!flash) return {};
        const color = flash === 'up'
            ? 'rgba(16, 185, 129, 0.5)'  // green for positive change
            : 'rgba(239, 68, 68, 0.5)';  // red for negative change
        return {
            textShadow: `0 0 12px ${color}, 0 0 4px ${color}`,
            transform: 'scale(1.04)',
        };
    }, [flash]);

    return (
        <span
            style={{
                display: 'inline-block',
                transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), text-shadow 0.3s ease',
                willChange: 'transform, text-shadow',
                ...glowStyle,
            }}
        >
            {format(display)}
        </span>
    );
}
