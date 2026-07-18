import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLQuality } from './useGLQuality';

/**
 * BalanceTowers3D - Ecuación contable Activo = Pasivo + Patrimonio en 3D.
 *
 * No es decoración: tres torres proporcionales dejan ver de un vistazo cómo se
 * financia la empresa (cuánto activo respalda deuda vs. patrimonio). Las alturas
 * se normalizan al mayor valor y las barras crecen animadas al montar.
 *
 * Fallback CSS (barras planas) cuando WebGL no aplica: la información nunca se
 * pierde, solo cambia la forma de mostrarla.
 */

const COLORS = {
    activo: 0x3b82f6,     // azul
    pasivo: 0xef4444,     // rojo
    patrimonio: 0x10b981, // verde
};
const HEX = { activo: '#3b82f6', pasivo: '#ef4444', patrimonio: '#10b981' };
const MAX_HEIGHT = 3.2;

function Tower({ x, targetHeight, color }) {
    const mesh = useRef();
    const grown = useRef(0);

    useFrame(() => {
        if (!mesh.current) return;
        // Crecimiento animado con inercia hasta la altura objetivo.
        grown.current += (targetHeight - grown.current) * 0.08;
        const h = Math.max(0.001, grown.current);
        mesh.current.scale.y = h;
        mesh.current.position.y = h / 2;
    });

    return (
        <mesh ref={mesh} position={[x, 0, 0]}>
            <boxGeometry args={[0.9, 1, 0.9]} />
            <meshStandardMaterial
                color={color}
                metalness={0.35}
                roughness={0.4}
                emissive={color}
                emissiveIntensity={0.25}
            />
        </mesh>
    );
}

function TowersScene({ values }) {
    const group = useRef();
    const max = Math.max(values.activo, values.pasivo, values.patrimonio, 1);
    const h = (v) => (Math.max(0, v) / max) * MAX_HEIGHT;

    useFrame((state) => {
        if (group.current) {
            // Balanceo lento para dar volumen sin marear.
            group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.25) * 0.25;
        }
    });

    return (
        <group ref={group} position={[0, -1.4, 0]}>
            <Tower x={-1.5} targetHeight={h(values.activo)} color={COLORS.activo} />
            <Tower x={0} targetHeight={h(values.pasivo)} color={COLORS.pasivo} />
            <Tower x={1.5} targetHeight={h(values.patrimonio)} color={COLORS.patrimonio} />
            {/* Base reflectante sutil */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
                <planeGeometry args={[6, 4]} />
                <meshStandardMaterial color={0x0b0e14} metalness={0.6} roughness={0.5} transparent opacity={0.5} />
            </mesh>
        </group>
    );
}

function CssFallback({ values, format }) {
    const max = Math.max(values.activo, values.pasivo, values.patrimonio, 1);
    const bars = [
        { key: 'activo', label: 'Activo' },
        { key: 'pasivo', label: 'Pasivo' },
        { key: 'patrimonio', label: 'Patrimonio' },
    ];
    return (
        <div className="d-flex align-items-end justify-content-around w-100 h-100 gap-3 px-2 pb-2" style={{ minHeight: 160 }}>
            {bars.map(({ key, label }) => (
                <div key={key} className="d-flex flex-column align-items-center justify-content-end h-100 flex-grow-1">
                    <span className="small text-white mb-1">{format(values[key])}</span>
                    <div
                        style={{
                            width: '100%',
                            maxWidth: 70,
                            height: `${(Math.max(0, values[key]) / max) * 100}%`,
                            minHeight: 4,
                            background: HEX[key],
                            borderRadius: '8px 8px 0 0',
                            boxShadow: `0 0 16px ${HEX[key]}66`,
                            transition: 'height 0.8s cubic-bezier(0.2,0.8,0.2,1)',
                        }}
                    />
                    <span className="small text-white-50 mt-2">{label}</span>
                </div>
            ))}
        </div>
    );
}

export default function BalanceTowers3D({ values, format = (v) => v }) {
    const { enabled } = useGLQuality();
    const safeValues = {
        activo: Number(values?.activo) || 0,
        pasivo: Number(values?.pasivo) || 0,
        patrimonio: Number(values?.patrimonio) || 0,
    };

    if (!enabled) {
        return <CssFallback values={safeValues} format={format} />;
    }

    return (
        <div style={{ width: '100%', height: '100%', minHeight: 180 }} aria-hidden="true">
            <Canvas
                dpr={[1, 1.5]}
                camera={{ position: [0, 1.5, 6], fov: 50 }}
                gl={{ antialias: true, alpha: true }}
                style={{ background: 'transparent' }}
            >
                <ambientLight intensity={0.6} />
                <directionalLight position={[3, 5, 4]} intensity={1.2} />
                <pointLight position={[-3, 2, 3]} intensity={0.5} color={0x3b82f6} />
                <TowersScene values={safeValues} />
            </Canvas>
        </div>
    );
}
