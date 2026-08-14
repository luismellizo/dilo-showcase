import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useMotionValue, useTransform, useSpring } from 'framer-motion';
import {
  ArrowRight,
  BrainCircuit,
  Bot,
  Camera,
  Check,
  ChefHat,
  ChevronDown,
  Clock,
  CreditCard,
  Flame,
  LayoutDashboard,
  Menu as MenuIcon,
  MessageCircle,
  Repeat,
  ShieldCheck,
  Star,
  TrendingUp,
  Users,
  X,
  Zap
} from 'lucide-react';
import AuthModal from './AuthModal';
import { useAuth } from './AuthContext';
import DiloLogo from './DiloLogo';
import { COMPANY, legalLine, CURRENT_YEAR } from './companyInfo';

// ============================================================
// Paleta corporativa: claro premium + naranja Rapi (acento)
// ============================================================
const ORANGE = '#FF441F';
const ORANGE_SOFT = '#FF7A2F';
const INK = '#FAF9F6';
const TEXT = '#16130F';

const reveal = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0 }
};

const Reveal = ({ children, delay = 0, className = '' }) => (
  <motion.div
    className={className}
    variants={reveal}
    initial="hidden"
    whileInView="show"
    viewport={{ once: true, amount: 0.25 }}
    transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
  >
    {children}
  </motion.div>
);

const Pill = ({ children }) => (
  <span
    className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[12px] font-semibold uppercase tracking-[0.18em]"
    style={{ borderColor: 'rgba(255,68,31,0.3)', color: ORANGE, background: 'rgba(255,68,31,0.06)' }}
  >
    {children}
  </span>
);

const PrimaryBtn = ({ children, onClick, className = '' }) => (
  <button
    onClick={onClick}
    className={`group inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-bold text-black transition-transform hover:-translate-y-0.5 ${className}`}
    style={{ background: ORANGE, boxShadow: '0 12px 30px -10px rgba(255,68,31,0.5)' }}
  >
    {children}
  </button>
);

const GhostBtn = ({ children, onClick, className = '' }) => (
  <button
    onClick={onClick}
    className={`inline-flex items-center justify-center gap-2 rounded-full border px-6 py-3.5 text-sm font-semibold transition-colors hover:border-black/30 ${className}`}
    style={{ borderColor: 'rgba(0,0,0,0.15)', color: TEXT }}
  >
    {children}
  </button>
);

// ============================================================
// Navbar
// ============================================================
const Navbar = ({ onLogin, onRegister, onDashboard, authed }) => {
  const [open, setOpen] = useState(false);
  const links = [
    { href: '#producto', label: 'Producto' },
    { href: '#como', label: 'Cómo funciona' },
    { href: '#precios', label: 'Precios' },
    { href: '#faq', label: 'Preguntas' }
  ];
  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3">
      <div className="mx-auto mt-4 flex max-w-6xl items-center justify-between rounded-2xl border border-black/10 bg-white/80 px-5 py-3 shadow-sm backdrop-blur-xl">
        <DiloLogo height={26} color={TEXT} />
        <nav className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium text-black/60 transition-colors hover:text-black">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          {authed ? (
            <PrimaryBtn onClick={onDashboard}>Ir al panel <ArrowRight size={16} /></PrimaryBtn>
          ) : (
            <>
              <button onClick={onLogin} className="text-sm font-semibold text-black/70 hover:text-black">Entrar</button>
              <PrimaryBtn onClick={onRegister}>Prueba 14 días gratis</PrimaryBtn>
            </>
          )}
        </div>
        <button className="md:hidden" style={{ color: TEXT }} onClick={() => setOpen((v) => !v)}>
          {open ? <X size={22} /> : <MenuIcon size={22} />}
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mx-auto mt-2 max-w-6xl rounded-2xl border border-black/10 bg-white p-4 shadow-xl md:hidden"
          >
            {links.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="block px-2 py-3 text-black/70">
                {l.label}
              </a>
            ))}
            <PrimaryBtn onClick={() => { setOpen(false); onRegister(); }} className="mt-2 w-full">Prueba 14 días gratis</PrimaryBtn>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};

// ============================================================
// Mockup de chat (puro código) para el hero — conversación en loop
// que demuestra la venta sugerida (sube el ticket en vivo).
// Teléfono 3D hiperrealista: marco titanio + dynamic island + status
// bar + interfaz WhatsApp real (burbujas con cola, doble check azul,
// botón de pago estilo WA) + tilt 3D que sigue el mouse + reflejo de
// vidrio. Es la pieza principal del hero: el "ejemplo de uso" que ve
// el cliente antes de registrarse.
// ============================================================
const WA_HEADER = '#075E54';
const WA_ACCENT = '#128C7E';
const WA_OUT_BUBBLE = '#DCF8C6';
const WA_BG = '#ECE5DD';

const CheckDouble = () => (
  <svg width="15" height="10" viewBox="0 0 16 11" fill="none" className="shrink-0">
    <path d="M1 5.5L4.5 9L11.5 1" stroke="#4FC3F7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 5.5L8.5 9L15.5 1" stroke="#4FC3F7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ChatBubble = ({ from, children, delay, time }) => (
  <motion.div
    initial={{ opacity: 0, y: 10, scale: 0.96 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ delay, duration: 0.4 }}
    className={`max-w-[78%] px-2.5 pb-1 pt-1.5 text-[13px] leading-snug text-[#111] shadow-sm ${
      from === 'bot' ? 'self-start rounded-t-lg rounded-br-lg rounded-bl-[2px]' : 'self-end rounded-t-lg rounded-bl-lg rounded-br-[2px]'
    }`}
    style={{ background: from === 'bot' ? '#fff' : WA_OUT_BUBBLE }}
  >
    <div>{children}</div>
    <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-black/40">
      {time}
      {from === 'user' && <CheckDouble />}
    </div>
  </motion.div>
);

