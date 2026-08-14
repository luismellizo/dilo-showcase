import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    LayoutGrid, ChefHat, Users, CreditCard, Settings,
    LogOut, Menu, X, User, BarChart3
} from 'lucide-react';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';
import { useLanguage } from './LanguageContext';
import FoodBackdrop from './FoodBackdrop';
import { cx, ICON } from './ui';

/**
 * Shell del panel — Material 3.
 *
 * Estructura (la misma de las apps de Google):
 *   · Top app bar de 64px: menú (móvil), marca, acciones de la página y avatar.
 *     Plana sobre `surface`; solo al hacer scroll sube a `surface-container`,
 *     que es como M3 expresa que la barra está por encima del contenido.
 *   · Nav drawer permanente de 264px con píldoras `rounded-full`. El ítem
 *     activo es un contenedor tonal (`secondary-container`), no una barrita.
 *   · Contenido centrado a `--content-max` (960px). Nunca a sangre: el título
 *     de la página vive AQUÍ, en 28px/400, no comprimido dentro de la barra.
 *
 * Props sin cambios: title/subtitle/actions/children/pendingCount/wide.
 * El KDS no usa este layout (es un monitor de cocina standalone).
 */

/* ------------------------------------------------------------------ NavItem */
const NavItem = ({ icon: Icon, label, active, onClick, badge }) => (
    <button
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={cx(
            'state-layer w-full flex items-center gap-3 h-14 pl-4 pr-4 rounded-shape-xl text-left',
            'transition-colors duration-short ease-standard',
            active
                ? 'bg-secondary-container text-secondary-on-container state-on-secondary-container'
                : 'text-on-surface-variant'
        )}
    >
        <Icon size={ICON.nav} strokeWidth={ICON.stroke} className="flex-shrink-0" aria-hidden="true" />
        <span className={cx('truncate text-body', active && 'font-medium')}>{label}</span>
        {badge > 0 && (
            <span
                className="ml-auto min-w-[24px] h-6 px-1.5 rounded-shape-sm bg-primary text-primary-on text-label flex items-center justify-center tabular-nums flex-shrink-0"
                aria-label={`${badge} pendientes`}
            >
                {badge > 99 ? '99+' : badge}
            </span>
        )}
    </button>
);

/* --------------------------------------------------------------------- Marca */
const Brand = ({ storeName }) => (
    <div className="flex items-center gap-3 min-w-0">
        <div
            className="w-8 h-8 rounded-shape-sm bg-brand flex items-center justify-center flex-shrink-0"
            aria-hidden="true"
        >
            <span className="text-white text-label-lg">D</span>
        </div>
        <div className="min-w-0 flex items-baseline gap-2">
            <span className="text-title-lg text-on-surface leading-none">DILO</span>
            {storeName && (
                <span className="text-body-sm text-on-surface-muted truncate hidden sm:inline" title={storeName}>
                    {storeName}
                </span>
            )}
        </div>
    </div>
);

/* -------------------------------------------------------------------- Avatar */
const AccountButton = ({ user, active, onClick, label }) => {
    const initial = user?.first_name?.charAt(0)?.toUpperCase();
    return (
        <button
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            title={user?.email || label}
            className={cx(
                'state-layer w-10 h-10 rounded-shape-xl flex items-center justify-center flex-shrink-0',
                'bg-primary-container text-primary-on-container',
                active && 'ring-2 ring-primary ring-offset-2 ring-offset-transparent'
            )}
        >
            {initial || <User size={ICON.sm} strokeWidth={ICON.stroke} />}
            <span className="sr-only">{label}</span>
        </button>
    );
};

