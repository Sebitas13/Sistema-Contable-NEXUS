import { useRef, useMemo, useState, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGLQuality } from './useGLQuality';
import MahoragaWheelSVG from '../components/MahoragaWheel';

/**
 * MahoragaWheel3D - La Rueda de los Ocho Mangos legendaria en 3D.
 *
 * Reinterpretación premium del emblema de Mahoraga: anillo dorado pulido de
 * alto brillo con ocho mangos orbitantes, aura mágica de partículas girando
 * en sentido contrario, iluminación dinámica pulsante, y hover interactivo
 * que acelera la rotación y expande la aura.
 *
 * Degradación elegante al SVG original cuando WebGL no aplica.
 */

const BRAND = new THREE.Color(0xffd700);  // dorado
const ACCENT = new THREE.Color(0x3b82f6); // azul de marca

// ─── Magical particle aura vertex shader ───
const auraVertexShader = /* glsl */ `
    uniform float uTime;
    uniform float uExpand;
    attribute float aAngle;
    attribute float aSpeed;
    attribute float aRadius;
    varying float vAlpha;

    void main() {
        float angle = aAngle + uTime * aSpeed;
        float r = aRadius * uExpand;
        vec3 pos = vec3(
            cos(angle) * r,
            sin(angle) * r,
            sin(angle * 2.0 + uTime) * 0.3
        );

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        float dist = length(pos);
        vAlpha = smoothstep(2.5, 0.8, dist) * 0.7;

        gl_PointSize = (3.0 + sin(uTime * 3.0 + aAngle) * 1.5) * (200.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const auraFragmentShader = /* glsl */ `
    uniform vec3 uColor;
    uniform float uTime;
    varying float vAlpha;

    void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        float glow = exp(-d * 6.0);
        float shimmer = 0.85 + sin(uTime * 4.0 + gl_PointCoord.x * 10.0) * 0.15;
        gl_FragColor = vec4(uColor, glow * vAlpha * shimmer);
    }