const CHAT_LOOP_MS = 12000;

const PhoneMockup = () => {
  // Reiniciar la conversación en loop: cambiar la key remonta las burbujas.
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setCycle((c) => c + 1), CHAT_LOOP_MS);
    return () => clearInterval(id);
  }, []);

  // Tilt 3D que sigue el mouse (efecto premium tipo Apple).
  const mvX = useMotionValue(0);
  const mvY = useMotionValue(0);
  const rotateX = useSpring(useTransform(mvY, [-0.5, 0.5], [9, -9]), { stiffness: 150, damping: 20 });
  const rotateY = useSpring(useTransform(mvX, [-0.5, 0.5], [-9, 9]), { stiffness: 150, damping: 20 });

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mvX.set((e.clientX - rect.left) / rect.width - 0.5);
    mvY.set((e.clientY - rect.top) / rect.height - 0.5);
  };
  const handleMouseLeave = () => {
    mvX.set(0);
    mvY.set(0);
  };

  return (
    <div
      className="relative mx-auto w-[300px]"
      style={{ perspective: 1800 }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* halo naranja + sombra de piso (le da profundidad real) */}
      <div
        className="absolute -inset-10 -z-10 rounded-full opacity-40 blur-3xl"
        style={{ background: `radial-gradient(circle, ${ORANGE}, transparent 60%)` }}
      />
      <div
        className="absolute -bottom-8 left-1/2 h-10 w-52 -translate-x-1/2 rounded-full opacity-50 blur-2xl"
        style={{ background: 'radial-gradient(ellipse, rgba(0,0,0,0.55), transparent 70%)' }}
      />

      <motion.div
        style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
        animate={{ y: [0, -10, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        className="relative"
      >
        {/* botones laterales (relieve metálico) */}
        <div className="absolute -left-[3px] top-24 h-8 w-[3px] rounded-l-sm" style={{ background: 'linear-gradient(180deg,#4a4a4a,#111)' }} />
        <div className="absolute -left-[3px] top-[8.5rem] h-14 w-[3px] rounded-l-sm" style={{ background: 'linear-gradient(180deg,#4a4a4a,#111)' }} />
        <div className="absolute -right-[3px] top-32 h-16 w-[3px] rounded-r-sm" style={{ background: 'linear-gradient(180deg,#4a4a4a,#111)' }} />

        {/* marco titanio */}
        <div
          className="rounded-[3rem] p-[3px]"
          style={{
            background: 'linear-gradient(135deg, #5a5a5a, #1a1a1a 30%, #3a3a3a 65%, #0a0a0a)',
            boxShadow: '0 50px 100px -20px rgba(0,0,0,0.55), 0 10px 30px -10px rgba(0,0,0,0.4)'
          }}
        >
          <div className="rounded-[2.85rem] bg-black p-[9px]">
            <div className="relative overflow-hidden rounded-[2.35rem] bg-white">
              {/* dynamic island */}
              <div className="absolute left-1/2 top-2 z-30 h-[22px] w-[88px] -translate-x-1/2 rounded-full bg-black" />

              {/* status bar */}
              <div className="relative z-10 flex items-center justify-between px-6 pb-1 pt-3 text-[11px] font-semibold text-white" style={{ background: WA_HEADER }}>
                <span>9:41</span>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-end gap-[1.5px]">
                    <span className="h-[3px] w-[3px] rounded-sm bg-white" />
                    <span className="h-[5px] w-[3px] rounded-sm bg-white" />
                    <span className="h-[7px] w-[3px] rounded-sm bg-white" />
                    <span className="h-[9px] w-[3px] rounded-sm bg-white" />
                  </div>
                  <span className="h-[9px] w-4 rounded-[2px] border border-white/80" />
                </div>
              </div>

              {/* header WhatsApp */}
              <div className="flex items-center gap-2.5 px-3 pb-2.5 pt-1" style={{ background: WA_HEADER }}>
                <ChevronDown className="rotate-90 text-white/90" size={18} />
                <div className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: ORANGE }}>
                  <Bot size={18} className="text-black" />
                </div>
                <div className="flex-1">
                  <p className="text-[13px] font-bold text-white">Burger House</p>
                  <p className="text-[10.5px] text-white/70">en línea</p>
                </div>
              </div>

              {/* fondo de chat con textura sutil (doodle WhatsApp) */}
              <div
                key={cycle}
                className="flex min-h-[350px] flex-col gap-1.5 px-2.5 py-3"
                style={{ background: WA_BG, backgroundImage: 'radial-gradient(rgba(0,0,0,0.035) 1px, transparent 1px)', backgroundSize: '14px 14px' }}
              >
                <ChatBubble from="bot" delay={0.3} time="9:41">¡Hola Caro! 👋 ¿Repetimos la doble bacon de la otra vez? 😋</ChatBubble>
                <ChatBubble from="user" delay={1.1} time="9:41">Jaja sí, y unas papas 🍟</ChatBubble>
                <ChatBubble from="bot" delay={2.0} time="9:42">🍔 Doble Bacon $28.000 + 🍟 Papas $9.000. ¿Le sumas limonada de coco por $6.000? 🥥</ChatBubble>
                <ChatBubble from="user" delay={3.0} time="9:42">Dale 😄</ChatBubble>
                <ChatBubble from="bot" delay={3.9} time="9:42">Total <b>$43.000</b>. Paga seguro aquí 👇</ChatBubble>
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 4.3, duration: 0.4 }}
                  className="max-w-[78%] self-start rounded-lg bg-white px-3 py-2.5 text-center text-[12.5px] font-bold shadow-sm"
                  style={{ color: WA_ACCENT }}
                >
                  💳 Pagar con Nequi
                </motion.div>
              </div>

              {/* barra de input */}
              <div className="flex items-center gap-2 border-t border-black/5 bg-[#F0F0F0] px-2.5 py-2">
                <div className="flex-1 rounded-full bg-white px-3 py-1.5 text-[12px] text-black/30 shadow-sm">Escribe un mensaje</div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: '#25D366' }}>
                  <Camera size={14} className="text-white" />
                </div>
              </div>

              {/* home indicator */}
              <div className="flex justify-center bg-white py-1.5">
                <div className="h-1 w-28 rounded-full bg-black/70" />
              </div>

              {/* reflejo de vidrio */}
              <div
                className="pointer-events-none absolute inset-0 z-40"
                style={{ background: 'linear-gradient(115deg, rgba(255,255,255,0.20) 0%, transparent 20%, transparent 80%, rgba(255,255,255,0.08) 100%)' }}
              />
            </div>
          </div>
        </div>
      </motion.div>

      {/* Notificaciones flotantes del dashboard */}
      <motion.div
        key={`notif-${cycle}`}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 4.6, duration: 0.5 }}
        className="absolute -right-6 top-24 hidden rounded-xl border border-black/10 bg-white/70 px-4 py-3 shadow-xl backdrop-blur-md lg:block"
      >
        <p className="text-[11px] font-medium text-black/45" style={{ color: 'rgba(0,0,0,0.45)' }}>Nuevo pedido</p>
        <p className="text-sm font-bold" style={{ color: TEXT }}>+ $43.000 🎉</p>
      </motion.div>
      <motion.div
        key={`notif2-${cycle}`}
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 5.4, duration: 0.5 }}
        className="absolute -left-8 bottom-16 hidden rounded-xl border border-black/10 bg-white/70 px-4 py-3 shadow-xl backdrop-blur-md lg:block"
      >
        <p className="text-[11px] font-medium text-black/45">Venta sugerida aceptada</p>
        <p className="text-sm font-bold" style={{ color: '#16a34a' }}>Ticket +16% 📈</p>
      </motion.div>
    </div>
  );
};