export default function DashboardLayout({ title, subtitle, actions, children, pendingCount = 0, wide = false }) {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, logout } = useAuth();
    const { mode } = useTheme();
    const { t } = useLanguage();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const drawerRef = useRef(null);
    const openerRef = useRef(null);

    /* La barra sube de tono al despegarse del contenido (M3 "on scroll"). */
    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 4);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    /* Drawer móvil: Escape cierra y el foco vuelve al botón que lo abrió. */
    useEffect(() => {
        if (!drawerOpen) return;
        const opener = openerRef.current;
        const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
        document.addEventListener('keydown', onKey);
        drawerRef.current?.focus();
        return () => {
            document.removeEventListener('keydown', onKey);
            opener?.focus();
        };
    }, [drawerOpen]);

    const NAV = [
        { path: '/dashboard', icon: LayoutGrid, label: 'Pedidos', badge: pendingCount },
        { path: '/dashboard/kitchen', icon: ChefHat, label: 'Cocina' },
        { path: '/dashboard/customers', icon: Users, label: t.dashboard?.header?.customers || 'Clientes' },
        { path: '/dashboard/reports', icon: BarChart3, label: 'Reportes' },
        { path: '/dashboard/billing', icon: CreditCard, label: 'Plan y facturación' },
        { path: '/dashboard/config', icon: Settings, label: t.dashboard?.header?.settings || 'Configuración' },
    ];

    const go = (path) => {
        setDrawerOpen(false);
        navigate(path);
    };

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    const isActive = (path) => path === '/dashboard'
        ? location.pathname === '/dashboard'
        : location.pathname.startsWith(path);

    const navInner = (
        <>
            <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto" aria-label="Secciones del panel">
                <p className="px-4 pt-2 pb-2 text-label text-on-surface-muted">Operación</p>
                {NAV.slice(0, 3).map((item) => (
                    <NavItem key={item.path} {...item} active={isActive(item.path)} onClick={() => go(item.path)} />
                ))}
                <p className="px-4 pt-5 pb-2 text-label text-on-surface-muted">Negocio</p>
                {NAV.slice(3).map((item) => (
                    <NavItem key={item.path} {...item} active={isActive(item.path)} onClick={() => go(item.path)} />
                ))}
            </nav>
            <div className="px-3 pb-3">
                <button
                    onClick={handleLogout}
                    className="state-layer w-full flex items-center gap-3 h-12 px-4 rounded-shape-xl text-body text-on-surface-muted"
                >
                    <LogOut size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                    {t.dashboard?.header?.logout || 'Cerrar sesión'}
                </button>
            </div>
        </>
    );

    return (
        <div className="app-shell" data-theme={mode}>
            {/* ---------------------------------------------------- top app bar */}
            <header
                className={cx(
                    'sticky top-0 z-40 h-topbar flex items-center gap-2 px-2 sm:px-4',
                    'transition-colors duration-medium ease-standard',
                    scrolled ? 'bg-surface-container' : 'bg-surface'
                )}
            >
                <button
                    ref={openerRef}
                    onClick={() => setDrawerOpen(true)}
                    className="state-layer lg:hidden w-12 h-12 rounded-shape-xl flex items-center justify-center text-on-surface-variant flex-shrink-0"
                    aria-label="Abrir menú"
                    aria-expanded={drawerOpen}
                >
                    <Menu size={ICON.nav} strokeWidth={ICON.stroke} />
                </button>

                <div className="px-2 min-w-0 flex-1">
                    <Brand storeName={user?.store?.name} />
                </div>

                {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}

                <AccountButton
                    user={user}
                    active={isActive('/dashboard/profile')}
                    onClick={() => go('/dashboard/profile')}
                    label={t.dashboard?.header?.profile || 'Perfil'}
                />
            </header>

            <div className="flex">
                {/* ------------------------------------------- nav permanente */}
                <aside className="hidden lg:flex flex-col w-nav flex-shrink-0 sticky top-topbar h-[calc(100vh-var(--topbar-height))]">
                    {navInner}
                </aside>

                {/* ---------------------------------------------- drawer móvil */}
                {drawerOpen && (
                    <div className="fixed inset-0 z-50 lg:hidden">
                        <div
                            className="absolute inset-0 bg-black/32 anim-fade-in"
                            onClick={() => setDrawerOpen(false)}
                        />
                        <aside
                            ref={drawerRef}
                            tabIndex={-1}
                            role="dialog"
                            aria-modal="true"
                            aria-label="Menú de navegación"
                            className="absolute left-0 top-0 bottom-0 w-[300px] bg-surface-low flex flex-col rounded-r-shape-xl shadow-3 anim-slide-right outline-none"
                        >
                            <div className="h-topbar flex items-center justify-between px-4 flex-shrink-0">
                                <Brand storeName={user?.store?.name} />
                                <button
                                    onClick={() => setDrawerOpen(false)}
                                    className="state-layer w-12 h-12 -mr-2 rounded-shape-xl flex items-center justify-center text-on-surface-variant"
                                    aria-label="Cerrar menú"
                                >
                                    <X size={ICON.sm} strokeWidth={ICON.stroke} />
                                </button>
                            </div>
                            {navInner}
                        </aside>
                    </div>
                )}

                {/* -------------------------------------------------- contenido */}
                <main
                    className={cx(
                        'flex-1 min-w-0 px-4 sm:px-6 lg:px-8 pb-16 pt-2 relative',
                    )}
                >
                    <FoodBackdrop />
                    <div className={cx('relative z-10 mx-auto w-full', wide ? 'max-w-content-wide' : 'max-w-content')}>
                        {(title || subtitle) && (
                            <div className="pt-4 pb-8">
                                {title && <h1 className="text-headline text-on-surface">{title}</h1>}
                                {subtitle && <p className="text-body-lg text-on-surface-variant mt-1">{subtitle}</p>}
                            </div>
                        )}
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}
