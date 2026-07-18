import React, { useId } from 'react';

/**
 * Sparkline - Mini gráfico de tendencia en SVG puro (sin dependencias).
 *
 * Pensado para incrustarse en cabeceras/tarjetas: comunica de un vistazo la
 * evolución de una serie (p. ej. asientos por día) sin ocupar espacio ni
 * requerir WebGL. Si no hay datos suficientes, no renderiza nada.
 *
 * props:
 *  - data: number[]  serie de valores (orden cronológico)
 *  - width, height:  dimensiones del lienzo
 *  - color:          color de la línea/relleno
 */
export default function Sparkline({ data = [], width = 120, height = 32, color = '#3b82f6', strokeWidth = 2 }) {
    const gradId = useId();
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

    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'visible' }}>
            <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.35" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={areaPath} fill={`url(#${gradId})`} />
            <path d={linePath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={lastX} cy={lastY} r={strokeWidth + 1} fill={color} />
        </svg>
    );
}
