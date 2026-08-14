/**
 * Cascarón compartido de las páginas legales (términos, eliminación de datos).
 *
 * Mismo lenguaje visual que la política de privacidad: fondo oscuro, índice
 * de contenidos y secciones con markdown ligero (**negrita** y viñetas •).
 * Existe para que las tres páginas legales no se desincronicen visualmente
 * ni en su pie de página con los datos de la empresa.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { COMPANY, legalLine, CURRENT_YEAR } from './companyInfo';

/** Renderiza un bloque de texto con **negritas** y viñetas. */
export const LegalText = ({ content }) => (
    <div className="prose prose-invert prose-sm max-w-none">
        {content.split('\n').map((paragraph, pIndex) => {
            const trimmed = paragraph.trim();
            if (!trimmed) return null;

            const formatted = trimmed.split(/(\*\*.*?\*\*)/g).map((part, i) =>
                part.startsWith('**') && part.endsWith('**') ? (
                    <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>
                ) : (
                    part
                )
            );

            return (
                <p
                    key={pIndex}
                    className={
                        trimmed.startsWith('•')
                            ? 'text-gray-400 leading-relaxed pl-4 py-0.5'
                            : 'text-gray-400 leading-relaxed mb-3'
                    }
                >
                    {formatted}
                </p>
            );
        })}
    </div>
);

const LegalShell = ({ badge, badgeIcon: BadgeIcon, title, subtitle, updatedAt,
                      sections = [], children }) => (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
        {/* Nav */}
        <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0a0a0f]/80 backdrop-blur-2xl border-b border-white/[0.05]">
            <div className="max-w-4xl mx-auto px-6 py-4">
                <div className="flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-3 text-gray-400 hover:text-white transition-colors">
                        <ArrowLeft size={18} />
                        <span className="text-sm font-medium">Volver</span>
                    </Link>
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg overflow-hidden bg-gradient-to-br from-emerald-500/20 to-teal-500/20 p-0.5">
                            <img src="/logo192.png" alt="DILO" className="w-full h-full object-contain rounded-md" />
                        </div>
                        <span className="font-bold">{COMPANY.brand}</span>
                    </div>
                </div>
            </div>
        </nav>

        {/* Hero */}
        <section className="pt-32 pb-16 px-6 relative overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-radial from-emerald-500/10 via-transparent to-transparent blur-3xl pointer-events-none" />
            <div className="max-w-4xl mx-auto text-center relative z-10">
                {badge && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full mb-6"
                    >
                        {BadgeIcon && <BadgeIcon className="w-5 h-5 text-emerald-400" />}
                        <span className="text-emerald-400 text-sm font-medium">{badge}</span>
                    </motion.div>
                )}
                <motion.h1
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="text-4xl md:text-5xl font-bold mb-4"
                >
                    {title}
                </motion.h1>
                {subtitle && (
                    <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="text-gray-400 text-lg max-w-2xl mx-auto"
                    >
                        {subtitle}
                    </motion.p>
                )}
                {updatedAt && (
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.3 }}
                        className="text-gray-500 text-sm mt-6"
                    >
                        Última actualización: {updatedAt}
                    </motion.p>
                )}
            </div>
        </section>

        {/* Índice */}
        {sections.length > 0 && (
            <section className="px-6 pb-12">
                <div className="max-w-4xl mx-auto">
                    <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-6">
                        <h2 className="text-lg font-semibold text-white mb-4">Contenido</h2>
                        <div className="grid md:grid-cols-2 gap-2">
                            {sections.map((section) => (
                                <a
                                    key={section.id}
                                    href={`#${section.id}`}
                                    className="flex items-center gap-2 py-2 px-3 rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.03] transition-colors text-sm"
                                >
                                    {section.icon && <section.icon size={14} className="text-emerald-400" />}
                                    <span>{section.title}</span>
                                </a>
                            ))}
                        </div>
                    </div>
                </div>
            </section>
        )}

        {/* Contenido extra (widgets interactivos) */}
        {children && <section className="px-6 pb-12"><div className="max-w-4xl mx-auto">{children}</div></section>}

        {/* Secciones */}
        {sections.length > 0 && (
            <section className="px-6 pb-24">
                <div className="max-w-4xl mx-auto space-y-8">
                    {sections.map((section, index) => (
                        <motion.article
                            key={section.id}
                            id={section.id}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: index * 0.05 }}
                            className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-8 scroll-mt-24"
                        >
                            <div className="flex items-center gap-3 mb-4">
                                {section.icon && (
                                    <div className="w-10 h-10 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 rounded-xl flex items-center justify-center">
                                        <section.icon className="w-5 h-5 text-emerald-400" />
                                    </div>
                                )}
                                <h2 className="text-xl font-bold text-white">{section.title}</h2>
                            </div>
                            <LegalText content={section.content} />
                        </motion.article>
                    ))}
                </div>
            </section>
        )}

        {/* Footer con identidad legal real */}
        <footer className="border-t border-white/[0.05] py-8 px-6">
            <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
                <div>
                    <p className="text-sm text-gray-400 font-medium">{legalLine()}</p>
                    <p className="text-xs text-gray-600 mt-1">
                        © {CURRENT_YEAR} {COMPANY.brand}. Todos los derechos reservados.
                    </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
                    <Link to="/privacy" className="text-gray-500 hover:text-white">Privacidad</Link>
                    <Link to="/terms" className="text-gray-500 hover:text-white">Términos</Link>
                    <Link to="/data-deletion" className="text-gray-500 hover:text-white">Eliminar datos</Link>
                    <a href={`mailto:${COMPANY.emails.support}`} className="text-emerald-400 hover:text-emerald-300">
                        {COMPANY.emails.support}
                    </a>
                </div>
            </div>
        </footer>
    </div>
);

export default LegalShell;