`;

function MagicAura({ particleCount, hovered }) {
    const materialRef = useRef();

    const { angles, speeds, radii } = useMemo(() => {
        const a = new Float32Array(particleCount);
        const s = new Float32Array(particleCount);
        const r = new Float32Array(particleCount);
        for (let i = 0; i < particleCount; i++) {
            a[i] = Math.random() * Math.PI * 2;
            s[i] = 0.3 + Math.random() * 0.8;
            r[i] = 1.4 + Math.random() * 0.8;
        }
        return { angles: a, speeds: s, radii: r };
    }, [particleCount]);

    // Dummy positions (overridden by vertex shader)
    const positions = useMemo(() => new Float32Array(particleCount * 3), [particleCount]);

    const uniforms = useRef({
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xffd700) },
        uExpand: { value: 1.0 },
    });

    useFrame((state) => {
        const u = uniforms.current;
        u.uTime.value = state.clock.elapsedTime;
        // Smooth expand on hover
        const target = hovered ? 1.35 : 1.0;
        u.uExpand.value += (target - u.uExpand.value) * 0.06;
        // Color cycle between gold and blue
        const t = Math.sin(state.clock.elapsedTime * 0.5) * 0.5 + 0.5;
        u.uColor.value.lerpColors(BRAND, ACCENT, t * 0.3);
    });

    return (
        <points>
            <bufferGeometry>
                <bufferAttribute attach="attributes-position" count={particleCount} array={positions} itemSize={3} />
                <bufferAttribute attach="attributes-aAngle" count={particleCount} array={angles} itemSize={1} />
                <bufferAttribute attach="attributes-aSpeed" count={particleCount} array={speeds} itemSize={1} />
                <bufferAttribute attach="attributes-aRadius" count={particleCount} array={radii} itemSize={1} />
            </bufferGeometry>
            <shaderMaterial
                ref={materialRef}
                vertexShader={auraVertexShader}
                fragmentShader={auraFragmentShader}
                uniforms={uniforms.current}
                transparent
                depthWrite={false}
                blending={THREE.AdditiveBlending}
            />
        </points>
    );
}

function WheelMesh({ hovered }) {
    const group = useRef();
    const coreRef = useRef();
    const handleCount = 8;
    const spinSpeed = useRef(0.35);

    const handleAngles = useMemo(
        () => Array.from({ length: handleCount }, (_, i) => (i / handleCount) * Math.PI * 2),
        []
    );

    useFrame((state, delta) => {
        if (!group.current) return;

        // Smooth acceleration on hover
        const targetSpeed = hovered ? 1.2 : 0.35;
        spinSpeed.current += (targetSpeed - spinSpeed.current) * 0.04;
        group.current.rotation.z -= delta * spinSpeed.current;
        group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.4) * 0.3;

        // Core pulsing
        if (coreRef.current) {
            const pulse = 0.8 + Math.sin(state.clock.elapsedTime * 3) * 0.4;
            coreRef.current.material.emissiveIntensity = hovered ? 1.5 : pulse;
            const s = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.05;
            coreRef.current.scale.setScalar(s);
        }
    });

    return (
        <group ref={group}>
            {/* Central torus ring — polished gold */}
            <mesh>
                <torusGeometry args={[1.15, 0.13, 24, 80]} />
                <meshPhysicalMaterial
                    color={BRAND}
                    metalness={0.92}
                    roughness={0.12}
                    clearcoat={1}
                    clearcoatRoughness={0.05}
                    emissive={BRAND}
                    emissiveIntensity={0.15}
                    envMapIntensity={2}
                />
            </mesh>

            {/* Luminous core */}
            <mesh ref={coreRef}>
                <sphereGeometry args={[0.35, 32, 32]} />
                <meshPhysicalMaterial
                    color={ACCENT}
                    emissive={ACCENT}
                    emissiveIntensity={0.8}
                    metalness={0.3}
                    roughness={0.2}
                    clearcoat={0.8}
                    transmission={0.3}
                    thickness={1}
                />
            </mesh>

            {/* Eight spokes + mango spheres */}
            {handleAngles.map((angle, i) => {
                const cx = Math.cos(angle) * 1.15;
                const cy = Math.sin(angle) * 1.15;
                return (
                    <group key={i}>
                        {/* Spoke */}
                        <mesh position={[cx / 2, cy / 2, 0]} rotation={[0, 0, angle]}>
                            <boxGeometry args={[1.08, 0.06, 0.06]} />
                            <meshPhysicalMaterial
                                color={BRAND}
                                metalness={0.88}
                                roughness={0.15}
                                clearcoat={0.8}
                                emissive={BRAND}
                                emissiveIntensity={0.1}
                            />
                        </mesh>
                        {/* Mango sphere */}
                        <mesh position={[cx, cy, 0]}>
                            <sphereGeometry args={[0.17, 24, 24]} />
                            <meshPhysicalMaterial
                                color={BRAND}
                                metalness={0.93}
                                roughness={0.1}
                                clearcoat={1}
                                clearcoatRoughness={0.05}
                                emissive={BRAND}
                                emissiveIntensity={0.25}
                                envMapIntensity={2}
                            />
                        </mesh>
                    </group>
                );
            })}
        </group>
    );
}

function PulsingLights({ hovered }) {
    const light1 = useRef();
    const light2 = useRef();

    useFrame((state) => {
        const t = state.clock.elapsedTime;
        if (light1.current) {
            light1.current.intensity = 1.2 + Math.sin(t * 2) * 0.4;
            light1.current.color.lerpColors(BRAND, new THREE.Color(0xffffff), Math.sin(t * 0.5) * 0.3 + 0.3);
        }
        if (light2.current) {
            light2.current.intensity = (hovered ? 0.8 : 0.4) + Math.sin(t * 1.5 + 1) * 0.2;
        }
    });

    return (
        <>
            <pointLight ref={light1} position={[3, 3, 4]} intensity={1.4} color={0xffffff} />
            <pointLight ref={light2} position={[-3, -2, 2]} intensity={0.4} color={ACCENT} />
            <ambientLight intensity={0.4} />
        </>
    );
}

export default function MahoragaWheel3D({ size = 160 }) {
    const { enabled } = useGLQuality();
    const [hovered, setHovered] = useState(false);

    if (!enabled) {
        return <MahoragaWheelSVG size={size} spinning color="#FFD700" />;
    }

    return (
        <div
            style={{ width: size, height: size, cursor: 'pointer' }}
            aria-hidden="true"
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
        >
            <Canvas
                dpr={[1, 1.5]}
                camera={{ position: [0, 0, 4.2], fov: 50 }}
                gl={{ antialias: true, alpha: true }}
                style={{ background: 'transparent' }}
            >
                <PulsingLights hovered={hovered} />
                <WheelMesh hovered={hovered} />
                <MagicAura particleCount={120} hovered={hovered} />
            </Canvas>
        </div>
    );
}
