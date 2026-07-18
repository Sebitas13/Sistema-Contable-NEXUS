import React, { useId, useMemo, useRef, useEffect, useState } from 'react';

/**
 * Sparkline - Mini gráfico de tendencia con efecto neón premium.
 *
 * SVG puro sin dependencias. Incluye:
 * - Filtro de brillo neón para proyectar un halo futurista.
 * - Animación de trazo al montar (stroke-dasharray / dashoffset).
 * - Punto final pulsante para enfatizar el estado actual.
 *
 * props:
 *  - data:        number[]  serie de valores (orden cronológico)
 *  - width, height: dimensiones del lienzo
 *  - color:       color de la línea/relleno
 *  - strokeWidth: grosor de la línea
 */
export default function Sparkline({ data = [], width = 120, height = 32, color = '#3b82f6', strokeWidth = 2 }) {
    const gradId = useId();
    const glowId = useId();
    const pathRef = useRef(null);
    const [mounted, setMounted] = useState(false);

    if (!Array.isArray(data) || data.length < 2) return null;

    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const stepX = width / (data.length - 1);
    const pad = strokeWidth;

    const points = data.map((v, i) => {
        const x = i * stepX;
        const y = pad + (1 - (v - min) / range) * (height - pad * 2);
        return [x, y];
    });

    const linePath = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
    const [lastX, lastY] = points[points.length - 1];

    // Calculate total path length for stroke animation
    const totalLength = useMemo(() => {
        let len = 0;
        for (let i = 1; i < points.length; i++) {
            const dx = points[i][0] - points[i - 1][0];
            const dy = points[i][1] - points[i - 1][1];
            len += Math.sqrt(dx * dx + dy * dy);
        }
        return len;
    }, [data, width, height]);

    // Trigger stroke draw animation on mount
    useEffect(() => {
        const timer = requestAnimationFrame(() => setMounted(true));
        return () => cancelAnimationFrame(timer);
    }, []);

    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            style={{ display: 'block', overflow: 'visible' }}
        >
            <defs>
                {/* Gradient fill for area */}
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.30" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>

                {/* Neon glow filter */}
                <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
                    <feColorMatrix in="blur" type="matrix"
                        values="1 0 0 0 0
                                0 1 0 0 0
                                0 0 1 0 0
                                0 0 0 0.6 0"
                        result="glow" />
                    <feMerge>
                        <feMergeNode in="glow" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
            </defs>

            {/* Area fill (fades in) */}
            <path
                d={areaPath}
                fill={`url(#${gradId})`}
                style={{
                    opacity: mounted ? 1 : 0,
                    transition: 'opacity 0.8s ease 0.4s',
                }}
            />

            {/* Neon glow shadow line */}
            <path
                d={linePath}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth + 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                filter={`url(#${glowId})`}
                style={{
                    opacity: mounted ? 0.5 : 0,
                    transition: 'opacity 0.6s ease 0.3s',
                }}
            />

            {/* Main line with stroke draw animation */}
            <path
                ref={pathRef}
                d={linePath}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeLinejoin="round"
                strokeLinecap="round"
                style={{
                    strokeDasharray: totalLength,
                    strokeDashoffset: mounted ? 0 : totalLength,
                    transition: `stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)`,
                }}
            />

            {/* End dot with pulsing glow */}
            <circle
                cx={lastX}
                cy={lastY}
                r={strokeWidth + 1}
                fill={color}
                style={{
                    opacity: mounted ? 1 : 0,
                    transition: 'opacity 0.3s ease 0.9s',
                }}
            />
            {/* Pulsing outer ring */}
            <circle
                cx={lastX}
                cy={lastY}
                r={strokeWidth + 3}
                fill="none"
                stroke={color}
                strokeWidth="1"
                style={{
                    opacity: mounted ? 0.6 : 0,
                    transition: 'opacity 0.3s ease 0.9s',
                    animation: mounted ? 'sparkline-pulse 2s ease-in-out infinite' : 'none',
                }}
            />

            {/* Inline CSS for pulse animation */}
            <style>{`
                @keyframes sparkline-pulse {
                    0%, 100% { opacity: 0.6; r: ${strokeWidth + 3}; }
                    50% { opacity: 0.15; r: ${strokeWidth + 7}; }
                }
            `}</style>
        </svg>
    );
}