// ============================================================
// Hero
// ============================================================
const Hero = ({ onRegister, onLogin }) => (
  <section className="relative px-6 pt-36 pb-20 md:pt-44">
    <div
      className="pointer-events-none absolute inset-0 -z-10"
      style={{ background: `radial-gradient(60% 50% at 50% 0%, rgba(255,68,31,0.12), transparent 70%)` }}
    />
    <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-2">
      <div>
        <Reveal>
          <Pill><Zap size={13} /> El vendedor IA de tu restaurante</Pill>
        </Reveal>
        <Reveal delay={0.05}>
          <h1 className="mt-6 text-[2.6rem] font-black leading-[1.05] tracking-tight md:text-6xl" style={{ color: TEXT }}>
            Cada chat sin responder es plata perdida.<br />
            <span style={{ color: ORANGE }}>DILO los responde todos.</span>
          </h1>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-black/60">
            Un vendedor con IA dentro de tu WhatsApp: atiende en segundos,
            recuerda a cada cliente, sugiere más, cobra y te organiza la cocina.
            Mientras tú cocinas, él vende. <b style={{ color: TEXT }}>24/7.</b>
          </p>
        </Reveal>
        <Reveal delay={0.15}>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <PrimaryBtn onClick={onRegister} className="px-8 py-4 text-base">
              Crear mi vendedor IA gratis <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
            </PrimaryBtn>
            <GhostBtn onClick={onLogin} className="px-8 py-4 text-base">Ya tengo cuenta</GhostBtn>
          </div>
        </Reveal>
        <Reveal delay={0.2}>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-black/50">
            <span className="flex items-center gap-1.5"><Check size={15} style={{ color: ORANGE }} /> 14 días de PRO gratis</span>
            <span className="flex items-center gap-1.5"><Check size={15} style={{ color: ORANGE }} /> Sin tarjeta</span>
            <span className="flex items-center gap-1.5"><Check size={15} style={{ color: ORANGE }} /> Listo en 5 minutos</span>
          </div>
        </Reveal>
      </div>
      <Reveal delay={0.1}>
        <PhoneMockup />
      </Reveal>
    </div>
  </section>
);

// ============================================================
// Métricas (del pitch)
// ============================================================
const STATS = [
  { value: '+40%', label: 'más conversión', sub: 'respondes al instante 24/7' },
  { value: '−80%', label: 'carga operativa', sub: 'sin tomar pedidos a mano' },
  { value: '+25%', label: 'ticket promedio', sub: 'venta sugerida automática' },
  { value: '300M', label: 'usuarios WhatsApp', sub: 'el canal #1 en LATAM' }
];

const Stats = () => (
  <section className="border-y border-black/10 px-6 py-16">
    <div className="mx-auto grid max-w-6xl grid-cols-2 md:grid-cols-4 md:divide-x md:divide-black/10">
      {STATS.map((s, i) => (
        <Reveal key={s.label} delay={i * 0.05} className="px-2 py-4 text-center md:px-8 md:py-0">
          <p className="text-5xl font-black tracking-tight md:text-6xl" style={{ color: i % 2 ? ORANGE_SOFT : ORANGE }}>{s.value}</p>
          <p className="mt-3 font-semibold" style={{ color: TEXT }}>{s.label}</p>
          <p className="text-sm text-black/45">{s.sub}</p>
        </Reveal>
      ))}
    </div>
  </section>
);

