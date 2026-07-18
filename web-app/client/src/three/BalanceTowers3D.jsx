import { useRef, useState, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGLQuality } from './useGLQuality';

/**
 * BalanceTowers3D - Ecuación contable Activo = Pasivo + Patrimonio en 3D.
 *
 * Tres torres proporcionales con estética glassmórfica futurista: materiales
 * translúcidos con MeshPhysicalMaterial, núcleos internos de neón pulsante,
 * hover interactivo con spring scaling, y tooltips flotantes premium.
 *
 * Fallback CSS cuando WebGL no aplica.
 */

const COLORS = {
    activo: new THREE.Color(0x3b82f6),
    pasivo: new THREE.Color(0xef4444),
    patrimonio: new THREE.Color(0x10b981),
};
const HEX = { activo: '#3b82f6', pasivo: '#ef4444', patrimonio: '#10b981' };
const LABELS = { activo: 'Activo', pasivo: 'Pasivo', patrimonio: 'Patrimonio' };
const MAX_HEIGHT = 3.2;

function Tower({ x, targetHeight, color, label, value, format, onHover }) {
    const outerMesh = useRef();
    const innerMesh = useRef();
    const grown = useRef(0);
    const hoverScale = useRef(1);
    const [hovered, setHovered] = useState(false);

    const handlePointerOver = useCallback((e) => {
        e.stopPropagation();
        setHovered(true);
        onHover?.({ label, value, color: '#' + color.getHexString(), x });
        document.body.style.cursor = 'pointer';
    }, [label, value, color, x, onHover]);

    const handlePointerOut = useCallback(() => {
        setHovered(false);
        onHover?.(null);
        document.body.style.cursor = 'default';
    }, [onHover]);

    useFrame((state) => {
        if (!outerMesh.current) return;

        // Animated growth with inertia
        grown.current += (targetHeight - grown.current) * 0.07;
        const h = Math.max(0.001, grown.current);

        // Spring-like hover scale
        const targetScale = hovered ? 1.12 : 1;
        hoverScale.current += (targetScale - hoverScale.current) * 0.08;

        const sx = hoverScale.current;
        outerMesh.current.scale.set(sx, h, sx);
        outerMesh.current.position.y = h / 2;

        // Inner neon core: pulsing emission
        if (innerMesh.current) {
            innerMesh.current.scale.set(sx * 0.55, h * 0.92, sx * 0.55);
            innerMesh.current.position.y = h / 2;
            const pulse = 0.5 + Math.sin(state.clock.elapsedTime * 2.5) * 0.3;
            innerMesh.current.material.emissiveIntensity = hovered ? 1.2 : pulse;
        }
    });

    return (
        <group position={[x, 0, 0]}>
            {/* Outer glassmorphic shell */}
            <mesh
                ref={outerMesh}
                onPointerOver={handlePointerOver}
                onPointerOut={handlePointerOut}
            >
                <boxGeometry args={[0.9, 1, 0.9]} />
                <meshPhysicalMaterial
                    color={color}
                    transmission={0.4}
                    thickness={1.5}
                    roughness={0.15}
                    metalness={0.1}
                    clearcoat={1}
                    clearcoatRoughness={0.1}
                    transparent
                    opacity={0.65}
                    envMapIntensity={1.5}
                    side={THREE.DoubleSide}
                />
            </mesh>

            {/* Inner neon core */}
            <mesh ref={innerMesh}>
                <boxGeometry args={[0.9, 1, 0.9]} />
                <meshStandardMaterial
                    color={color}
                    emissive={color}
                    emissiveIntensity={0.5}
                    transparent
                    opacity={0.35}
                />
            </mesh>

            {/* Top edge glow line */}
            <mesh position={[0, Math.max(0.001, grown.current || 0.001), 0]}>
                <boxGeometry args={[0.92, 0.02, 0.92]} />
                <meshStandardMaterial
                    color={color}
                    emissive={color}
                    emissiveIntensity={1.5}
                    transparent
                    opacity={hovered ? 0.9 : 0.5}
                />
            </mesh>
        </group>
    );
}

