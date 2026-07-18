import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLQuality } from './useGLQuality';
import MahoragaWheelSVG from '../components/MahoragaWheel';

/**
 * MahoragaWheel3D - La Rueda de los Ocho Mangos en 3D.
 *
 * Reinterpreta el emblema de Mahoraga (MahoragaWheel.jsx SVG) como un anillo
 * con ocho mangos orbitando, girando con lentitud hipnótica. Es identidad de
 * marca en el hero de Login/Selector, no un adorno gratuito: comunica "sistema
 * vivo que aprende".
 *
 * Se degrada con elegancia: si WebGL no aplica (móvil / reduce-motion / sin
 * soporte) reutiliza el SVG original girando por CSS. Contexto WebGL propio y
 * diminuto (no comparte con AmbientCanvas para poder desmontarse limpio).
 */

const BRAND = 0xffd700; // dorado, igual que el SVG original
const ACCENT = 0x3b82f6; // azul de marca para el brillo

function WheelMesh() {
    const group = useRef();
    const handleCount = 8;

    const handleAngles = useMemo(
        () => Array.from({ length: handleCount }, (_, i) => (i / handleCount) * Math.PI * 2),
        []
    );

    useFrame((_, delta) => {
        if (group.current) {
            group.current.rotation.z -= delta * 0.35;
            group.current.rotation.y = Math.sin(Date.now() * 0.0004) * 0.35;
        }
    });

    return (
        <group ref={group}>
            {/* Anillo central */}
            <mesh>
                <torusGeometry args={[1.15, 0.12, 20, 64]} />
                <meshStandardMaterial
                    color={BRAND}
                    metalness={0.8}
                    roughness={0.25}
                    emissive={BRAND}
                    emissiveIntensity={0.25}
                />
            </mesh>

            {/* Núcleo luminoso */}
            <mesh>
                <sphereGeometry args={[0.32, 24, 24]} />
                <meshStandardMaterial
                    color={ACCENT}
                    emissive={ACCENT}
                    emissiveIntensity={0.9}
                    metalness={0.3}
                    roughness={0.4}
                />
            </mesh>

            {/* Ocho mangos + radios */}
            {handleAngles.map((angle, i) => {
                const x = Math.cos(angle) * 1.15;
                const y = Math.sin(angle) * 1.15;
                return (
                    <group key={i}>
                        {/* radio */}
                        <mesh position={[x / 2, y / 2, 0]} rotation={[0, 0, angle]}>
                            <boxGeometry args={[1.05, 0.05, 0.05]} />
                            <meshStandardMaterial
                                color={BRAND}
                                metalness={0.7}
                                roughness={0.35}
                                emissive={BRAND}
                                emissiveIntensity={0.15}
                            />
                        </mesh>
                        {/* mango */}
                        <mesh position={[x, y, 0]}>
                            <sphereGeometry args={[0.16, 20, 20]} />
                            <meshStandardMaterial
                                color={BRAND}
                                metalness={0.85}
                                roughness={0.2}
                                emissive={BRAND}
                                emissiveIntensity={0.35}
                            />
                        </mesh>
                    </group>
                );
            })}
        </group>
    );
}

export default function MahoragaWheel3D({ size = 160 }) {
    const { enabled } = useGLQuality();

    if (!enabled) {
        return <MahoragaWheelSVG size={size} spinning color="#FFD700" />;
    }

    return (
        <div style={{ width: size, height: size }} aria-hidden="true">
            <Canvas
                dpr={[1, 1.5]}
                camera={{ position: [0, 0, 4.2], fov: 50 }}
                gl={{ antialias: true, alpha: true }}
                style={{ background: 'transparent' }}
            >
                <ambientLight intensity={0.5} />
                <pointLight position={[3, 3, 4]} intensity={1.4} color={0xffffff} />
                <pointLight position={[-3, -2, 2]} intensity={0.6} color={ACCENT} />
                <WheelMesh />
            </Canvas>
        </div>
    );
}