// ============================================================
// Problema
// ============================================================
const PROBLEMS = [
  { icon: Clock, title: 'Respondes tarde, pierdes la venta', text: 'El 40% de los clientes abandona si no contestas en menos de 5 minutos. A la hora pico, contestas tarde siempre.' },
  { icon: CreditCard, title: 'Verificar pagos a mano es un caos', text: 'Revisar capturas de Nequi mientras despachas pedidos genera cuellos de botella, errores y fraudes.' },
  { icon: Users, title: 'No sabes quién te compra', text: 'Sin historial ni preferencias, cada cliente es un desconocido. Y un cliente que no recuerdas no vuelve.' }
];

const Problem = () => (
  <section className="px-6 py-24">
    <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.9fr_1.1fr]">
      <Reveal>
        <h2 className="text-3xl font-black leading-tight tracking-tight md:text-5xl" style={{ color: TEXT }}>
          Vender por WhatsApp<br />a mano te está<br /><span style={{ color: ORANGE }}>costando plata.</span>
        </h2>
        <p className="mt-6 max-w-sm text-black/55">Los restaurantes lo viven todos los días, hora pico tras hora pico.</p>
      </Reveal>
      <div className="divide-y divide-black/10 border-t border-black/10">
        {PROBLEMS.map((p, i) => (
          <Reveal key={p.title} delay={i * 0.08}>
            <div className="flex items-start gap-5 py-7">
              <p.icon size={26} style={{ color: ORANGE }} className="mt-1 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-bold" style={{ color: TEXT }}>{p.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-black/55">{p.text}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

// ============================================================
// Antes / Con DILO — comparación directa (conversión)
// ============================================================
const BEFORE = [
  'El celular suena y nadie contesta hasta que alguien se desocupa',
  'Pedidos anotados en papelitos que se pierden',
  'Capturas de Nequi revisadas una por una',
  '“¿Cuánto vale?, ¿hay domicilio?” cien veces al día',
  'El cliente de la semana pasada es un desconocido'
];

const AFTER = [
  'El bot contesta en 2 segundos, también a las 11pm',
  'Cada pedido entra solo al panel y a la pantalla de cocina',
  'Cobro con link de pago o comprobante organizado',
  'Precios, horarios y domicilios respondidos al instante',
  'Saluda por su nombre y le sugiere su pedido favorito'
];

const BeforeAfter = ({ onRegister }) => (
  <section className="px-6 pb-24">
    <div className="mx-auto max-w-6xl">
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-black tracking-tight md:text-4xl" style={{ color: TEXT }}>
          Tu operación, antes y después.
        </h2>
      </Reveal>
      <div className="mt-12 grid gap-6 md:grid-cols-2">
        <Reveal>
          <div className="h-full rounded-3xl border border-black/10 bg-black/[0.02] p-8">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-black/40">Hoy, a mano</p>
            <ul className="mt-6 space-y-4">
              {BEFORE.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[15px] text-black/55">
                  <X size={18} className="mt-0.5 flex-shrink-0 text-red-500/80" /> {item}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <div
            className="relative h-full overflow-hidden rounded-3xl border p-8"
            style={{ borderColor: 'rgba(255,68,31,0.35)', background: 'rgba(255,68,31,0.05)', boxShadow: '0 25px 60px -30px rgba(255,68,31,0.35)' }}
          >
            <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em]" style={{ color: ORANGE }}>
              <Flame size={15} /> Con DILO
            </p>
            <ul className="mt-6 space-y-4">
              {AFTER.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[15px]" style={{ color: 'rgba(22,19,15,0.85)' }}>
                  <Check size={18} className="mt-0.5 flex-shrink-0" style={{ color: ORANGE }} /> {item}
                </li>
              ))}
            </ul>
            <PrimaryBtn onClick={onRegister} className="mt-8 w-full">
              Quiero esto en mi restaurante <ArrowRight size={16} />
            </PrimaryBtn>
          </div>
        </Reveal>
      </div>
    </div>
  </section>
);

// ============================================================
// Features
// ============================================================
const FEATURES = [
  { icon: Bot, title: 'Bot de IA 24/7', text: 'Atiende, recomienda y cierra pedidos solo. Con memoria de cada cliente.' },
  { icon: Camera, title: 'Menú con una foto', text: 'Sube la foto de tu carta y la IA arma el menú digital. Tú solo ajustas.' },
  { icon: CreditCard, title: 'Pagos integrados', text: 'Wompi, Bold y verificación de comprobantes Nequi. Cobro sin fricción.' },
  { icon: LayoutDashboard, title: 'Panel en tiempo real', text: 'Tablero Kanban: ves cada pedido entrar y avanzar al instante.' },
  { icon: MessageCircle, title: 'Tu WhatsApp de siempre', text: 'Conectas tu número de negocio en un clic. Tus clientes no instalan nada.' },
  { icon: TrendingUp, title: 'Base de clientes', text: 'Historial, gasto y favoritos de cada cliente para hacerlos volver.' }
];

const Features = () => (
  <section id="producto" className="px-6 py-24">
    <div className="mx-auto max-w-6xl">
      <Reveal className="mx-auto max-w-2xl text-center">
        <Pill>Todo en un solo lugar</Pill>
        <h2 className="mt-6 text-3xl font-black tracking-tight md:text-4xl" style={{ color: TEXT }}>
          Un ecosistema completo para vender más y trabajar menos.
        </h2>
      </Reveal>
      <div className="mt-14 grid gap-5 md:grid-cols-3 md:auto-rows-[190px]">
        {FEATURES.map((f, i) => {
          const big = i === 0;
          const bordered = !big && i % 2 === 0;
          return (
            <Reveal key={f.title} delay={(i % 3) * 0.07} className={big ? 'md:col-span-2 md:row-span-2' : ''}>
              <div
                className={`group flex h-full flex-col justify-between rounded-2xl p-7 transition-colors ${
                  bordered ? 'border border-black/10 bg-black/[0.02] hover:border-[rgba(255,68,31,0.4)]' : big ? '' : 'px-1'
                }`}
                style={big ? { background: `linear-gradient(135deg, ${ORANGE} 0%, ${ORANGE_SOFT} 100%)` } : undefined}
              >
                <f.icon size={big ? 34 : 24} style={{ color: big ? '#000' : ORANGE }} />
                <div className="mt-auto pt-6">
                  <h3 className={`font-bold ${big ? 'text-2xl text-black' : 'text-lg'}`} style={big ? undefined : { color: TEXT }}>{f.title}</h3>
                  <p className={`mt-2 text-sm leading-relaxed ${big ? 'text-black/70' : 'text-black/55'}`}>{f.text}</p>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </div>
  </section>
);

// ============================================================
// Diferenciadores (lo que nadie más hace)
// ============================================================
const DIFFERENTIATORS = [
  {
    icon: BrainCircuit,
    title: 'Memoria infinita de cada cliente',
    text: 'Recuerda para siempre a quién le vendes. En la próxima compra saluda por su nombre y su último pedido.',
    quote: '“¡Hola Manuel! 👋 ¿Qué tal el Combo Doble de la otra vez? ¿Vas a querer lo mismo?”'
  },
  {
    icon: Repeat,
    title: 'Recompra automática',
    text: 'Si un cliente lleva días sin pedir, el agente le escribe solo para reactivar la venta. Plata que se estaba yendo, vuelve.',
    quote: '“Hace rato no te vemos 🥹 ¿Se te antoja tu pizza favorita? Pídela aquí 👇”'
  },
  {
    icon: ChefHat,
    title: 'Pantalla de cocina en vivo',
    text: 'Cada pedido aparece al instante en un monitor para tus cocineros, en orden de llegada y con cronómetro. Cero papelitos.',
    quote: 'Monitor en cocina · pedidos en tiempo real · sin errores'
  }
];

const Differentiators = () => (
  <section className="px-6 py-24">
    <div className="mx-auto max-w-6xl">
      <Reveal className="mx-auto max-w-2xl text-center">
        <Pill><Star size={13} /> Lo que nos hace distintos</Pill>
        <h2 className="mt-6 text-3xl font-black tracking-tight md:text-4xl" style={{ color: TEXT }}>
          No es solo un bot. Es un vendedor que <span style={{ color: ORANGE }}>recuerda, reactiva y organiza.</span>
        </h2>
      </Reveal>
      <div className="mt-16 space-y-16">
        {DIFFERENTIATORS.map((d, i) => (
          <Reveal key={d.title} delay={i * 0.08}>
            <div className={`flex flex-col items-center gap-10 md:flex-row ${i % 2 === 1 ? 'md:flex-row-reverse' : ''}`}>
              <div className="flex-1">
                <span className="text-6xl font-black" style={{ color: 'rgba(255,68,31,0.16)' }}>0{i + 1}</span>
                <div className="mt-2 flex items-center gap-3">
                  <d.icon size={24} style={{ color: ORANGE }} />
                  <h3 className="text-2xl font-bold" style={{ color: TEXT }}>{d.title}</h3>
                </div>
                <p className="mt-3 max-w-md text-black/60">{d.text}</p>
              </div>
              <div className="flex-1">
                <p className="rounded-2xl border-l-4 px-6 py-5 text-lg italic leading-relaxed" style={{ borderColor: ORANGE, background: 'rgba(255,68,31,0.05)', color: 'rgba(22,19,15,0.8)' }}>
                  {d.quote}
                </p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

// ============================================================
// Cómo funciona
// ============================================================
const STEPS = [
  { n: '01', title: 'Conecta tu WhatsApp', text: 'Vincula el número de tu negocio en un clic.' },
  { n: '02', title: 'Sube tu menú', text: 'Una foto de la carta y la IA crea tus productos y precios.' },
  { n: '03', title: 'Entrena a tu bot', text: 'Horarios, domicilios, tono. Solo responde con TU información: nunca inventa.' },
  { n: '04', title: 'Él vende, tú cocinas', text: 'Atiende, sugiere, cobra. Tú ves todo en el panel y despachas.' }
];

const Steps = ({ onRegister }) => (
  <section id="como" className="border-y border-black/10 bg-black/[0.015] px-6 py-24">
    <div className="mx-auto max-w-6xl">
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-black tracking-tight md:text-4xl" style={{ color: TEXT }}>De cero a vender en 5 minutos.</h2>
        <p className="mt-4 text-black/55">Sin programar. Sin manuales. Sin técnico.</p>
      </Reveal>
      <div className="relative mt-16 grid gap-10 md:grid-cols-4">
        <div className="pointer-events-none absolute left-0 right-0 top-6 hidden h-px bg-black/10 md:block" />
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={i * 0.08} className="relative">
            <div className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-black text-black" style={{ background: ORANGE }}>
              {s.n}
            </div>
            <h3 className="mt-5 text-lg font-bold" style={{ color: TEXT }}>{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-black/55">{s.text}</p>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.2} className="mt-14 text-center">
        <PrimaryBtn onClick={onRegister} className="px-8 py-4 text-base">
          Empezar ahora — es gratis <ArrowRight size={18} />
        </PrimaryBtn>
      </Reveal>
    </div>
  </section>
);

// ============================================================
// Testimonios
// TODO: reemplazar por testimonios REALES (nombre + foto + negocio)
// apenas existan. Estos son ilustrativos del caso de uso.
// ============================================================
const TESTIMONIALS = [
  {
    quote: 'Antes se nos enfriaba el WhatsApp a la hora del almuerzo. Ahora el bot toma los pedidos y nosotros solo cocinamos. Los domingos vendemos sin tener a nadie en el teléfono.',
    who: 'Restaurante de hamburguesas',
    where: 'Bucaramanga'
  },
  {
    quote: 'Lo que más me sorprendió: le escribe a los clientes que llevan días sin pedir. Esa plata antes se perdía y ni nos dábamos cuenta.',
    who: 'Pizzería de barrio',
    where: 'Floridablanca'
  },
  {
    quote: 'Subí la foto de la carta y en un minuto tenía el menú montado con precios. Mi mamá, que no sabe de tecnología, lo administra sola.',
    who: 'Comida casera por domicilio',
    where: 'Girón'
  }
];

const Testimonials = () => {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % TESTIMONIALS.length), 6000);
    return () => clearInterval(id);
  }, []);
  const t = TESTIMONIALS[i];
  return (
    <section className="px-6 py-24">
      <div className="mx-auto max-w-3xl text-center">
        <Reveal>
          <Pill><MessageCircle size={13} /> Lo que dicen</Pill>
          <h2 className="mt-6 text-3xl font-black tracking-tight md:text-4xl" style={{ color: TEXT }}>
            Restaurantes que ya venden mientras duermen.
          </h2>
        </Reveal>
        <AnimatePresence mode="wait">
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.4 }}
            className="mt-10"
          >
            <div className="flex justify-center gap-1" style={{ color: ORANGE }}>
              {[...Array(5)].map((_, j) => <Star key={j} size={16} fill={ORANGE} />)}
            </div>
            <p className="mt-6 text-xl font-medium leading-relaxed md:text-2xl" style={{ color: 'rgba(22,19,15,0.85)' }}>“{t.quote}”</p>
            <p className="mt-6 text-sm font-bold" style={{ color: TEXT }}>
              {t.who} <span className="font-normal text-black/40">· {t.where}, Colombia</span>
            </p>
          </motion.div>
        </AnimatePresence>
        <div className="mt-9 flex justify-center gap-2">
          {TESTIMONIALS.map((_, j) => (
            <button
              key={j}
              onClick={() => setI(j)}
              aria-label={`Testimonio ${j + 1}`}
              className="h-1.5 rounded-full transition-all"
              style={{ width: j === i ? 24 : 8, background: j === i ? ORANGE : 'rgba(0,0,0,0.15)' }}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

// ============================================================
// Precios
//
// ⚠️ PRECIOS Y CUPOS REALES OMITIDOS — información comercial.
//    Los valores de abajo son placeholders. La estructura de planes y su
//    correspondencia con el backend (ver orders/migrations/0013_seed_plans.py
//    y orders/billing.py) sí es la real.
// ============================================================
const PLANS = [
  {
    name: 'Gratis',
    price: '0',
    period: 'para siempre',
    popular: false,
    desc: 'Prueba el vendedor IA sin pagar un peso.',
    cta: 'Empezar gratis',
    features: [
      'Cupo mensual de conversaciones',
      'Bot de IA en WhatsApp',
      'Menú por foto con IA',
      'Panel de pedidos en tiempo real'
    ]
  },
  {
    name: 'PRO',
    price: '—',
    period: '/mes',
    popular: true,
    desc: 'Para restaurantes que venden todos los días.',
    cta: 'Probar PRO gratis',
    features: [
      'Cupo ampliado de conversaciones',
      'Todo lo del plan Gratis',
      'Memoria y base de clientes',
      'Recompra automática (win-back)',
      'Pantalla de cocina en vivo',
      'Soporte prioritario'
    ]
  },
  {
    name: 'PREMIUM',
    price: '—',
    period: '/mes',
    popular: false,
    desc: 'Para alto volumen y varias marcas.',
    cta: 'Elegir PREMIUM',
    features: [
      'Cupo alto de conversaciones',
      'Todo lo de PRO',
      'Métricas avanzadas',
      'Acompañamiento personalizado'
    ]
  }
];

const Pricing = ({ onRegister }) => (
  <section id="precios" className="px-6 py-24">
    <div className="mx-auto max-w-6xl">
      <Reveal className="mx-auto max-w-2xl text-center">
        <Pill>Precios claros</Pill>
        <h2 className="mt-6 text-3xl font-black tracking-tight md:text-4xl" style={{ color: TEXT }}>
          Menos de lo que vendes en un día.
        </h2>
        <p className="mt-4 text-black/55">
          Una conversación = un cliente atendido en una ventana de 24 horas.
          Sin contratos, cancela cuando quieras.
        </p>
      </Reveal>
      <div className="mt-14 grid items-stretch gap-6 md:grid-cols-3">
        {PLANS.map((p, i) => (
          <Reveal key={p.name} delay={i * 0.08}>
            <div
              className="flex h-full flex-col rounded-3xl border p-8"
              style={p.popular
                ? { borderColor: ORANGE, background: 'rgba(255,68,31,0.06)', boxShadow: '0 20px 50px -20px rgba(255,68,31,0.35)' }
                : { borderColor: 'rgba(0,0,0,0.1)', background: 'rgba(0,0,0,0.015)' }}
            >
              {p.popular && (
                <span className="mb-4 inline-flex w-fit items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold text-black" style={{ background: ORANGE }}>
                  <Star size={12} /> MÁS POPULAR
                </span>
              )}
              <h3 className="text-lg font-bold" style={{ color: TEXT }}>{p.name}</h3>
              <p className="mt-1 text-sm text-black/50">{p.desc}</p>
              <div className="mt-5 flex items-end gap-1">
                <span className="text-4xl font-black" style={{ color: TEXT }}>${p.price}</span>
                <span className="mb-1 text-sm text-black/45">{p.period}</span>
              </div>
              <ul className="mt-6 flex-1 space-y-3">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-black/65">
                    <Check size={17} style={{ color: ORANGE }} className="mt-0.5 flex-shrink-0" /> {f}
                  </li>
                ))}
              </ul>
              {p.popular ? (
                <PrimaryBtn onClick={onRegister} className="mt-8 w-full">{p.cta}</PrimaryBtn>
              ) : (
                <GhostBtn onClick={onRegister} className="mt-8 w-full">{p.cta}</GhostBtn>
              )}
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.2}>
        <p className="mt-8 flex items-center justify-center gap-2 text-center text-sm text-black/50">
          <ShieldCheck size={16} style={{ color: ORANGE }} />
          Al registrarte recibes 14 días de PRO gratis. Sin tarjeta. Si no te sirve, no pagas.
        </p>
      </Reveal>
    </div>
  </section>
);

// ============================================================
// FAQ — mata objeciones antes del registro
// ============================================================
const FAQS = [
  {
    q: '¿Necesito saber de tecnología?',
    a: 'No. Si sabes usar WhatsApp, sabes usar DILO. Conectas tu canal, subes una foto de tu menú y listo. Todo se configura desde un panel en español, pensado para dueños de restaurante, no para ingenieros.'
  },
  {
    q: '¿La IA puede inventarse precios o promociones?',
    a: 'No. El bot solo responde con la información que TÚ configuras: tu menú, tus precios, tus horarios, tus zonas de domicilio. Si le preguntan algo que no sabe, lo dice honestamente y sigue con el pedido. Nunca improvisa datos de tu negocio.'
  },
  {
    q: '¿Funciona con mi número de WhatsApp actual?',
    a: 'Funciona con WhatsApp Business API: conectas el número de tu negocio en un clic, sin cambiar de línea ni pedirle a tus clientes que instalen nada.'
  },
  {
    q: '¿Qué pasa cuando se acaban mis conversaciones del mes?',
    a: 'Los pedidos en curso nunca se cortan: toda conversación abierta se atiende completa. Si llegas al límite, el bot avisa con cortesía a los clientes nuevos y tú decides si subes de plan. Sin sorpresas ni cobros automáticos.'
  },
  {
    q: '¿Cómo cobro a mis clientes?',
    a: 'Como prefieras: link de pago (Wompi), o Nequi/transferencia con foto del comprobante que te llega organizada al panel. El bot dicta TUS datos de pago, los que tú configures.'
  },
  {
    q: '¿Puedo cancelar cuando quiera?',
    a: 'Sí. No hay contratos ni permanencias. Y el plan Gratis es gratis para siempre, con su cupo de conversaciones cada mes sin pagar nada.'
  }
];

const FaqItem = ({ q, a }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 bg-black/[0.02]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
      >
        <span className="font-semibold" style={{ color: TEXT }}>{q}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="flex-shrink-0" style={{ color: ORANGE }}>
          <ChevronDown size={18} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
          >
            <p className="px-6 pb-5 text-sm leading-relaxed text-black/60">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Faq = () => (
  <section id="faq" className="border-t border-black/10 px-6 py-24">
    <div className="mx-auto max-w-3xl">
      <Reveal className="text-center">
        <Pill>Preguntas frecuentes</Pill>
        <h2 className="mt-6 text-3xl font-black tracking-tight md:text-4xl" style={{ color: TEXT }}>
          Lo que todos preguntan antes de empezar.
        </h2>
      </Reveal>
      <div className="mt-12 space-y-3">
        {FAQS.map((f, i) => (
          <Reveal key={f.q} delay={i * 0.04}>
            <FaqItem q={f.q} a={f.a} />
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

// ============================================================
// CTA final
// ============================================================
const FinalCTA = ({ onRegister }) => (
  <section className="px-6 py-24">
    <Reveal className="mx-auto max-w-5xl">
      <div
        className="relative overflow-hidden rounded-[2.5rem] px-8 py-16 text-center md:px-16"
        style={{ background: `linear-gradient(135deg, ${ORANGE} 0%, ${ORANGE_SOFT} 100%)` }}
      >
        <div className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, #fff 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        <div className="relative">
          <h2 className="mx-auto max-w-3xl text-3xl font-black leading-tight tracking-tight text-black md:text-5xl">
            Esta noche te van a escribir.<br />¿Quién va a contestar?
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-black/70">
            Activa tu vendedor IA en 5 minutos. 14 días de PRO gratis, sin tarjeta.
          </p>
          <button
            onClick={onRegister}
            className="mt-9 inline-flex items-center gap-2 rounded-full bg-black px-9 py-4 text-base font-bold text-white transition-transform hover:-translate-y-0.5"
          >
            Crear mi vendedor IA <ArrowRight size={18} />
          </button>
          <p className="mt-4 text-sm font-medium text-black/60">Plan gratis para siempre · Cancela cuando quieras</p>
        </div>
      </div>
    </Reveal>
  </section>
);

// ============================================================
// Footer
// ============================================================
// Los datos legales del footer no son decoración: Meta cruza lo que dice el
// sitio público con los documentos de la Verificación del Negocio. Salen de
// companyInfo.js para que footer, privacidad y términos nunca se contradigan.
const Footer = () => (
  <footer className="border-t border-black/10 px-6 py-12 pb-24 md:pb-12">
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
        <div className="flex items-center gap-3">
          <DiloLogo height={24} color={TEXT} />
          <span className="text-sm text-black/45">Ventas por WhatsApp con IA</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-black/55">
          <a href="#producto" className="hover:text-black">Producto</a>
          <a href="#precios" className="hover:text-black">Precios</a>
          <a href="/privacy" className="hover:text-black">Privacidad</a>
          <a href="/terms" className="hover:text-black">Términos</a>
          <a href="/data-deletion" className="hover:text-black">Eliminar datos</a>
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center gap-2 border-t border-black/5 pt-6 text-center md:flex-row md:justify-between md:text-left">
        <p className="text-xs text-black/45">{legalLine()}</p>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-black/45">
          <a href={`mailto:${COMPANY.emails.support}`} className="hover:text-black">
            {COMPANY.emails.support}
          </a>
          {COMPANY.phone && (
            <a href={`tel:${COMPANY.phone.replace(/\s/g, '')}`} className="hover:text-black">
              {COMPANY.phone}
            </a>
          )}
          <span>© {CURRENT_YEAR} {COMPANY.brand} · Hecho en Colombia 🇨🇴</span>
        </div>
      </div>

      <p className="mt-6 text-center text-[11px] leading-relaxed text-black/30 md:text-left">
        {COMPANY.brand} es un proveedor de tecnología independiente. No está afiliado
        a, ni patrocinado por, Meta Platforms, Inc. WhatsApp es una marca registrada
        de Meta Platforms, Inc.
      </p>
    </div>
  </footer>
);

// ============================================================
// CTA fija inferior (solo móvil) — el pulgar siempre tiene
// un botón de registro a un toque.
// ============================================================
const MobileCtaBar = ({ onRegister }) => (
  <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/90 px-4 py-3 shadow-[0_-8px_30px_-15px_rgba(0,0,0,0.3)] backdrop-blur-xl md:hidden">
    <PrimaryBtn onClick={onRegister} className="w-full py-3.5">
      Empieza gratis — 14 días de PRO <ArrowRight size={16} />
    </PrimaryBtn>
  </div>
);

// ============================================================
// CTA flotante (solo desktop, aparece al pasar el hero) — tarjeta
// abajo a la izquierda para no chocar con el navbar ni con el
// centro de la pantalla; en móvil ya existe MobileCtaBar.
// ============================================================
const DesktopStickyCta = ({ visible, onRegister }) => (
  <AnimatePresence>
    {visible && (
      <motion.div
        initial={{ x: -80, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: -80, opacity: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="fixed bottom-6 left-6 z-40 hidden max-w-xs rounded-2xl border border-black/10 bg-white p-5 shadow-2xl md:block"
      >
        <p className="text-sm font-semibold" style={{ color: TEXT }}>
          ¿Listo para que DILO conteste por ti? <span className="font-normal text-black/50">14 días de PRO gratis, sin tarjeta.</span>
        </p>
        <PrimaryBtn onClick={onRegister} className="mt-4 w-full px-5 py-2.5 text-[13px]">
          Crear mi vendedor IA <ArrowRight size={14} />
        </PrimaryBtn>
      </motion.div>
    )}
  </AnimatePresence>
);

// ============================================================
// Página
// ============================================================
export default function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated, loading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [scrolledPastHero, setScrolledPastHero] = useState(false);

  useEffect(() => {
    if (!loading && isAuthenticated) navigate('/dashboard');
  }, [isAuthenticated, loading, navigate]);

  useEffect(() => {
    const onScroll = () => setScrolledPastHero(window.scrollY > 700);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const openLogin = () => { setAuthMode('login'); setShowAuthModal(true); };
  const openRegister = () => { setAuthMode('register'); setShowAuthModal(true); };
  const goDashboard = () => navigate('/dashboard');
  const handleAuthSuccess = () => { setShowAuthModal(false); navigate('/dashboard'); };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: INK }}>
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-black/10" style={{ borderTopColor: ORANGE }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: INK, color: TEXT }}>
      <Navbar onLogin={openLogin} onRegister={openRegister} onDashboard={goDashboard} authed={isAuthenticated} />
      <main>
        <Hero onRegister={openRegister} onLogin={openLogin} />
        <Stats />
        <Problem />
        <BeforeAfter onRegister={openRegister} />
        <Features />
        <Differentiators />
        <Steps onRegister={openRegister} />
        <Testimonials />
        <Pricing onRegister={openRegister} />
        <Faq />
        <FinalCTA onRegister={openRegister} />
      </main>
      <Footer />
      {!isAuthenticated && !showAuthModal && <MobileCtaBar onRegister={openRegister} />}
      {!isAuthenticated && !showAuthModal && (
        <DesktopStickyCta visible={scrolledPastHero} onRegister={openRegister} />
      )}

      <AnimatePresence>
        {showAuthModal && (
          <AuthModal
            mode={authMode}
            onClose={() => setShowAuthModal(false)}
            onSuccess={handleAuthSuccess}
            onModeChange={setAuthMode}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
