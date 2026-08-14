import React, { useEffect, useState } from 'react';
import { UserCog, LogOut } from 'lucide-react';
import { getImpersonation, endImpersonation } from './impersonation';

/**
 * Banner global y permanente mientras hay una sesión de impersonation activa.
 * Fijo abajo (no tapa los topbars sticky del panel), rojo, con cuenta
 * regresiva y botón de salida que restaura la sesión staff.
 */
export default function ImpersonationBanner() {
    const [imp, setImp] = useState(getImpersonation);
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        if (!imp) return;
        const t = setInterval(() => {
            setNow(Date.now());
            setImp(getImpersonation()); // por si otra pestaña la terminó
        }, 15000);
        return () => clearInterval(t);
    }, [imp]);

    if (!imp) return null;

    const msLeft = imp.expires_at - now;
    const minLeft = Math.max(0, Math.ceil(msLeft / 60000));
    const expired = msLeft <= 0;

    return (
        <div
            className="fixed bottom-0 inset-x-0 z-[90] bg-red-600 text-white px-4 py-2.5 flex items-center justify-center gap-3 shadow-2xl"
            role="alert"
        >
            <UserCog size={16} className="flex-shrink-0" />
            <p className="text-sm font-semibold truncate">
                {expired
                    ? 'La sesión de impersonation expiró.'
                    : <>Estás viendo como <strong>{imp.user?.email}</strong> ({imp.store?.name}) · {minLeft} min restantes</>}
            </p>
            <button
                onClick={endImpersonation}
                className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 px-3 py-1 rounded-lg text-xs font-bold transition-colors flex-shrink-0"
            >
                <LogOut size={12} />
                Salir
            </button>
        </div>
    );
}
