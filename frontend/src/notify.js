/* Avisos del panel: sonido + notificaciones del sistema.
   Compartido por el dashboard (App.js) y la pantalla de cocina (KitchenDisplay).

   Antes el sonido vivía solo en App.js, así que el KDS —justo la pantalla que
   nadie mira fijo— era la única muda. */

const NOTIFICATION_SOUND = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';

let audioUnlocked = false;
// Un solo Audio reutilizado: crear uno por pedido deja objetos colgando en una
// pantalla que puede estar abierta 12 horas seguidas.
let audioEl = null;

const getAudio = () => {
    if (!audioEl) {
        audioEl = new Audio(NOTIFICATION_SOUND);
        audioEl.volume = 0.5;
    }
    return audioEl;
};

/** ¿Ya nos dejó sonar el navegador en esta pestaña? */
export const isAudioUnlocked = () => audioUnlocked;

/**
 * El navegador exige un gesto real del usuario antes de dejar sonar audio.
 * Se llama UNA vez desde un onClick de verdad (botón "Activar sonido"); sin
 * esto, en una tablet recién abierta el sonido no suena nunca y nadie entiende
 * por qué. Reproduce en volumen 0 para no pegarle un susto a la cocina.
 */
export const unlockAudio = async () => {
    try {
        const audio = getAudio();
        const original = audio.volume;
        audio.volume = 0;
        await audio.play();
        audio.pause();
        audio.currentTime = 0;
        audio.volume = original;
        audioUnlocked = true;
    } catch (err) {
        console.warn('No se pudo desbloquear el audio:', err);
    }
    return audioUnlocked;
};

export const playNotificationSound = () => {
    try {
        const audio = getAudio();
        audio.currentTime = 0;
        audio.play()
            .then(() => { audioUnlocked = true; })
            .catch(err => console.warn('Autoplay bloqueado:', err));
    } catch (error) {
        console.error('Error reproduciendo sonido:', error);
    }
};

/* ===================== Notificaciones del navegador =====================
   Si el dueño cierra la pestaña o silencia el equipo no se entera del pedido.
   En comida, un pedido frío a los 10 minutos es un pedido perdido. */

export const canNotify = () => typeof window !== 'undefined' && 'Notification' in window;

export const notificationPermission = () => (canNotify() ? Notification.permission : 'unsupported');

/** Pide permiso. SOLO desde un onClick — pedirlo al cargar la página lo
 *  bloquean los navegadores y es hostil. Devuelve el permiso resultante. */
export const requestNotificationPermission = async () => {
    if (!canNotify()) return 'unsupported';
    try {
        return await Notification.requestPermission();
    } catch (err) {
        console.warn('No se pudo pedir permiso de notificaciones:', err);
        return Notification.permission;
    }
};

/**
 * Aviso de pedido nuevo. Solo si la pestaña NO está visible: notificar
 * mientras el dueño está mirando el tablero es ruido.
 */
export const notifyNewOrder = (order) => {
    if (!canNotify() || Notification.permission !== 'granted') return;
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
    try {
        const n = new Notification(`Pedido nuevo de ${order?.customer_name || 'un cliente'}`, {
            body: `${order?.items_count ?? 0} productos · ${order?.total_amount ?? ''}`.trim(),
            icon: '/logo192.png',
            tag: `dilo-order-${order?.id}`,   // evita 5 notificaciones del mismo pedido
        });
        n.onclick = () => { window.focus(); n.close(); };
    } catch (err) {
        console.warn('No se pudo lanzar la notificación:', err);
    }
};
