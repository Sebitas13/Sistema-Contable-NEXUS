import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useLocation } from 'react-router-dom';
import * as THREE from 'three';
import { useGLQuality } from './useGLQuality';

/**
 * AmbientCanvas - Fondo WebGL vivo con shaders GLSL personalizados.
 *
 * Nebulosa orgánica de partículas que respira y ondula con movimiento fluido.
 * El tono cambia según la ruta activa para dar identidad a cada sección.
 * Parallax sutil con el ratón. Degradación elegante a CSS si WebGL no aplica.
 */

// Paleta de marca. Tono base por familia de ruta.
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
    const match = Object.keys(ROUTE_HUES)
        .filter(k => k !== '/' && pathname.startsWith(k))
        .sort((a, b) => b.length - a.length)[0];
    return match ? ROUTE_HUES[match] : 0x3b82f6;
}

// ─── Vertex Shader: organic wave displacement ───
const vertexShader = /* glsl */ `
    uniform float uTime;
    uniform vec2 uMouse;
    attribute float aSize;
    attribute float aPhase;
    varying float vAlpha;
    varying float vDist;

    void main() {
        vec3 pos = position;

        // Organic sine/cos wave offsets — fluid breathing motion
        float wave1 = sin(pos.x * 0.4 + uTime * 0.3 + aPhase) * 0.6;
        float wave2 = cos(pos.y * 0.3 + uTime * 0.25 + aPhase * 1.3) * 0.5;
        float wave3 = sin(pos.z * 0.5 + uTime * 0.2 + aPhase * 0.7) * 0.4;
        pos.x += wave1 + wave2 * 0.3;
        pos.y += wave2 + wave3 * 0.3;
        pos.z += wave3 + wave1 * 0.2;

        // Mouse parallax influence
        pos.x += uMouse.x * 0.5;
        pos.y += uMouse.y * 0.5;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        vDist = length(mvPosition.xyz);
        vAlpha = smoothstep(18.0, 4.0, vDist);

        gl_PointSize = aSize * (280.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

// ─── Fragment Shader: soft circular glow with bright core ───
const fragmentShader = /* glsl */ `
    uniform vec3 uColor;
    uniform float uTime;
    varying float vAlpha;
    varying float vDist;

    void main() {
        // Soft circle (distance from center of point sprite)
        vec2 uv = gl_PointCoord - 0.5;
        float dist = length(uv);
        if (dist > 0.5) discard;

        // Bright core + soft halo
        float core = exp(-dist * 8.0) * 0.9;
        float halo = exp(-dist * 3.5) * 0.5;
        float glow = core + halo;

        // Subtle shimmer
        float shimmer = sin(uTime * 2.0 + vDist * 3.0) * 0.08 + 1.0;
        glow *= shimmer;

        float alpha = glow * vAlpha * 0.7;
        gl_FragColor = vec4(uColor, alpha);
    }
`;

function Nebula({ count, targetColor }) {
    const pointsRef = useRef();
    const materialRef = useRef();
    const mouse = useRef({ x: 0, y: 0 });
    const currentColor = useRef(new THREE.Color(0x3b82f6));
    const goalColor = useRef(new THREE.Color(targetColor));

    // Geometry: spherical cloud with central density + per-particle phase & size
    const { positions, sizes, phases } = useMemo(() => {
        const pos = new Float32Array(count * 3);
        const sz = new Float32Array(count);
        const ph = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const r = Math.cbrt(Math.random()) * 10;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            pos[i * 3 + 2] = r * Math.cos(phi);
            sz[i] = 0.04 + Math.random() * 0.14;
            ph[i] = Math.random() * Math.PI * 2;
        }
        return { positions: pos, sizes: sz, phases: ph };
    }, [count]);

    useEffect(() => {
        goalColor.current.set(targetColor);
    }, [targetColor]);

    useEffect(() => {
        const onMove = (e) => {
            mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
        };
        window.addEventListener('pointermove', onMove, { passive: true });
        return () => window.removeEventListener('pointermove', onMove);
    }, []);

    // Shader uniforms
    const uniforms = useRef({
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x3b82f6) },
        uMouse: { value: new THREE.Vector2(0, 0) },
    });

    useFrame((state, delta) => {
        const pts = pointsRef.current;
        if (!pts) return;

        // Slow perpetual rotation
        pts.rotation.y += delta * 0.025;
        pts.rotation.x += delta * 0.006;

        // Smooth color transition
        currentColor.current.lerp(goalColor.current, 0.015);

        // Update uniforms
        const u = uniforms.current;
        u.uTime.value = state.clock.elapsedTime;
        u.uColor.value.copy(currentColor.current);
        u.uMouse.value.set(
            u.uMouse.value.x + (mouse.current.x * 0.4 - u.uMouse.value.x) * 0.03,
            u.uMouse.value.y + (mouse.current.y * 0.4 - u.uMouse.value.y) * 0.03
        );
    });

    return (
        <points ref={pointsRef}>
            <bufferGeometry>
                <bufferAttribute
                    attach="attributes-position"
                    count={count}
                    array={positions}
                    itemSize={3}
                />
                <bufferAttribute
                    attach="attributes-aSize"
                    count={count}
                    array={sizes}
                    itemSize={1}
                />
                <bufferAttribute
                    attach="attributes-aPhase"
                    count={count}
                    array={phases}
                    itemSize={1}
                />
            </bufferGeometry>
            <shaderMaterial
                ref={materialRef}
                vertexShader={vertexShader}
                fragmentShader={fragmentShader}
                uniforms={uniforms.current}
                transparent
                depthWrite={false}
                blending={THREE.AdditiveBlending}
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
    // Seguro ante pérdida del contexto GPU ("THREE.WebGLRenderer: Context Lost"):
    // si el driver crashea (común en laptops con doble GPU), degradamos a CSS
    // de forma PERMANENTE — sin reintentos que bloqueen el hilo principal.
    const [glLost, setGlLost] = useState(false);

    if (!enabled || glLost) {
        return <CssFallback color={color} />;
    }

    const handleCreated = ({ gl }) => {
        if (!gl || !gl.domElement) return;
        const onLost = (event) => {
            event.preventDefault(); // permite restauración futura del contexto
            setGlLost(true);        // nunca más WebGL en esta sesión
        };
        gl.domElement.addEventListener('webglcontextlost', onLost, false);
    };

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
                gl={{
                    antialias: false,
                    // 'default' en vez de 'high-performance': evita forzar la GPU
                    // discreta en laptops, que es donde más ocurre el context lost.
                    powerPreference: 'default',
                    alpha: true,
                    // Si WebGL solo está disponible por software (SwiftShader),
                    // falla la creación y el error boundary degrada a CSS.
                    failIfMajorPerformanceCaveat: true
                }}
                onCreated={handleCreated}
                style={{ background: 'transparent' }}
            >
                <Nebula count={particleCount} targetColor={color} />
            </Canvas>
        </div>
    );
}
