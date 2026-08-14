import React, { useState, useEffect, useRef, useCallback } from 'react';

// ============================================
// Mascotas DILO — panel izquierdo del AuthModal (solo desktop).
// Personajes de la marca: el bot vendedor (naranja), el teléfono
// (negro, el canal de WhatsApp), el pan de hamburguesa y las
// papitas (los restaurantes que venden con DILO).
// Ojos siguen el mouse; se miran entre sí al escribir; se tapan la
// mirada cuando el campo enfocado es un password (privacidad).
// Sin dependencias nuevas: React puro + estilos inline.
// ============================================

const ORANGE = '#FF441F';
const ORANGE_SOFT = '#FF7A2F';
const INK = '#1c1c1e';
const BUN = '#F5C065';
const FRIES = '#FFD84D';

const EyeBall = ({
    size = 18,
    pupilSize = 7,
    maxDistance = 5,
    eyeColor = 'white',
    pupilColor = INK,
    isBlinking = false,
    forceLookX,
    forceLookY,
    mouseX,
    mouseY,
}) => {
    const eyeRef = useRef(null);

    const calc = () => {
        if (forceLookX !== undefined && forceLookY !== undefined) {
            return { x: forceLookX, y: forceLookY };
        }
        if (!eyeRef.current) return { x: 0, y: 0 };
        const r = eyeRef.current.getBoundingClientRect();
        const dx = mouseX - (r.left + r.width / 2);
        const dy = mouseY - (r.top + r.height / 2);
        const dist = Math.min(Math.sqrt(dx * dx + dy * dy), maxDistance);
        const angle = Math.atan2(dy, dx);
        return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
    };

    const p = calc();

    return (
        <div
            ref={eyeRef}
            className="rounded-full flex items-center justify-center transition-all duration-150"
            style={{
                width: size,
                height: isBlinking ? 2 : size,
                backgroundColor: eyeColor,
                overflow: 'hidden',
            }}
        >
            {!isBlinking && (
                <div
                    className="rounded-full"
                    style={{
                        width: pupilSize,
                        height: pupilSize,
                        backgroundColor: pupilColor,
                        transform: `translate(${p.x}px, ${p.y}px)`,
                        transition: 'transform 0.1s ease-out',
                    }}
                />
            )}
        </div>
    );
};

const Pupil = (props) => (
    <EyeBall {...props} eyeColor="transparent" pupilSize={props.size || 12} size={props.size || 12} maxDistance={props.maxDistance || 5} />
);

// Parpadeo aleatorio (3-7s) reutilizable.
const useBlink = () => {
    const [blinking, setBlinking] = useState(false);
    useEffect(() => {
        let timeout;
        const schedule = () => {
            timeout = setTimeout(() => {
                setBlinking(true);
                timeout = setTimeout(() => {
                    setBlinking(false);
                    schedule();
                }, 150);
            }, Math.random() * 4000 + 3000);
        };
        schedule();
        return () => clearTimeout(timeout);
    }, []);
    return blinking;
};

