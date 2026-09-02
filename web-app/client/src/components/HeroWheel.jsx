import React from 'react';
import MahoragaWheel from './MahoragaWheel';

/**
 * HeroWheel — presentación premium del emblema (rueda de ocho empuñaduras).
 *
 * Reemplaza al render WebGL en pantallas de presentación (selector de empresa,
 * login): el SVG original es más nítido a cualquier tamaño y las capas CSS
 * (halo pulsante + órbitas con satélites) dan el efecto "joya" sin coste de GPU.
 */
export default function HeroWheel({ size = 170 }) {
    const wheelSize = Math.round(size * 0.72);
    return (
        <div
            className="hero-wheel"
            style={{ width: size, height: size }}
            aria-hidden="true"
        >
            <div className="hero-wheel-halo"></div>
            <div className="hero-wheel-orbit"></div>
            <div className="hero-wheel-orbit hero-wheel-orbit-2"></div>
            <div className="hero-wheel-core">
                <MahoragaWheel size={wheelSize} spinning color="#FFD700" />
            </div>
        </div>
    );
}