function TowersScene({ values, format, onHover }) {
    const group = useRef();
    const max = Math.max(values.activo, values.pasivo, values.patrimonio, 1);
    const h = (v) => (Math.max(0, v) / max) * MAX_HEIGHT;

    useFrame((state) => {
        if (group.current) {
            group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.2) * 0.2;
        }
    });

    return (
        <group ref={group} position={[0, -1.4, 0]}>
            <Tower x={-1.6} targetHeight={h(values.activo)} color={COLORS.activo}
                label={LABELS.activo} value={values.activo} format={format} onHover={onHover} />
            <Tower x={0} targetHeight={h(values.pasivo)} color={COLORS.pasivo}
                label={LABELS.pasivo} value={values.pasivo} format={format} onHover={onHover} />
            <Tower x={1.6} targetHeight={h(values.patrimonio)} color={COLORS.patrimonio}
                label={LABELS.patrimonio} value={values.patrimonio} format={format} onHover={onHover} />

            {/* Reflective base plane */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
                <planeGeometry args={[6.5, 4]} />
                <meshPhysicalMaterial
                    color={0x0b0e14}
                    metalness={0.8}
                    roughness={0.3}
                    transparent
                    opacity={0.5}
                    clearcoat={0.6}
                />
            </mesh>
        </group>
    );
}

function Tooltip({ info, format }) {
    if (!info) return null;

    // Map x position of tower to horizontal offset
    const left = info.x < 0 ? '15%' : info.x === 0 ? '42%' : '70%';

    return (
        <div
            style={{
                position: 'absolute',
                top: '12px',
                left,
                transform: 'translateX(-50%)',
                background: 'rgba(11, 14, 20, 0.85)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: `1px solid ${info.color}55`,
                borderRadius: '12px',
                padding: '8px 14px',
                color: '#f8fafc',
                fontSize: '0.78rem',
                pointerEvents: 'none',
                zIndex: 10,
                boxShadow: `0 4px 24px ${info.color}33, 0 0 0 1px rgba(255,255,255,0.04)`,
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap',
            }}
        >
            <div style={{ fontWeight: 700, color: info.color, marginBottom: '2px' }}>
                {info.label}
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                Bs {typeof format === 'function' ? format(info.value) : Number(info.value).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
        </div>
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
                            background: `linear-gradient(180deg, ${HEX[key]}ee, ${HEX[key]}88)`,
                            borderRadius: '8px 8px 0 0',
                            boxShadow: `0 0 20px ${HEX[key]}44, inset 0 1px 0 rgba(255,255,255,0.2)`,
                            transition: 'height 0.8s cubic-bezier(0.2,0.8,0.2,1)',
                            border: `1px solid ${HEX[key]}55`,
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
    const [hoverInfo, setHoverInfo] = useState(null);
    const safeValues = {
        activo: Number(values?.activo) || 0,
        pasivo: Number(values?.pasivo) || 0,
        patrimonio: Number(values?.patrimonio) || 0,
    };

    if (!enabled) {
        return <CssFallback values={safeValues} format={format} />;
    }

    return (
        <div style={{ width: '100%', height: '100%', minHeight: 180, position: 'relative' }} aria-hidden="true">
            <Tooltip info={hoverInfo} format={format} />
            <Canvas
                dpr={[1, 1.5]}
                camera={{ position: [0, 1.5, 6], fov: 50 }}
                gl={{ antialias: true, alpha: true }}
                style={{ background: 'transparent' }}
            >
                <ambientLight intensity={0.5} />
                <directionalLight position={[3, 5, 4]} intensity={1.0} />
                <pointLight position={[-3, 2, 3]} intensity={0.6} color={0x3b82f6} />
                <pointLight position={[3, 3, 2]} intensity={0.3} color={0x8b5cf6} />
                <TowersScene values={safeValues} format={format} onHover={setHoverInfo} />
            </Canvas>
        </div>
    );
}