export default function DiloMascots() {
    const [mouseX, setMouseX] = useState(0);
    const [mouseY, setMouseY] = useState(0);
    const [isTyping, setIsTyping] = useState(false);
    const [isPassword, setIsPassword] = useState(false);
    const [lookingAtEachOther, setLookingAtEachOther] = useState(false);

    const botRef = useRef(null);
    const phoneRef = useRef(null);
    const bunRef = useRef(null);
    const friesRef = useRef(null);

    const botBlink = useBlink();
    const phoneBlink = useBlink();

    useEffect(() => {
        const onMove = (e) => {
            setMouseX(e.clientX);
            setMouseY(e.clientY);
        };
        window.addEventListener('mousemove', onMove);
        return () => window.removeEventListener('mousemove', onMove);
    }, []);

    // Detección global: no toca los formularios. Password enfocado →
    // las mascotas miran a otro lado (privacidad). Cualquier input con
    // texto → breve mirada entre ellas.
    useEffect(() => {
        const onFocusIn = (e) => {
            const t = e.target;
            if (t && t.tagName === 'INPUT') {
                setIsTyping(true);
                setIsPassword(t.type === 'password');
            }
        };
        const onFocusOut = () => {
            setIsTyping(false);
            setIsPassword(false);
        };
        document.addEventListener('focusin', onFocusIn);
        document.addEventListener('focusout', onFocusOut);
        return () => {
            document.removeEventListener('focusin', onFocusIn);
            document.removeEventListener('focusout', onFocusOut);
        };
    }, []);

    useEffect(() => {
        if (isTyping && !isPassword) {
            setLookingAtEachOther(true);
            const t = setTimeout(() => setLookingAtEachOther(false), 800);
            return () => clearTimeout(t);
        }
        setLookingAtEachOther(false);
    }, [isTyping, isPassword]);

    const calcPos = useCallback((ref) => {
        if (!ref.current) return { faceX: 0, faceY: 0, bodySkew: 0 };
        const r = ref.current.getBoundingClientRect();
        const dx = mouseX - (r.left + r.width / 2);
        const dy = mouseY - (r.top + r.height / 3);
        return {
            faceX: Math.max(-15, Math.min(15, dx / 20)),
            faceY: Math.max(-10, Math.min(10, dy / 30)),
            bodySkew: Math.max(-6, Math.min(6, -dx / 120)),
        };
    }, [mouseX, mouseY]);

    const botPos = calcPos(botRef);
    const phonePos = calcPos(phoneRef);
    const bunPos = calcPos(bunRef);
    const friesPos = calcPos(friesRef);

    // Password → todos miran lejos del formulario (arriba-izquierda).
    const away = isPassword ? { forceLookX: -4, forceLookY: -4 } : {};

    return (
        <div className="relative select-none" style={{ width: 430, height: 330 }} aria-hidden="true">
            {/* Bot DILO — naranja, con antena. Capa trasera. */}
            <div
                ref={botRef}
                className="absolute bottom-0 transition-all duration-700 ease-in-out"
                style={{
                    left: 55,
                    width: 150,
                    height: isTyping && !isPassword ? 330 : 300,
                    backgroundColor: ORANGE,
                    borderRadius: '14px 14px 0 0',
                    zIndex: 1,
                    transform: isPassword ? 'skewX(0deg)' : `skewX(${botPos.bodySkew}deg)`,
                    transformOrigin: 'bottom center',
                }}
            >
                {/* Antena del bot */}
                <div className="absolute" style={{ top: -26, left: '50%', transform: 'translateX(-50%)' }}>
                    <div style={{ width: 3, height: 18, backgroundColor: ORANGE_SOFT, margin: '0 auto' }} />
                    <div className="rounded-full" style={{ width: 10, height: 10, backgroundColor: ORANGE_SOFT, marginTop: -28 }} />
                </div>
                <div
                    className="absolute flex gap-7 transition-all duration-700 ease-in-out"
                    style={{
                        left: isPassword ? 18 : lookingAtEachOther ? 46 : 38 + botPos.faceX,
                        top: isPassword ? 30 : lookingAtEachOther ? 55 : 36 + botPos.faceY,
                    }}
                >
                    <EyeBall isBlinking={botBlink} mouseX={mouseX} mouseY={mouseY}
                        forceLookX={isPassword ? -4 : lookingAtEachOther ? 3 : undefined}
                        forceLookY={isPassword ? -4 : lookingAtEachOther ? 4 : undefined} />
                    <EyeBall isBlinking={botBlink} mouseX={mouseX} mouseY={mouseY}
                        forceLookX={isPassword ? -4 : lookingAtEachOther ? 3 : undefined}
                        forceLookY={isPassword ? -4 : lookingAtEachOther ? 4 : undefined} />
                </div>
                {/* Boca sonriente */}
                <div
                    className="absolute rounded-full transition-all duration-700"
                    style={{
                        width: 26, height: 12,
                        border: '3px solid rgba(0,0,0,0.55)',
                        borderTop: 'none',
                        borderRadius: '0 0 26px 26px',
                        left: isPassword ? 30 : 56 + botPos.faceX,
                        top: isPassword ? 66 : 72 + botPos.faceY,
                    }}
                />
            </div>

            {/* Teléfono — negro, con burbuja de chat. Capa media. */}
            <div
                ref={phoneRef}
                className="absolute bottom-0 transition-all duration-700 ease-in-out"
                style={{
                    left: 195,
                    width: 100,
                    height: 235,
                    backgroundColor: INK,
                    borderRadius: '16px 16px 0 0',
                    border: '3px solid #333',
                    borderBottom: 'none',
                    zIndex: 2,
                    transform: isPassword
                        ? 'skewX(0deg)'
                        : lookingAtEachOther
                            ? `skewX(${phonePos.bodySkew * 1.5 + 10}deg) translateX(14px)`
                            : `skewX(${phonePos.bodySkew}deg)`,
                    transformOrigin: 'bottom center',
                }}
            >
                {/* Notch */}
                <div className="rounded-full" style={{ width: 34, height: 5, backgroundColor: '#333', margin: '8px auto 0' }} />
                {/* Burbuja de chat saliendo del teléfono */}
                <div
                    className="absolute rounded-xl transition-all duration-500"
                    style={{
                        top: -20, right: -34,
                        width: 44, height: 28,
                        backgroundColor: ORANGE,
                        borderRadius: '12px 12px 12px 2px',
                        opacity: isPassword ? 0 : 1,
                    }}
                >
                    <div className="flex items-center justify-center gap-1 h-full">
                        <div className="rounded-full" style={{ width: 4, height: 4, backgroundColor: '#000' }} />
                        <div className="rounded-full" style={{ width: 4, height: 4, backgroundColor: '#000' }} />
                        <div className="rounded-full" style={{ width: 4, height: 4, backgroundColor: '#000' }} />
                    </div>
                </div>
                <div
                    className="absolute flex gap-5 transition-all duration-700 ease-in-out"
                    style={{
                        left: isPassword ? 10 : lookingAtEachOther ? 26 : 22 + phonePos.faceX,
                        top: isPassword ? 32 : lookingAtEachOther ? 20 : 38 + phonePos.faceY,
                    }}
                >
                    <EyeBall size={15} pupilSize={6} maxDistance={4} isBlinking={phoneBlink} mouseX={mouseX} mouseY={mouseY}
                        forceLookX={isPassword ? -4 : lookingAtEachOther ? 0 : undefined}
                        forceLookY={isPassword ? -4 : lookingAtEachOther ? -4 : undefined} />
                    <EyeBall size={15} pupilSize={6} maxDistance={4} isBlinking={phoneBlink} mouseX={mouseX} mouseY={mouseY}
                        forceLookX={isPassword ? -4 : lookingAtEachOther ? 0 : undefined}
                        forceLookY={isPassword ? -4 : lookingAtEachOther ? -4 : undefined} />
                </div>
            </div>

            {/* Pan de hamburguesa — semicírculo cálido con sésamo. Frente izq. */}
            <div
                ref={bunRef}
                className="absolute bottom-0 transition-all duration-700 ease-in-out"
                style={{
                    left: 0,
                    width: 190,
                    height: 155,
                    zIndex: 3,
                    backgroundColor: BUN,
                    borderRadius: '95px 95px 0 0',
                    transform: isPassword ? 'skewX(0deg)' : `skewX(${bunPos.bodySkew}deg)`,
                    transformOrigin: 'bottom center',
                }}
            >
                {/* Semillas de sésamo */}
                <div className="absolute rounded-full" style={{ width: 7, height: 4, backgroundColor: 'rgba(255,255,255,0.7)', top: 28, left: 60, transform: 'rotate(-20deg)' }} />
                <div className="absolute rounded-full" style={{ width: 7, height: 4, backgroundColor: 'rgba(255,255,255,0.7)', top: 20, left: 105, transform: 'rotate(15deg)' }} />
                <div className="absolute rounded-full" style={{ width: 7, height: 4, backgroundColor: 'rgba(255,255,255,0.7)', top: 42, left: 135, transform: 'rotate(-10deg)' }} />
                <div
                    className="absolute flex gap-7 transition-all duration-200 ease-out"
                    style={{
                        left: isPassword ? 40 : 64 + bunPos.faceX,
                        top: isPassword ? 62 : 70 + bunPos.faceY,
                    }}
                >
                    <Pupil mouseX={mouseX} mouseY={mouseY} {...away} />
                    <Pupil mouseX={mouseX} mouseY={mouseY} {...away} />
                </div>
            </div>

            {/* Papitas — amarillo, con flequillo de papas. Frente der. */}
            <div
                ref={friesRef}
                className="absolute bottom-0 transition-all duration-700 ease-in-out"
                style={{
                    left: 255,
                    width: 115,
                    height: 175,
                    backgroundColor: FRIES,
                    borderRadius: '18px 18px 0 0',
                    zIndex: 4,
                    transform: isPassword ? 'skewX(0deg)' : `skewX(${friesPos.bodySkew}deg)`,
                    transformOrigin: 'bottom center',
                }}
            >
                {/* Papas asomando arriba */}
                <div className="absolute flex gap-1.5" style={{ top: -18, left: 18 }}>
                    {[24, 30, 20, 28].map((h, i) => (
                        <div key={i} className="rounded-t-sm" style={{ width: 10, height: h, backgroundColor: '#E8B33C', alignSelf: 'flex-end', marginTop: 30 - h }} />
                    ))}
                </div>
                <div
                    className="absolute flex gap-5 transition-all duration-200 ease-out"
                    style={{
                        left: isPassword ? 18 : 38 + friesPos.faceX,
                        top: isPassword ? 34 : 44 + friesPos.faceY,
                    }}
                >
                    <Pupil mouseX={mouseX} mouseY={mouseY} {...away} />
                    <Pupil mouseX={mouseX} mouseY={mouseY} {...away} />
                </div>
                {/* Boca */}
                <div
                    className="absolute rounded-full transition-all duration-200 ease-out"
                    style={{
                        width: 44, height: 4, backgroundColor: INK,
                        left: isPassword ? 12 : 32 + friesPos.faceX,
                        top: isPassword ? 78 : 86 + friesPos.faceY,
                    }}
                />
            </div>
        </div>
    );
}
