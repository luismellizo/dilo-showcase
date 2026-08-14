import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    Gauge, Building2, ScrollText, LogOut, Menu, X, ArrowLeftRight, ShieldCheck
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { useTheme } from '../ThemeContext';
import { Badge, cx } from '../ui';
import { useStaffRole } from './StaffGate';

/**
 * Shell del panel administrativo interno (/admin/*). Mismo lenguaje visual
 * que DashboardLayout pero con navegación propia y marca "equipo DILO".
 */

const NavItem = ({ icon: Icon, label, active, onClick }) => (
    <button
        onClick={onClick}
        className={cx(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 relative',
            active ? '' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
        )}
        style={active ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : undefined}
    >
        {active && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full" style={{ background: 'var(--accent)' }} />
        )}
        <Icon size={18} strokeWidth={active ? 2.4 : 2} className="flex-shrink-0" />
        <span className="truncate">{label}</span>
    </button>
);

const ROLE_TONES = { admin: 'red', soporte: 'blue', lectura: 'neutral' };

export default function StaffLayout({ title, subtitle, actions, children, wide = false }) {
    const navigate = useNavigate();
    const location = useLocation();
    const { logout, user } = useAuth();
    const { mode } = useTheme();
    const me = useStaffRole();
    const [drawerOpen, setDrawerOpen] = useState(false);

    const NAV = [
        { path: '/admin', icon: Gauge, label: 'Resumen' },
        { path: '/admin/stores', icon: Building2, label: 'Tiendas' },
        { path: '/admin/audit', icon: ScrollText, label: 'Auditoría' },
    ];

    const go = (path) => { setDrawerOpen(false); navigate(path); };
    const isActive = (path) => path === '/admin'
        ? location.pathname === '/admin'
        : location.pathname.startsWith(path);

    const sidebarInner = (
        <>
            <div className="px-4 pt-5 pb-4 flex items-center gap-3">
                <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{
                        background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #000))',
                        boxShadow: '0 6px 16px -6px color-mix(in srgb, var(--accent) 55%, transparent)'
                    }}
                >
                    <ShieldCheck size={17} className="text-white" />
                </div>
                <div className="min-w-0">
                    <p className="text-sm font-extrabold text-gray-900 tracking-tight leading-none">DILO Admin</p>
                    <p className="text-[11px] text-gray-400 font-medium truncate mt-0.5">Equipo interno</p>
                </div>
            </div>
            <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
                <p className="px-3 pt-2 pb-1.5 text-[10px] font-extrabold uppercase tracking-widest text-gray-400">Plataforma</p>
                {NAV.map((item) => (
                    <NavItem key={item.path} {...item} active={isActive(item.path)} onClick={() => go(item.path)} />
                ))}
            </nav>
            <div className="p-3 border-t border-gray-100 space-y-0.5">
                <div className="px-3 py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                        <p className="text-[13px] font-bold text-gray-900 truncate leading-tight">{me?.name || me?.email}</p>
                        <p className="text-[11px] text-gray-400 truncate">{me?.email}</p>
                    </div>
                    <Badge tone={ROLE_TONES[me?.role] || 'neutral'}>{me?.role}</Badge>
                </div>
                {/* Una cuenta staff dedicada no tiene tienda: el atajo solo
                    aplica a quien además es comerciante. */}
                {user?.store && (
                    <button
                        onClick={() => navigate('/dashboard')}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-semibold text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                    >
                        <ArrowLeftRight size={16} />
                        Mi panel de tienda
                    </button>
                )}
                <button
                    onClick={() => { logout(); navigate('/admin/login'); }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-semibold text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                    <LogOut size={16} />
                    Cerrar sesión
                </button>
            </div>
        </>
    );

    return (
        <div className="app-shell" data-theme={mode}>
            <div className="flex min-h-screen">
                <aside className="hidden lg:flex flex-col w-60 flex-shrink-0 sticky top-0 h-screen bg-white/80 backdrop-blur-xl border-r border-gray-200 z-40">
                    {sidebarInner}
                </aside>

                {drawerOpen && (
                    <div className="fixed inset-0 z-50 lg:hidden">
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm anim-fade-in" onClick={() => setDrawerOpen(false)} />
                        <aside className="absolute left-0 top-0 bottom-0 w-72 bg-white flex flex-col shadow-2xl anim-slide-right border-r border-gray-200">
                            <button
                                onClick={() => setDrawerOpen(false)}
                                className="absolute top-4 right-4 p-2 hover:bg-gray-100 rounded-lg text-gray-400"
                                aria-label="Cerrar menú"
                            >
                                <X size={18} />
                            </button>
                            {sidebarInner}
                        </aside>
                    </div>
                )}

                <div className="flex-1 min-w-0 flex flex-col">
                    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-gray-200">
                        <div className={cx('mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3 w-full', wide ? '' : 'max-w-6xl')}>
                            <div className="flex items-center gap-3 min-w-0">
                                <button
                                    onClick={() => setDrawerOpen(true)}
                                    className="lg:hidden p-2 -ml-1 hover:bg-gray-100 rounded-lg text-gray-500 flex-shrink-0"
                                    aria-label="Abrir menú"
                                >
                                    <Menu size={20} />
                                </button>
                                <div className="min-w-0">
                                    <h1 className="text-[15px] font-extrabold text-gray-900 tracking-tight leading-none truncate">{title}</h1>
                                    {subtitle && <div className="text-[11px] text-gray-400 font-medium mt-1 truncate">{subtitle}</div>}
                                </div>
                            </div>
                            {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
                        </div>
                    </header>

                    <main className={cx('flex-1 w-full mx-auto px-4 sm:px-6 py-6', wide ? '' : 'max-w-6xl')}>
                        {children}
                    </main>
                </div>
            </div>
        </div>
    );
}
