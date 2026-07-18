import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useLocation } from 'react-router-dom';
import * as THREE from 'three';
import { useGLQuality } from './useGLQuality';

/**
 * AmbientCanvas - Fondo WebGL vivo, único y fijo para toda la app.
 *
 * Objetivo: aportar profundidad y "vida" sin robar protagonismo ni rendimiento.
 * - Un solo contexto WebGL a pantalla completa (position: fixed, detrás de todo).
 * - Nebulosa de partículas con la paleta de marca; el tono cambia según la ruta
 *   para dar identidad a cada sección (azul dashboard, verde reportes, etc.).
 * - Parallax sutil con el ratón. Rotación muy lenta y constante.
 * - Si WebGL no aplica (móvil / reduce-motion / sin soporte) -> gradiente CSS.
 */

// Paleta de marca (misma que index.css). Tono base por familia de ruta.
const ROUTE_HUES = {
    '/app': 0x3b82f6,          // Dashboard - azul
    '/app/reports': 0x10b981,  // Reportes - verde
    '/app/journal': 0x8b5cf6,  // Diario - violeta
    '/app/accounts': 0x3b82f6, // Plan de cuentas - azul
    '/app/fixed-assets': 0xf59e0b, // Activos - ámbar
    '/app/settings': 0x06b6d4, // Configuración - cian
    '/login': 0x6366f1,        // Login - índigo
    '/': 0x6366f1,             // Selector - índigo
};

function hueForPath(pathname) {
    if (ROUTE_HUES[pathname] !== undefined) return ROUTE_HUES[pathname];
    // Coincidencia por prefijo más específico.
    const match = Object.keys(ROUTE_HUES)
        .filter(k => k !== '/' && pathname.startsWith(k))
        .sort((a, b) => b.length - a.length)[0];
    return match ? ROUTE_HUES[match] : 0x3b82f6;
}

function Nebula({ count, targetColor }) {
    const pointsRef = useRef();
    const materialRef = useRef();
    const { size } = useThree();
    const mouse = useRef({ x: 0, y: 0 });
    const currentColor = useRef(new THREE.Color(0x3b82f6));
    const goalColor = useRef(new THREE.Color(targetColor));

    // Geometría generada una sola vez: nube esférica con densidad hacia el centro.
    const positions = useMemo(() => {
        const arr = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const r = Math.cbrt(Math.random()) * 9;      // radio con densidad central
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            arr[i * 3 + 2] = r * Math.cos(phi);
        }
        return arr;
    }, [count]);

    // Textura circular suave para partículas (evita cuadrados duros).
    const sprite = useMemo(() => {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        const tex = new THREE.CanvasTexture(c);
        return tex;
    }, []);

    useEffect(() => {
        goalColor.current.set(targetColor);
    }, [targetColor]);

    useEffect(() => {
        const onMove = (e) => {
            mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.current.y = (e.clientY / window.innerHeight) * 2 - 1;
        };
        window.addEventListener('pointermove', onMove, { passive: true });
        return () => window.removeEventListener('pointermove', onMove);
    }, []);

    useEffect(() => () => sprite.dispose(), [sprite]);

    useFrame((_, delta) => {
        const pts = pointsRef.current;
        if (!pts) return;
        // Rotación lenta perpetua.
        pts.rotation.y += delta * 0.03;
        pts.rotation.x += delta * 0.008;
        // Parallax suave: la nube sigue al ratón con inercia.
        const targetX = mouse.current.x * 0.4;
        const targetY = -mouse.current.y * 0.4;
        pts.position.x += (targetX - pts.position.x) * 0.03;
        pts.position.y += (targetY - pts.position.y) * 0.03;
        // Transición de color hacia el tono de la ruta actual.
        if (materialRef.current) {
            currentColor.current.lerp(goalColor.current, 0.02);
            materialRef.current.color.copy(currentColor.current);
        }
    });

    // Tamaño de punto relativo a la resolución para consistencia visual.
    const pointSize = Math.max(0.05, 0.12 * (size.width > 1600 ? 1 : 0.85));

    return (
        <points ref={pointsRef}>
            <bufferGeometry>
                <bufferAttribute
                    attach="attributes-position"
                    count={count}
                    array={positions}
                    itemSize={3}
                />
            </bufferGeometry>
            <pointsMaterial
                ref={materialRef}
                size={pointSize}
                map={sprite}
                transparent
                opacity={0.55}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                sizeAttenuation
            />
        </points>
    );
}

function CssFallback({ color }) {
    const hex = '#' + color.toString(16).padStart(6, '0');
    return (
        <div
            aria-hidden="true"
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: -1,
                pointerEvents: 'none',
                background: `radial-gradient(circle at 50% 0%, ${hex}22 0%, #0B0E14 65%)`,
                transition: 'background 1.2s ease',
            }}
        />
    );
}

export default function AmbientCanvas() {
    const { enabled, dpr, paused, particleCount } = useGLQuality();
    const location = useLocation();
    const color = useMemo(() => hueForPath(location.pathname), [location.pathname]);

    if (!enabled) {
        return <CssFallback color={color} />;
    }

    return (
        <div
            aria-hidden="true"
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: -1,
                pointerEvents: 'none',
            }}
        >
            <Canvas
                dpr={dpr}
                frameloop={paused ? 'never' : 'always'}
                camera={{ position: [0, 0, 14], fov: 60 }}
                gl={{ antialias: false, powerPreference: 'high-performance', alpha: true }}
                style={{ background: 'transparent' }}
            >
                <Nebula count={particleCount} targetColor={color} />
            </Canvas>
        </div>
    );
}
