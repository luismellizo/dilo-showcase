import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Plus, Trash2, Edit2, Save, X, Store, Tag, Package, ChevronDown,
    AlertCircle, Image as ImageIcon, CreditCard,
    MessageCircle, Search, Sparkles, Camera, Send, Unplug, Bot,
    UtensilsCrossed, CupSoda, ShoppingBag, Info, Ban
} from 'lucide-react';
import WhatsAppConnect from './WhatsAppConnect';
import WhatsAppTemplates from './WhatsAppTemplates';
import DashboardLayout from './DashboardLayout';
import { useLanguage } from './LanguageContext';
import { useTheme, DEFAULT_ACCENT, ACCENT_PRESETS } from './ThemeContext';
import { useAuth } from './AuthContext';
import {
    Toast, Switch, Button, IconButton, Card, SectionCard, EmptyState, Modal,
    Field, Badge, Skeleton, Tabs, inputCls, textareaCls, ICON, cx
} from './ui';
import { API_BASE_URL, formatCOP } from './config';

// DRF puede responder lista plana o paginada ({results: []}).
const asList = (data) => (Array.isArray(data) ? data : data?.results || []);

// ============================================
// Main Component
// ============================================
const StoreConfig = ({ storeId }) => {
    const { t } = useLanguage();
    const { mode, setMode, accent, setAccent, themes, backdrop, setBackdrop, backdrops } = useTheme();
    const { fetchWithAuth } = useAuth();
    const [store, setStore] = useState(null);
    const [categories, setCategories] = useState([]);
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState('store');
    const [extractingMenu, setExtractingMenu] = useState(false);
    const [menuImgBusy, setMenuImgBusy] = useState(false);
    const [menuBgBusy, setMenuBgBusy] = useState(false);
    const [menuBgHint, setMenuBgHint] = useState('');

    // Preview del menú extraído por IA (edición antes de confirmar)
    const [menuPreview, setMenuPreview] = useState(null); // [{name, products:[{name,description,price,variants:[{name,price}]}]}]
    const [previewStep, setPreviewStep] = useState(0);
    const [confirmingMenu, setConfirmingMenu] = useState(false);
    const [expandedProducts, setExpandedProducts] = useState({}); // {"ci-pi": true}

    // Toast state
    const [toast, setToast] = useState(null);

    // Modal states
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [showProductModal, setShowProductModal] = useState(false);
    const [editingCategory, setEditingCategory] = useState(null);
    const [editingProduct, setEditingProduct] = useState(null);

    // Form states
    const [storeForm, setStoreForm] = useState({ name: '', theme_color: DEFAULT_ACCENT });
    const [botForm, setBotForm] = useState({
        bot_name: '', bot_personality: '', business_description: '', address: '',
        business_hours: '', delivery_info: '', delivery_fee: '', free_delivery_min: '',
        prep_time_minutes: '', payment_instructions: '', bot_extra_info: '', bot_custom_instructions: ''
    });
    const [categoryForm, setCategoryForm] = useState({ name: '', display_order: 0 });
    const [productForm, setProductForm] = useState({
        name: '', description: '', price: '', category: '', is_active: true, image_url: '', variants: []
    });

    // Filtros de inventario
    const [productSearch, setProductSearch] = useState('');
    const [productCategoryFilter, setProductCategoryFilter] = useState('');

    // Telegram (estado real de conexión)
    const [tgStatus, setTgStatus] = useState({ loaded: false, connected: false, bot_username: '' });
    const [tgToken, setTgToken] = useState('');

    // WhatsApp: solo se usa para saber si ya hay WABA conectada (las plantillas
    // viven en la WABA del comercio, no en DILO).
    const [waConnected, setWaConnected] = useState(false);

    // Form errors
    const [categoryErrors, setCategoryErrors] = useState({});
    const [productErrors, setProductErrors] = useState({});

    const showToast = useCallback((message, type = 'info') => {
        setToast({ message, type });
    }, []);

    const getAuthHeaders = useCallback(() => {
        const token = localStorage.getItem('access_token');
        return {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        };
    }, []);

    // ============================================
    // Carga de datos
    // ============================================
    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const headers = getAuthHeaders();
            const [storeRes, catRes, prodRes, tgRes, waRes] = await Promise.all([
                fetchWithAuth(`${API_BASE_URL}/api/stores/${storeId}/`, { headers }),
                fetchWithAuth(`${API_BASE_URL}/api/categories/?store_id=${storeId}`, { headers }),
                fetchWithAuth(`${API_BASE_URL}/api/products/?store_id=${storeId}`, { headers }),
                fetchWithAuth(`${API_BASE_URL}/api/telegram/status/?store_id=${storeId}`, { headers }),
                fetchWithAuth(`${API_BASE_URL}/api/whatsapp/status/?store_id=${storeId}`, { headers }),
            ]);

            // El estado de WhatsApp nunca debe romper la carga de la config.
            if (waRes.ok) {
                const wa = await waRes.json();
                setWaConnected(Boolean(wa.connected));
            }

            if (storeRes.ok) {
                const s = await storeRes.json();
                setStore(s);
                setStoreForm({ name: s.name || '', theme_color: s.theme_color || accent });
                // Acento persistido en backend → aplica al panel (cross-device).
                if (s.theme_color) setAccent(s.theme_color);
                setBotForm({
                    bot_name: s.bot_name || '',
                    bot_personality: s.bot_personality || '',
                    business_description: s.business_description || '',
                    address: s.address || '',
                    business_hours: s.business_hours || '',
                    delivery_info: s.delivery_info || '',
                    delivery_fee: s.delivery_fee != null ? String(s.delivery_fee) : '',
                    free_delivery_min: s.free_delivery_min != null ? String(s.free_delivery_min) : '',
                    prep_time_minutes: s.prep_time_minutes != null ? String(s.prep_time_minutes) : '',
                    payment_instructions: s.payment_instructions || '',
                    bot_extra_info: s.bot_extra_info || '',
                    bot_custom_instructions: s.bot_custom_instructions || ''
                });
            } else {
                showToast('Error cargando datos de la tienda', 'error');
            }

            if (catRes.ok) setCategories(asList(await catRes.json()));
            if (prodRes.ok) setProducts(asList(await prodRes.json()));
            if (tgRes.ok) {
                const tg = await tgRes.json();
                setTgStatus({ loaded: true, connected: !!tg.connected, bot_username: tg.bot_username || '' });
            }
        } catch (error) {
            console.error('Error loading data:', error);
            showToast('Error de conexión al cargar datos', 'error');
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storeId, getAuthHeaders, showToast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // ============================================
    // Tienda (nombre + color)
    // ============================================
    const saveStore = async () => {
        if (!storeForm.name.trim()) {
            showToast('El nombre de la tienda es obligatorio', 'error');
            return;
        }
        setSaving(true);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/api/stores/${storeId}/`, {
                method: 'PATCH',
                headers: getAuthHeaders(),
                body: JSON.stringify({ name: storeForm.name.trim(), theme_color: storeForm.theme_color })
            });
            if (response.ok) {
                const s = await response.json();
                setStore(s);
                showToast('Tienda actualizada', 'success');
            } else {
                showToast('Error guardando la tienda', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        } finally {
            setSaving(false);
        }
    };

    // ============================================
    // Bot IA (contexto del negocio para el prompt)
    // ============================================
    const saveBotConfig = async () => {
        setSaving(true);
        try {
            // Normalizar montos: vacío → 0 (fee) / null (umbral gratis).
            const payload = {
                ...botForm,
                delivery_fee: botForm.delivery_fee === '' ? 0 : Number(botForm.delivery_fee),
                free_delivery_min: botForm.free_delivery_min === '' ? null : Number(botForm.free_delivery_min),
                prep_time_minutes: botForm.prep_time_minutes === '' ? null : Number(botForm.prep_time_minutes),
            };
            const response = await fetchWithAuth(`${API_BASE_URL}/api/stores/${storeId}/`, {
                method: 'PATCH',
                headers: getAuthHeaders(),
                body: JSON.stringify(payload)
            });
            if (response.ok) {
                const s = await response.json();
                setStore(s);
                showToast('Bot actualizado: responderá con esta información', 'success');
            } else {
                showToast('Error guardando la configuración del bot', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        } finally {
            setSaving(false);
        }
    };

    // ============================================
    // Menú por foto (IA con visión)
    // ============================================
    const MAX_MENU_FILES = 7;
    const MAX_MENU_FILE_MB = 8;

    const handleMenuPhotos = async (e) => {
        const files = e.target.files;
        if (!files || !files.length) return;
        if (files.length > MAX_MENU_FILES) {
            showToast(`Máximo ${MAX_MENU_FILES} archivos por carga`, 'error');
            e.target.value = '';
            return;
        }
        const tooBig = Array.from(files).find(f => f.size > MAX_MENU_FILE_MB * 1024 * 1024);
        if (tooBig) {
            showToast(`"${tooBig.name}" supera ${MAX_MENU_FILE_MB}MB`, 'error');
            e.target.value = '';
            return;
        }
        setExtractingMenu(true);
        try {
            const fd = new FormData();
            fd.append('store_id', storeId);
            Array.from(files).forEach((f) => fd.append('images', f));
            const res = await fetchWithAuth(`${API_BASE_URL}/api/menu/extract/`, {
                method: 'POST',
                body: fd,
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.categories?.length) {
                setMenuPreview(data.categories);
                setPreviewStep(0);
            } else {
                showToast(data.error || 'No se pudo leer el menú', 'error');
            }
        } catch (err) {
            showToast('Error de conexión', 'error');
        } finally {
            setExtractingMenu(false);
            e.target.value = '';
        }
    };

    // --- Edición del preview (antes de confirmar) ---
    const updatePreview = (mutate) => {
        setMenuPreview(prev => {
            const next = JSON.parse(JSON.stringify(prev));
            mutate(next);
            return next;
        });
    };
    const setPreviewCategoryName = (ci, name) =>
        updatePreview(cats => { cats[ci].name = name; });
    const setPreviewProduct = (ci, pi, field, value) =>
        updatePreview(cats => { cats[ci].products[pi][field] = value; });
    const removePreviewProduct = (ci, pi) =>
        updatePreview(cats => { cats[ci].products.splice(pi, 1); });
    const setPreviewVariant = (ci, pi, vi, field, value) =>
        updatePreview(cats => { cats[ci].products[pi].variants[vi][field] = value; });
    const removePreviewVariant = (ci, pi, vi) =>
        updatePreview(cats => { cats[ci].products[pi].variants.splice(vi, 1); });

    const closeMenuPreview = () => {
        setMenuPreview(null);
        setPreviewStep(0);
        setExpandedProducts({});
    };
    const toggleExpandedProduct = (ci, pi) =>
        setExpandedProducts(prev => ({ ...prev, [`${ci}-${pi}`]: !prev[`${ci}-${pi}`] }));

    const confirmMenuPreview = async () => {
        // Categorías sin productos (el dueño los quitó todos) no se crean.
        const payload = menuPreview
            .map(c => ({
                ...c,
                products: c.products.filter(p => (p.name || '').trim()),
            }))
            .filter(c => c.products.length);
        if (!payload.length) {
            showToast('No quedan productos para crear', 'error');
            return;
        }
        setConfirmingMenu(true);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/menu/confirm/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ store_id: storeId, categories: payload }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                showToast(
                    data.products_created > 0
                        ? `✨ ${data.products_created} productos creados en ${data.categories_created} categorías`
                        : 'Menú confirmado: sin productos nuevos (ya existían)',
                    'success'
                );
                closeMenuPreview();
                await loadData();
            } else {
                showToast(data.error || 'No se pudo crear el menú', 'error');
            }
        } catch (err) {
            showToast('Error de conexión', 'error');
        } finally {
            setConfirmingMenu(false);
        }
    };

    // ============================================
    // Category CRUD
    // ============================================
    const validateCategoryForm = () => {
        const errors = {};
        if (!categoryForm.name.trim()) errors.name = 'El nombre es obligatorio';
        if (categoryForm.name.length > 100) errors.name = 'El nombre no puede superar 100 caracteres';
        setCategoryErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const openCategoryModal = (cat = null) => {
        setCategoryForm(cat
            ? { name: cat.name, display_order: cat.display_order }
            : { name: '', display_order: categories.length });
        setEditingCategory(cat);
        setCategoryErrors({});
        setShowCategoryModal(true);
    };

    const saveCategory = async () => {
        if (!validateCategoryForm()) return;
        setSaving(true);
        try {
            const method = editingCategory ? 'PUT' : 'POST';
            const url = editingCategory
                ? `${API_BASE_URL}/api/categories/${editingCategory.id}/`
                : `${API_BASE_URL}/api/categories/`;

            const response = await fetchWithAuth(url, {
                method,
                headers: getAuthHeaders(),
                body: JSON.stringify({ ...categoryForm, name: categoryForm.name.trim(), store: storeId })
            });

            if (response.ok) {
                await loadData();
                setShowCategoryModal(false);
                setEditingCategory(null);
                showToast(editingCategory ? 'Categoría actualizada' : 'Categoría creada', 'success');
            } else {
                const errorData = await response.json().catch(() => ({}));
                // unique_together (store, name) → mensaje claro de duplicado
                const nonField = errorData.non_field_errors?.[0];
                const errorMsg = nonField?.includes('unique')
                    ? 'Ya existe una categoría con ese nombre'
                    : (errorData.name?.[0] || nonField || errorData.detail || 'Error al guardar categoría');
                showToast(errorMsg, 'error');
            }
        } catch (error) {
            showToast('Error de conexión al guardar', 'error');
        } finally {
            setSaving(false);
        }
    };

    const deleteCategory = async (cat) => {
        const count = products.filter(p => p.category === cat.id).length;
        const warning = count > 0
            ? `¿Eliminar "${cat.name}" y sus ${count} producto(s)? Esta acción no se puede deshacer.`
            : `¿Eliminar la categoría "${cat.name}"?`;
        if (!window.confirm(warning)) return;

        setSaving(true);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/api/categories/${cat.id}/`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });
            if (response.ok || response.status === 204) {
                await loadData();
                showToast('Categoría eliminada', 'success');
            } else {
                showToast('Error al eliminar categoría', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        } finally {
            setSaving(false);
        }
    };

    // ============================================
    // Product CRUD (inventario)
    // ============================================
    const validateProductForm = () => {
        const errors = {};
        if (!productForm.name.trim()) errors.name = 'El nombre es obligatorio';
        if (!productForm.price || parseFloat(productForm.price) <= 0) errors.price = 'El precio debe ser mayor a 0';
        if (!productForm.category) errors.category = 'Debes seleccionar una categoría';
        setProductErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const openProductModal = (prod = null) => {
        setProductForm(prod
            ? {
                name: prod.name,
                description: prod.description || '',
                price: prod.price,
                category: prod.category || categories.find(c => c.name === prod.category_name)?.id || '',
                is_active: prod.is_active,
                image_url: prod.image_url || '',
                variants: (prod.variants || []).map(v => ({
                    name: v.name, price_adjustment: v.price_adjustment, is_active: v.is_active !== false
                })),
            }
            : {
                name: '', description: '', price: '',
                category: productCategoryFilter || categories[0]?.id || '',
                is_active: true, image_url: '', variants: []
            });
        setEditingProduct(prod);
        setProductErrors({});
        setShowProductModal(true);
    };

    const saveProduct = async () => {
        if (!validateProductForm()) return;
        setSaving(true);
        try {
            const method = editingProduct ? 'PUT' : 'POST';
            const url = editingProduct
                ? `${API_BASE_URL}/api/products/${editingProduct.id}/`
                : `${API_BASE_URL}/api/products/`;

            const payload = {
                ...productForm,
                name: productForm.name.trim(),
                price: parseFloat(productForm.price),
                image_url: productForm.image_url || null,
                // Variantes con nombre; el backend reemplaza el set completo.
                variants: (productForm.variants || [])
                    .filter(v => v.name.trim())
                    .map(v => ({
                        name: v.name.trim(),
                        price_adjustment: parseFloat(v.price_adjustment) || 0,
                        is_active: v.is_active !== false,
                    })),
            };

            const response = await fetchWithAuth(url, {
                method,
                headers: getAuthHeaders(),
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                await loadData();
                setShowProductModal(false);
                setEditingProduct(null);
                showToast(editingProduct ? 'Producto actualizado' : 'Producto creado', 'success');
            } else {
                const errorData = await response.json().catch(() => ({}));
                const errorMsg = errorData.name?.[0] || errorData.price?.[0] || errorData.detail || 'Error al guardar producto';
                showToast(errorMsg, 'error');
            }
        } catch (error) {
            showToast('Error de conexión al guardar', 'error');
        } finally {
            setSaving(false);
        }
    };

    const toggleProductActive = async (prod) => {
        // Optimistic: refleja al instante, revierte si falla.
        setProducts(prev => prev.map(p => p.id === prod.id ? { ...p, is_active: !p.is_active } : p));
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/api/products/${prod.id}/`, {
                method: 'PATCH',
                headers: getAuthHeaders(),
                body: JSON.stringify({ is_active: !prod.is_active })
            });
            if (!response.ok) throw new Error();
            showToast(!prod.is_active ? `"${prod.name}" disponible` : `"${prod.name}" agotado/oculto`, 'success');
        } catch {
            setProducts(prev => prev.map(p => p.id === prod.id ? { ...p, is_active: prod.is_active } : p));
            showToast('No se pudo cambiar la disponibilidad', 'error');
        }
    };

    const deleteProduct = async (prod) => {
        if (!window.confirm(`¿Eliminar "${prod.name}"? Si tiene pedidos históricos, desactívalo en su lugar.`)) return;
        setSaving(true);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/api/products/${prod.id}/`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });
            if (response.ok || response.status === 204) {
                await loadData();
                showToast('Producto eliminado', 'success');
            } else if (response.status === 500 || response.status === 409) {
                // PROTECT: producto con historial de pedidos no se puede borrar.
                showToast('Tiene pedidos asociados: desactívalo en vez de eliminarlo', 'error');
            } else {
                showToast('Error al eliminar producto', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        } finally {
            setSaving(false);
        }
    };

    // ============================================
    // Pagos (persiste vía PATCH /api/stores/ → payment_config anidado)
    // ============================================
    const handlePaymentConfigChange = (field, value) => {
        setStore({ ...store, payment_config: { ...(store.payment_config || {}), [field]: value } });
    };

    const savePaymentConfig = async () => {
        setSaving(true);
        try {
            const pc = store.payment_config || {};
            const response = await fetchWithAuth(`${API_BASE_URL}/api/stores/${storeId}/`, {
                method: 'PATCH',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    payment_config: {
                        provider: pc.provider || 'NEQUI_MANUAL',
                        is_active: !!pc.is_active,
                        public_key: pc.public_key || '',
                        private_key: pc.private_key || '',
                        integrity_secret: pc.integrity_secret || '',
                        webhook_secret: pc.webhook_secret || '',
                    }
                })
            });
            if (response.ok) {
                const s = await response.json();
                setStore(s);
                showToast('Configuración de pagos guardada', 'success');
            } else {
                const err = await response.json().catch(() => ({}));
                showToast(err.detail || 'Error guardando configuración', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        } finally {
            setSaving(false);
        }
    };

    // ============================================
    // Telegram
    // ============================================
    const connectTelegram = async () => {
        if (!tgToken.trim()) {
            showToast('Pega el token de @BotFather', 'error');
            return;
        }
        setSaving(true);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/api/telegram/connect/`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ store_id: storeId, bot_token: tgToken.trim() })
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                setTgStatus({ loaded: true, connected: true, bot_username: data.bot_username || '' });
                setTgToken('');
                showToast(`Bot conectado${data.bot_username ? ` (@${data.bot_username})` : ''}`, 'success');
            } else {
                showToast(data.error || 'Error conectando Telegram', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        } finally {
            setSaving(false);
        }
    };

    const disconnectTelegram = async () => {
        if (!window.confirm('¿Desconectar el bot de Telegram? Dejarás de recibir pedidos por ese canal.')) return;
        setSaving(true);
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/api/telegram/disconnect/`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ store_id: storeId })
            });
            if (response.ok) {
                setTgStatus({ loaded: true, connected: false, bot_username: '' });
                showToast('Bot de Telegram desconectado', 'success');
            } else {
                showToast('Error al desconectar', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        } finally {
            setSaving(false);
        }
    };

    // ============================================
    // Derivados de inventario
    // ============================================
    const filteredProducts = useMemo(() => {
        const q = productSearch.trim().toLowerCase();
        return products.filter(p =>
            (!productCategoryFilter || p.category === productCategoryFilter) &&
            (!q || p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q))
        );
    }, [products, productSearch, productCategoryFilter]);

    const activeCount = products.filter(p => p.is_active).length;

    // ============================================
    // Menú digital (imagen que el bot envía al cliente)
    // ============================================
    const regenerateMenuImage = async () => {
        setMenuImgBusy(true);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/menu/image/`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ store_id: storeId })
            });
            const data = await res.json();
            if (res.ok) {
                setStore(s => ({ ...s, ...data }));
                showToast(t.storeConfig.menuImage?.generated || 'Menú digital generado', 'success');
            } else {
                showToast(data.error || 'No se pudo generar el menú', 'error');
            }
        } catch {
            showToast('Error de conexión', 'error');
        } finally {
            setMenuImgBusy(false);
        }
    };

    const uploadMenuImage = async (file) => {
        if (!file) return;
        setMenuImgBusy(true);
        try {
            const token = localStorage.getItem('access_token');
            const fd = new FormData();
            fd.append('store_id', storeId);
            fd.append('image', file);
            const res = await fetchWithAuth(`${API_BASE_URL}/api/menu/image/upload/`, {
                method: 'POST',
                // Sin Content-Type: el browser pone el boundary del multipart
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                body: fd
            });
            const data = await res.json();
            if (res.ok) {
                setStore(s => ({ ...s, ...data }));
                showToast(t.storeConfig.menuImage?.uploaded || 'Menú digital actualizado', 'success');
            } else {
                showToast(data.error || 'No se pudo subir la imagen', 'error');
            }
        } catch {
            showToast('Error de conexión', 'error');
        } finally {
            setMenuImgBusy(false);
        }
    };

    const generateMenuBg = async () => {
        setMenuBgBusy(true);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/menu/image/background/`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ store_id: storeId, style_hint: menuBgHint })
            });
            const data = await res.json();
            if (res.ok) {
                setStore(s => ({ ...s, ...data }));
                showToast(t.storeConfig.menuImage?.bgGenerated || 'Fondo generado y aplicado', 'success');
            } else {
                showToast(data.error || 'No se pudo generar el fondo', 'error');
            }
        } catch {
            showToast('Error de conexión', 'error');
        } finally {
            setMenuBgBusy(false);
        }
    };

    const removeMenuBg = async () => {
        setMenuBgBusy(true);
        try {
            const res = await fetchWithAuth(`${API_BASE_URL}/api/menu/image/background/?store_id=${storeId}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });
            const data = await res.json();
            if (res.ok) {
                setStore(s => ({ ...s, ...data }));
                showToast(t.storeConfig.menuImage?.bgRemoved || 'Fondo eliminado', 'success');
            } else {
                showToast(data.error || 'No se pudo quitar el fondo', 'error');
            }
        } catch {
            showToast('Error de conexión', 'error');
        } finally {
            setMenuBgBusy(false);
        }
    };

    const TABS = [
        { id: 'store', label: t.storeConfig.tabs.store, icon: Store },
        { id: 'categories', label: t.storeConfig.tabs.categories, icon: Tag },
        { id: 'products', label: t.storeConfig.tabs.products, icon: Package },
        { id: 'menuimg', label: t.storeConfig.tabs.menuImage || 'Menú digital', icon: ImageIcon },
        { id: 'bot', label: t.storeConfig.tabs.bot || 'Bot IA', icon: Bot },
        { id: 'payment', label: t.storeConfig.tabs.payment, icon: CreditCard },
        { id: 'channels', label: t.storeConfig.tabs.channels, icon: MessageCircle }
    ];

    // Cabecera destacada de un tab. Antes era una tarjeta con degradado propio
    // que duplicaba `SectionCard` con otro lenguaje; ahora es la misma tarjeta
    // del resto del panel, en contenedor tonal del acento (M3).
    const Hero = ({ icon: Icon, title, children, action }) => (
        <Card className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
                <div className="flex items-start gap-4 min-w-0">
                    <span className="w-12 h-12 rounded-shape-xl flex items-center justify-center flex-shrink-0 bg-primary-container text-primary-on-container">
                        <Icon size={ICON.md} strokeWidth={ICON.stroke} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                        <h3 className="text-title-lg text-on-surface">{title}</h3>
                        <p className="text-body text-on-surface-variant mt-1 max-w-lg">{children}</p>
                    </div>
                </div>
                {action && <div className="flex-shrink-0">{action}</div>}
            </div>
        </Card>
    );

    // Aviso en línea. Antes había cinco cajas distintas (ámbar, azul) con
    // `bg-amber-50`/`bg-blue-50`, que no están remapeadas por [data-theme] y en
    // oscuro quedaban ilegibles. Un solo bloque tonal por rol semántico.
    const NOTICE_TONES = {
        warning: 'bg-warning-container text-warning-on-container',
        info: 'bg-info-container text-info-on-container',
        danger: 'bg-danger-container text-danger-on-container',
    };
    const Notice = ({ tone = 'info', icon: Icon = Info, title, children }) => (
        <div className={cx('rounded-shape-md p-4 flex items-start gap-3', NOTICE_TONES[tone])}>
            <Icon size={ICON.sm} strokeWidth={ICON.stroke} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
                {title && <p className="text-title">{title}</p>}
                <p className={cx('text-body', title && 'mt-1')}>{children}</p>
            </div>
        </div>
    );

    // Loading State
    if (loading) {
        return (
            <DashboardLayout title={t.storeConfig.title} subtitle={t.storeConfig.loading}>
                <div className="max-w-content space-y-6">
                    <div className="flex gap-2">
                        {[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-24 rounded-shape-sm" />)}
                    </div>
                    <Skeleton className="h-56 w-full rounded-shape-lg" />
                    <Skeleton className="h-40 w-full rounded-shape-lg" />
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout
            title={t.storeConfig.title}
            subtitle={store?.name || t.storeConfig.defaultStoreName}
        >
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

            <div className="max-w-content">
                {/* Tabs primarias M3: indicador inferior, sin píldoras grises. */}
                <Tabs tabs={TABS} value={activeTab} onChange={setActiveTab} className="mb-6" />

                {/* Content — remonta al cambiar de tab para animar la entrada */}
                <div role="tabpanel" className="anim-fade-up" key={activeTab}>

                    {/* ============ TIENDA ============ */}
                    {activeTab === 'store' && store && (
                        <SectionCard
                            title={t.storeConfig.store.title}
                            description="Nombre de tu tienda y apariencia del panel."
                            footer={
                                <Button onClick={saveStore} loading={saving} icon={Save}>
                                    {saving ? 'Guardando...' : 'Guardar cambios'}
                                </Button>
                            }
                        >
                            <div className="space-y-6">
                                <Field label={t.storeConfig.store.name}>
                                    <input
                                        type="text"
                                        value={storeForm.name}
                                        onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })}
                                        className={inputCls(false)}
                                        placeholder="Ej: Burgers El Patrón"
                                    />
                                </Field>

                                {/* ---- Tema del panel: 3 presets ----
                                    Los únicos valores crudos aquí son los swatches de vista
                                    previa, y salen de `THEMES` (ThemeContext): un preset TIENE
                                    que enseñar su propio color, no el del tema activo. */}
                                <Field label="Tema del panel">
                                    <div className="grid grid-cols-3 gap-3">
                                        {themes.map((th) => {
                                            const active = mode === th.id;
                                            return (
                                                <button
                                                    key={th.id}
                                                    type="button"
                                                    onClick={() => setMode(th.id)}
                                                    aria-pressed={active}
                                                    className={cx(
                                                        'state-layer rounded-shape-lg border p-3 text-left',
                                                        'transition-colors duration-short ease-standard',
                                                        active
                                                            ? 'bg-secondary-container text-secondary-on-container border-primary state-on-secondary-container'
                                                            : 'bg-surface-container text-on-surface border-outline-variant'
                                                    )}
                                                >
                                                    <span className="flex items-center gap-2 mb-2">
                                                        <span
                                                            className="w-5 h-5 rounded-shape-xl border border-outline-variant"
                                                            style={{ background: th.surface }}
                                                            aria-hidden="true"
                                                        />
                                                        <span className="w-3 h-3 rounded-shape-xl bg-primary" aria-hidden="true" />
                                                    </span>
                                                    <span className="block text-label-lg">{th.label}</span>
                                                    <span className={cx('block text-body-sm', !active && 'text-on-surface-muted')}>
                                                        {th.desc}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </Field>

                                {/* ---- Motivo del fondo decorativo (según rubro) ---- */}
                                <Field label="Motivo del fondo" hint="Vectores sutiles detrás del panel, según tu tipo de negocio.">
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        {backdrops.map((b) => {
                                            const active = backdrop === b.id;
                                            const BackdropIcon = { none: Ban, food: UtensilsCrossed, drinks: CupSoda, retail: ShoppingBag }[b.id] || UtensilsCrossed;
                                            return (
                                                <button
                                                    key={b.id}
                                                    type="button"
                                                    onClick={() => setBackdrop(b.id)}
                                                    aria-pressed={active}
                                                    className={cx(
                                                        'state-layer rounded-shape-lg border p-3 text-left',
                                                        'transition-colors duration-short ease-standard',
                                                        active
                                                            ? 'bg-secondary-container text-secondary-on-container border-primary state-on-secondary-container'
                                                            : 'bg-surface-container text-on-surface border-outline-variant'
                                                    )}
                                                >
                                                    <span
                                                        className={cx(
                                                            'w-10 h-10 rounded-shape-md flex items-center justify-center mb-2',
                                                            active ? 'bg-primary-container text-primary-on-container' : 'bg-surface-high text-on-surface-variant'
                                                        )}
                                                    >
                                                        <BackdropIcon size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                                                    </span>
                                                    <span className="block text-label-lg">{b.label}</span>
                                                    <span className={cx('block text-body-sm', !active && 'text-on-surface-muted')}>
                                                        {b.desc}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </Field>

                                {/* ---- Color de acento (botones, realces, KDS) ---- */}
                                <Field label="Color de acento" hint="Tiñe todo el panel: botones, realces y la pantalla de cocina.">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <span className="w-10 h-10 rounded-shape-xl overflow-hidden border border-outline flex-shrink-0">
                                            <input
                                                type="color"
                                                value={storeForm.theme_color}
                                                onChange={(e) => { setStoreForm({ ...storeForm, theme_color: e.target.value }); setAccent(e.target.value); }}
                                                aria-label="Color de acento"
                                                className="w-full h-full cursor-pointer border-0 bg-transparent p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
                                            />
                                        </span>
                                        {/* El ancho va en el contenedor: `inputCls` trae
                                            `w-full` y mezclarlo con `w-32` deja el resultado
                                            al orden del stylesheet. */}
                                        <div className="w-32">
                                            <input
                                                type="text"
                                                value={storeForm.theme_color}
                                                onChange={(e) => { setStoreForm({ ...storeForm, theme_color: e.target.value }); setAccent(e.target.value); }}
                                                aria-label="Código del color de acento"
                                                className={cx(inputCls(false), 'font-mono')}
                                            />
                                        </div>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => { setStoreForm({ ...storeForm, theme_color: DEFAULT_ACCENT }); setAccent(DEFAULT_ACCENT); }}
                                        >
                                            Color de marca DILO
                                        </Button>
                                    </div>
                                    {/* Atajos de acento. Son DATOS (el valor que se guarda en
                                        `Store.theme_color`), no tokens de diseño: viven en
                                        ThemeContext junto al resto de la config de tema. */}
                                    <div className="flex items-center gap-2 flex-wrap mt-4">
                                        {ACCENT_PRESETS.map((p) => {
                                            const active = storeForm.theme_color?.toUpperCase() === p.value.toUpperCase();
                                            return (
                                                <button
                                                    key={p.value}
                                                    type="button"
                                                    onClick={() => { setStoreForm({ ...storeForm, theme_color: p.value }); setAccent(p.value); }}
                                                    aria-label={p.label}
                                                    aria-pressed={active}
                                                    title={p.label}
                                                    className={cx(
                                                        'w-8 h-8 rounded-shape-xl transition-shadow duration-short ease-standard',
                                                        active && 'ring-2 ring-primary ring-offset-2 ring-offset-transparent'
                                                    )}
                                                    style={{ background: p.value }}
                                                />
                                            );
                                        })}
                                    </div>
                                </Field>
                            </div>
                        </SectionCard>
                    )}

                    {/* ============ CATEGORÍAS ============ */}
                    {activeTab === 'categories' && (
                        <div className="space-y-5">
                            {/* Hero: menú por foto con IA */}
                            <Hero
                                icon={Sparkles}
                                title="Crea tu menú con una foto"
                                action={
                                    <>
                                        <input
                                            id="menu-photo-input"
                                            type="file"
                                            accept="image/*,application/pdf"
                                            multiple
                                            className="hidden"
                                            onChange={handleMenuPhotos}
                                        />
                                        <Button
                                            icon={Camera}
                                            loading={extractingMenu}
                                            disabled={extractingMenu}
                                            onClick={() => document.getElementById('menu-photo-input').click()}
                                        >
                                            {extractingMenu ? 'Leyendo menú...' : 'Subir foto del menú'}
                                        </Button>
                                    </>
                                }
                            >
                                Sube fotos de tu menú físico (o un PDF) y la IA detecta categorías,
                                productos y precios. Antes de crearlos, los revisas y ajustas en un
                                preview. Hasta 7 archivos de 8MB.
                            </Hero>

                            <div className="flex justify-between items-center gap-3">
                                <div className="min-w-0">
                                    <h2 className="text-title-lg text-on-surface">Categorías del menú</h2>
                                    <p className="text-body text-on-surface-variant mt-1">{categories.length} categorías · organiza tu carta</p>
                                </div>
                                <Button variant="dark" icon={Plus} onClick={() => openCategoryModal()}>
                                    Nueva categoría
                                </Button>
                            </div>

                            {categories.length === 0 ? (
                                <EmptyState
                                    icon={Tag}
                                    title="Sin categorías todavía"
                                    description="Usa la foto del menú (arriba) o crea la primera a mano."
                                    action={<Button onClick={() => openCategoryModal()} icon={Plus}>Crear categoría</Button>}
                                />
                            ) : (
                                <div className="grid sm:grid-cols-2 gap-3">
                                    {categories.map(cat => {
                                        const count = products.filter(p => p.category === cat.id).length;
                                        const active = products.filter(p => p.category === cat.id && p.is_active).length;
                                        return (
                                            <Card key={cat.id} className="p-4 flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-4 min-w-0">
                                                    <span className="w-10 h-10 rounded-shape-xl flex items-center justify-center flex-shrink-0 bg-primary-container text-primary-on-container">
                                                        <Tag size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                                                    </span>
                                                    <div className="min-w-0">
                                                        <h3 className="text-title text-on-surface truncate">{cat.name}</h3>
                                                        <p className="text-body-sm text-on-surface-muted mt-0.5">
                                                            {count} productos · {active} disponibles
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex gap-1 flex-shrink-0">
                                                    <IconButton
                                                        icon={Edit2}
                                                        size="sm"
                                                        label={`Editar categoría ${cat.name}`}
                                                        onClick={() => openCategoryModal(cat)}
                                                    />
                                                    <IconButton
                                                        icon={Trash2}
                                                        size="sm"
                                                        tone="danger"
                                                        label={`Eliminar categoría ${cat.name}`}
                                                        disabled={saving}
                                                        onClick={() => deleteCategory(cat)}
                                                    />
                                                </div>
                                            </Card>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ============ PRODUCTOS (INVENTARIO) ============ */}
                    {activeTab === 'products' && (
                        <div className="space-y-4">
                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                                <div className="min-w-0">
                                    <h2 className="text-title-lg text-on-surface">Inventario</h2>
                                    <p className="text-body text-on-surface-variant mt-1">
                                        {products.length} productos · <span className="text-success">{activeCount} disponibles</span>
                                        {products.length - activeCount > 0 && <span className="text-on-surface-muted"> · {products.length - activeCount} ocultos</span>}
                                    </p>
                                </div>
                                <Button icon={Plus} onClick={() => openProductModal()} disabled={categories.length === 0}>
                                    Nuevo producto
                                </Button>
                            </div>

                            {categories.length === 0 ? (
                                <Notice tone="warning" icon={AlertCircle} title="Primero crea una categoría">
                                    Necesitas al menos una categoría para agregar productos.
                                    <button
                                        onClick={() => setActiveTab('categories')}
                                        className="ml-1 underline underline-offset-2"
                                    >
                                        Ir a categorías
                                    </button>
                                </Notice>
                            ) : (
                                <>
                                    {/* Filtros */}
                                    <div className="flex flex-col sm:flex-row gap-3">
                                        {/* Search bar M3: píldora de 48px sobre `surface-highest`. */}
                                        <div className="flex-1 h-12 rounded-shape-xl bg-surface-highest flex items-center gap-2 pl-4 pr-2">
                                            <Search size={ICON.sm} strokeWidth={ICON.stroke} className="text-on-surface-variant flex-shrink-0" aria-hidden="true" />
                                            <input
                                                type="text"
                                                value={productSearch}
                                                onChange={(e) => setProductSearch(e.target.value)}
                                                placeholder="Buscar producto..."
                                                aria-label="Buscar producto"
                                                className="w-full h-full bg-transparent border-0 outline-none text-body text-on-surface"
                                            />
                                            {productSearch && (
                                                <IconButton
                                                    icon={X}
                                                    size="sm"
                                                    label="Limpiar búsqueda"
                                                    onClick={() => setProductSearch('')}
                                                />
                                            )}
                                        </div>
                                        <select
                                            value={productCategoryFilter}
                                            onChange={(e) => setProductCategoryFilter(e.target.value)}
                                            aria-label="Filtrar por categoría"
                                            className={cx(inputCls(false), 'sm:w-56')}
                                        >
                                            <option value="">Todas las categorías</option>
                                            {categories.map(cat => (
                                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {filteredProducts.length === 0 ? (
                                        <EmptyState
                                            icon={Package}
                                            title={products.length === 0 ? 'Sin productos' : 'Nada coincide con tu búsqueda'}
                                            description={products.length === 0 ? 'Agrega tu primer producto al catálogo.' : 'Prueba con otro término o quita filtros.'}
                                            action={products.length === 0 && (
                                                <Button onClick={() => openProductModal()} icon={Plus}>Crear producto</Button>
                                            )}
                                        />
                                    ) : (
                                        <Card className="divide-y divide-outline-variant overflow-hidden">
                                            {filteredProducts.map(prod => (
                                                <div key={prod.id} className={cx('p-4 flex items-center justify-between gap-3', !prod.is_active && 'opacity-[0.38]')}>
                                                    <div className="flex items-center gap-4 min-w-0">
                                                        {prod.image_url ? (
                                                            <img src={prod.image_url} alt={prod.name} className="w-12 h-12 rounded-shape-md object-cover flex-shrink-0" loading="lazy" />
                                                        ) : (
                                                            <span className="w-12 h-12 bg-surface-high text-on-surface-variant rounded-shape-md flex items-center justify-center flex-shrink-0">
                                                                <Package size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                                                            </span>
                                                        )}
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <h3 className="text-title text-on-surface truncate">{prod.name}</h3>
                                                                {prod.variants?.length > 0 && (
                                                                    <Badge className="flex-shrink-0">{prod.variants.length} var.</Badge>
                                                                )}
                                                            </div>
                                                            <p className="text-body-sm text-on-surface-muted truncate mt-0.5">{prod.category_name}{prod.description ? ` · ${prod.description}` : ''}</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-3 flex-shrink-0">
                                                        <span className="text-body-lg text-on-surface tabular-nums">{formatCOP(prod.price)}</span>
                                                        <Switch checked={prod.is_active} onChange={() => toggleProductActive(prod)} ariaLabel={`Disponibilidad de ${prod.name}`} />
                                                        <div className="flex gap-1">
                                                            <IconButton icon={Edit2} size="sm" label={`Editar ${prod.name}`} onClick={() => openProductModal(prod)} />
                                                            <IconButton icon={Trash2} size="sm" tone="danger" label={`Eliminar ${prod.name}`} disabled={saving} onClick={() => deleteProduct(prod)} />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </Card>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* ============ BOT IA ============ */}
                    {activeTab === 'bot' && store && (
                        <div className="space-y-5">
                            {/* Hero explicativo */}
                            <Hero icon={Bot} title="Entrena a tu vendedor virtual">
                                Todo lo que escribas aquí es lo ÚNICO que el bot sabe de tu negocio
                                (además del menú). Si un dato no está, el bot dirá honestamente que
                                no lo tiene — nunca lo inventará. Entre más completo, mejor vende.
                            </Hero>

                            {/* Identidad del bot */}
                            <SectionCard title="Identidad del asistente" description="Cómo se presenta y cómo habla.">
                                <div className="space-y-5">
                                    <div className="grid sm:grid-cols-2 gap-4">
                                        <Field label="Nombre del asistente" hint="Vacío = se presenta solo como el asistente de tu tienda.">
                                            <input
                                                type="text"
                                                value={botForm.bot_name}
                                                onChange={(e) => setBotForm({ ...botForm, bot_name: e.target.value })}
                                                className={inputCls(false)}
                                                placeholder="Ej: Sofi"
                                                maxLength={50}
                                            />
                                        </Field>
                                    </div>
                                    <Field label="Personalidad y tono" hint="Vacío = mesero colombiano carismático (por defecto).">
                                        <textarea
                                            value={botForm.bot_personality}
                                            onChange={(e) => setBotForm({ ...botForm, bot_personality: e.target.value })}
                                            className={textareaCls(false)}
                                            rows={3}
                                            placeholder="Ej: Formal y elegante, trata de usted, sin emojis. / Juvenil y relajado, tutea al cliente."
                                        />
                                    </Field>
                                </div>
                            </SectionCard>

                            {/* Información del negocio */}
                            <SectionCard title="Tu negocio" description="Lo que el bot responde cuando le preguntan por ti.">
                                <div className="space-y-5">
                                    <Field label="¿De qué trata tu negocio?">
                                        <textarea
                                            value={botForm.business_description}
                                            onChange={(e) => setBotForm({ ...botForm, business_description: e.target.value })}
                                            className={textareaCls(false)}
                                            rows={3}
                                            placeholder="Ej: Hamburguesas artesanales a la parrilla con carne 100% de res. Especialidad: la Burger El Patrón doble carne."
                                        />
                                    </Field>
                                    <div className="grid sm:grid-cols-2 gap-4">
                                        <Field label="Dirección / ubicación">
                                            <input
                                                type="text"
                                                value={botForm.address}
                                                onChange={(e) => setBotForm({ ...botForm, address: e.target.value })}
                                                className={inputCls(false)}
                                                placeholder="Ej: Cra 27 #45-12, Cabecera, Bucaramanga"
                                                maxLength={255}
                                            />
                                        </Field>
                                        <Field label="Horarios de atención">
                                            <input
                                                type="text"
                                                value={botForm.business_hours}
                                                onChange={(e) => setBotForm({ ...botForm, business_hours: e.target.value })}
                                                className={inputCls(false)}
                                                placeholder="Ej: Lun-Vie 11am-10pm · Sáb-Dom 12pm-11pm"
                                            />
                                        </Field>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <Field label="Costo del domicilio" optional="(COP)" hint="Se suma al total del pedido automáticamente.">
                                            <input
                                                type="number"
                                                min="0"
                                                step="500"
                                                value={botForm.delivery_fee}
                                                onChange={(e) => setBotForm({ ...botForm, delivery_fee: e.target.value })}
                                                className={inputCls(false)}
                                                placeholder="Ej: 5000 (0 = gratis)"
                                            />
                                        </Field>
                                        <Field label="Domicilio gratis desde" optional="(COP)" hint="Si el subtotal lo alcanza, el domicilio es gratis.">
                                            <input
                                                type="number"
                                                min="0"
                                                step="1000"
                                                value={botForm.free_delivery_min}
                                                onChange={(e) => setBotForm({ ...botForm, free_delivery_min: e.target.value })}
                                                className={inputCls(false)}
                                                placeholder="Ej: 50000 (vacío = nunca)"
                                            />
                                        </Field>
                                    </div>
                                    <Field label="Tiempo de preparación/entrega" optional="(min)" hint={'El bot lo usa cuando el cliente pregunta "¿va en camino?".'}>
                                        <input
                                            type="number"
                                            min="0"
                                            step="5"
                                            value={botForm.prep_time_minutes}
                                            onChange={(e) => setBotForm({ ...botForm, prep_time_minutes: e.target.value })}
                                            className={inputCls(false)}
                                            placeholder="Ej: 40 (vacío = el bot no promete tiempo)"
                                        />
                                    </Field>
                                    <Field label="Domicilios" optional="(zonas y tiempos — informativo)">
                                        <textarea
                                            value={botForm.delivery_info}
                                            onChange={(e) => setBotForm({ ...botForm, delivery_info: e.target.value })}
                                            className={textareaCls(false)}
                                            rows={2}
                                            placeholder="Ej: Cubrimos Cabecera y Cañaveral. Entrega 30-45 min."
                                        />
                                    </Field>
                                    <Field label="Información adicional" optional="(promos, preguntas frecuentes...)">
                                        <textarea
                                            value={botForm.bot_extra_info}
                                            onChange={(e) => setBotForm({ ...botForm, bot_extra_info: e.target.value })}
                                            className={textareaCls(false)}
                                            rows={3}
                                            placeholder="Ej: Martes 2x1 en hamburguesas clásicas. Tenemos parqueadero gratis. Opciones vegetarianas disponibles."
                                        />
                                    </Field>
                                </div>
                            </SectionCard>

                            {/* Datos de pago manual */}
                            <SectionCard
                                title="Datos para pagos por transferencia"
                                description="El bot se los dicta al cliente cuando elige pagar por Nequi/transferencia."
                            >
                                <textarea
                                    value={botForm.payment_instructions}
                                    onChange={(e) => setBotForm({ ...botForm, payment_instructions: e.target.value })}
                                    className={textareaCls(false)}
                                    rows={3}
                                    placeholder={'Ej:\n📱 Nequi: 300 123 4567 (Juan Pérez)\n🏦 Bancolombia Ahorros: 123-456789-00'}
                                />
                                {!botForm.payment_instructions.trim() && (
                                    <div className="mt-4">
                                        <Notice tone="warning" icon={AlertCircle}>
                                            Sin esto, el bot no podrá dictar tu cuenta y el cliente quedará esperando
                                            los datos de pago. Configúralo si recibes pagos por transferencia.
                                        </Notice>
                                    </div>
                                )}
                            </SectionCard>

                            {/* Reglas del dueño */}
                            <SectionCard
                                title="Reglas para el bot"
                                description="Órdenes directas que el bot obedece por encima de todo."
                                footer={
                                    <Button onClick={saveBotConfig} loading={saving} icon={Save}>
                                        {saving ? 'Guardando...' : 'Guardar y entrenar bot'}
                                    </Button>
                                }
                            >
                                <textarea
                                    value={botForm.bot_custom_instructions}
                                    onChange={(e) => setBotForm({ ...botForm, bot_custom_instructions: e.target.value })}
                                    className={textareaCls(false)}
                                    rows={3}
                                    placeholder={'Ej: Nunca ofrezcas descuentos. Si piden algo picante, recomienda la salsa de la casa. No aceptamos pedidos después de las 9:45pm.'}
                                />
                            </SectionCard>
                        </div>
                    )}

                    {/* ============ PAGOS ============ */}
                    {/* ============ MENÚ DIGITAL ============ */}
                    {activeTab === 'menuimg' && store && (
                        <div className="space-y-5">
                            <Hero
                                icon={ImageIcon}
                                title={t.storeConfig.menuImage?.heroTitle || 'Tu menú, como imagen profesional'}
                                action={
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <Button onClick={regenerateMenuImage} loading={menuImgBusy} icon={Sparkles}>
                                            {store.menu_image_url
                                                ? (t.storeConfig.menuImage?.regenerate || 'Regenerar')
                                                : (t.storeConfig.menuImage?.generate || 'Generar menú')}
                                        </Button>
                                        {/* Mismo patrón que la carga de fotos del menú: input
                                            oculto + botón secundario con icono. */}
                                        <input
                                            id="menu-image-upload"
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(e) => { uploadMenuImage(e.target.files?.[0]); e.target.value = ''; }}
                                        />
                                        <Button
                                            variant="secondary"
                                            icon={Camera}
                                            disabled={menuImgBusy}
                                            onClick={() => document.getElementById('menu-image-upload').click()}
                                        >
                                            {t.storeConfig.menuImage?.uploadOwn || 'Subir mi propia imagen'}
                                        </Button>
                                    </div>
                                }
                            >
                                {t.storeConfig.menuImage?.heroDesc ||
                                    'Cuando un cliente pida el menú completo, el bot le envía esta imagen en vez de un texto gigante. Se genera desde tus categorías y productos — los precios siempre salen exactos de tu configuración.'}
                            </Hero>

                            <SectionCard
                                title={t.storeConfig.menuImage?.previewTitle || 'Vista previa'}
                                description={
                                    store.menu_image_url
                                        ? (store.menu_image_source === 'UPLOADED'
                                            ? (t.storeConfig.menuImage?.sourceUploaded || 'Imagen subida por ti — no se regenera automáticamente. Si cambias precios, recuerda actualizarla.')
                                            : (t.storeConfig.menuImage?.sourceGenerated || 'Generada desde tu menú. Se actualiza sola cada vez que cambias categorías, productos o precios.'))
                                        : (t.storeConfig.menuImage?.emptyDesc || 'Aún no hay imagen del menú.')
                                }
                            >
                                {store.menu_image_url ? (
                                    <div className="space-y-3">
                                        <a
                                            href={`${store.menu_image_url}?v=${encodeURIComponent(store.menu_image_updated_at || '')}`}
                                            target="_blank" rel="noopener noreferrer"
                                            className="state-layer block rounded-shape-lg overflow-hidden border border-outline-variant max-w-md mx-auto"
                                        >
                                            <img
                                                src={`${store.menu_image_url}?v=${encodeURIComponent(store.menu_image_updated_at || '')}`}
                                                alt="Menú digital"
                                                className="w-full h-auto"
                                            />
                                        </a>
                                        <p className="text-body-sm text-on-surface-muted text-center">
                                            {store.menu_image_updated_at &&
                                                `${t.storeConfig.menuImage?.updatedAt || 'Actualizado'}: ${new Date(store.menu_image_updated_at).toLocaleString()}`}
                                        </p>
                                    </div>
                                ) : (
                                    <EmptyState
                                        icon={ImageIcon}
                                        title={t.storeConfig.menuImage?.emptyTitle || 'Sin menú digital todavía'}
                                        description={t.storeConfig.menuImage?.emptyCta || 'Crea productos en las pestañas Categorías/Productos y pulsa "Generar menú".'}
                                    />
                                )}
                            </SectionCard>

                            {/* Fondo decorativo con IA */}
                            <SectionCard
                                title={t.storeConfig.menuImage?.bgTitle || 'Fondo con IA'}
                                description={t.storeConfig.menuImage?.bgDesc ||
                                    'La IA genera solo la decoración del fondo (sin texto): los nombres y precios siempre salen exactos de tu menú. El fondo se guarda y se reutiliza en cada actualización — solo se genera cuando tú lo pidas.'}
                            >
                                <div className="space-y-3">
                                    <Field label={t.storeConfig.menuImage?.bgHintLabel || 'Indicaciones de estilo (opcional)'}>
                                        <input
                                            type="text"
                                            value={menuBgHint}
                                            onChange={(e) => setMenuBgHint(e.target.value)}
                                            maxLength={300}
                                            className={inputCls(false)}
                                            placeholder={t.storeConfig.menuImage?.bgHintPlaceholder || 'Ej: estilo rústico con madera, tonos verdes, minimalista...'}
                                        />
                                    </Field>
                                    <div className="flex flex-wrap gap-2">
                                        <Button onClick={generateMenuBg} loading={menuBgBusy} icon={Sparkles}>
                                            {store.menu_has_ai_bg
                                                ? (t.storeConfig.menuImage?.bgRegenerate || 'Regenerar fondo')
                                                : (t.storeConfig.menuImage?.bgGenerate || 'Generar fondo con IA')}
                                        </Button>
                                        {store.menu_has_ai_bg && (
                                            <Button variant="secondary" onClick={removeMenuBg} disabled={menuBgBusy} icon={Trash2}>
                                                {t.storeConfig.menuImage?.bgRemove || 'Quitar fondo'}
                                            </Button>
                                        )}
                                    </div>
                                    {menuBgBusy && (
                                        <p className="text-body-sm text-on-surface-muted">
                                            {t.storeConfig.menuImage?.bgWait || 'Generando fondo... puede tardar hasta un minuto.'}
                                        </p>
                                    )}
                                </div>
                            </SectionCard>
                        </div>
                    )}

                    {activeTab === 'payment' && store && (
                        <SectionCard
                            title="Configuración de pagos"
                            description="Cómo cobra el bot a tus clientes."
                            footer={
                                <Button onClick={savePaymentConfig} loading={saving} icon={Save}>
                                    {saving ? 'Guardando...' : 'Guardar configuración'}
                                </Button>
                            }
                        >
                            <div className="space-y-4">
                                <Field label="Proveedor de pago">
                                    <select
                                        value={store.payment_config?.provider || 'NEQUI_MANUAL'}
                                        onChange={(e) => handlePaymentConfigChange('provider', e.target.value)}
                                        className={inputCls(false)}
                                    >
                                        <option value="NEQUI_MANUAL">Nequi manual (foto del comprobante)</option>
                                        <option value="WOMPI">Wompi (link de pago automático)</option>
                                        <option value="BOLD">Bold (próximamente)</option>
                                    </select>
                                </Field>

                                {store.payment_config?.provider === 'WOMPI' && (
                                    <div className="space-y-4 p-4 bg-surface-container rounded-shape-md">
                                        <Field label="Public Key de Wompi">
                                            <input
                                                type="text"
                                                value={store.payment_config?.public_key || ''}
                                                onChange={(e) => handlePaymentConfigChange('public_key', e.target.value)}
                                                className={inputCls(false)}
                                                placeholder="pub_prod_xxxxxxxxxxxx"
                                            />
                                        </Field>
                                        <Field label="Integrity Secret">
                                            <input
                                                type="password"
                                                value={store.payment_config?.integrity_secret || ''}
                                                onChange={(e) => handlePaymentConfigChange('integrity_secret', e.target.value)}
                                                className={inputCls(false)}
                                                placeholder="prod_integrity_xxxxx"
                                            />
                                        </Field>
                                    </div>
                                )}

                                {store.payment_config?.provider === 'BOLD' && (
                                    <Notice tone="warning" icon={AlertCircle}>
                                        La integración con Bold aún no está disponible. Mientras tanto usa Wompi o Nequi manual.
                                    </Notice>
                                )}

                                {(!store.payment_config?.provider || store.payment_config?.provider === 'NEQUI_MANUAL') && (
                                    <Notice tone="info" title="Pago manual con comprobante">
                                        El cliente envía la foto del comprobante (Nequi/transferencia) y tú la verificas en el dashboard.
                                    </Notice>
                                )}

                                <div className="pt-4 border-t border-outline-variant">
                                    <Switch
                                        checked={store.payment_config?.is_active || false}
                                        onChange={(e) => handlePaymentConfigChange('is_active', e.target.checked)}
                                        label="Activar pagos automáticos"
                                    />
                                </div>
                            </div>
                        </SectionCard>
                    )}

                    {/* ============ CANALES ============ */}
                    {activeTab === 'channels' && store && (
                        <div className="space-y-5">
                            {/* WhatsApp */}
                            <SectionCard>
                                <div className="flex items-center gap-4 mb-6">
                                    <span className="w-10 h-10 rounded-shape-xl bg-success-container text-success-on-container flex items-center justify-center flex-shrink-0">
                                        <MessageCircle size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                                    </span>
                                    <div className="min-w-0">
                                        <h2 className="text-title-lg text-on-surface">WhatsApp Business</h2>
                                        <p className="text-body text-on-surface-variant mt-1">Conecta tu número para recibir pedidos</p>
                                    </div>
                                </div>
                                <WhatsAppConnect
                                    storeId={storeId}
                                    apiBaseUrl={API_BASE_URL}
                                    authToken={localStorage.getItem('access_token')}
                                />
                            </SectionCard>

                            {/* Plantillas: sin ellas el bot solo puede responder,
                                nunca iniciar una conversación de recompra. */}
                            <WhatsAppTemplates storeId={storeId} connected={waConnected} />

                            {/* Telegram */}
                            <SectionCard>
                                <div className="flex items-center justify-between gap-3 mb-6">
                                    <div className="flex items-center gap-4 min-w-0">
                                        <span className="w-10 h-10 rounded-shape-xl bg-info-container text-info-on-container flex items-center justify-center flex-shrink-0">
                                            <Send size={ICON.sm} strokeWidth={ICON.stroke} aria-hidden="true" />
                                        </span>
                                        <div className="min-w-0">
                                            <h2 className="text-title-lg text-on-surface">Telegram</h2>
                                            <p className="text-body text-on-surface-variant mt-1">Activa pedidos por Telegram</p>
                                        </div>
                                    </div>
                                    {tgStatus.connected && (
                                        <Badge tone="green" dot className="flex-shrink-0">Conectado</Badge>
                                    )}
                                </div>

                                {tgStatus.connected ? (
                                    <div className="flex items-center justify-between gap-3 bg-surface-container rounded-shape-md p-4">
                                        <div className="min-w-0">
                                            <p className="text-title text-on-surface truncate">
                                                {tgStatus.bot_username ? `@${tgStatus.bot_username}` : 'Bot conectado'}
                                            </p>
                                            <p className="text-body-sm text-on-surface-muted mt-0.5">Recibiendo pedidos en tiempo real.</p>
                                        </div>
                                        <Button variant="danger" icon={Unplug} onClick={disconnectTelegram} disabled={saving}>
                                            Desconectar
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <Field
                                            label="Bot Token de Telegram"
                                            hint={
                                                <>
                                                    1. Abre{' '}
                                                    <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                                                        @BotFather
                                                    </a>{' '}
                                                    · 2. Envía <code className="bg-surface-high text-on-surface-variant px-1 rounded-shape-xs">/newbot</code> · 3. Pega aquí el token.
                                                </>
                                            }
                                        >
                                            <input
                                                type="password"
                                                value={tgToken}
                                                onChange={(e) => setTgToken(e.target.value)}
                                                className={inputCls(false)}
                                                placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                                            />
                                        </Field>
                                        <Button
                                            icon={Send}
                                            loading={saving}
                                            disabled={saving || !tgToken.trim()}
                                            onClick={connectTelegram}
                                        >
                                            {saving ? 'Conectando...' : 'Conectar bot'}
                                        </Button>
                                    </div>
                                )}
                            </SectionCard>
                        </div>
                    )}
                </div>
            </div>

            {/* ============ PREVIEW DEL MENÚ EXTRAÍDO (IA) ============ */}
            {menuPreview && (() => {
                const total = menuPreview.length;
                const cat = menuPreview[Math.min(previewStep, total - 1)];
                const ci = Math.min(previewStep, total - 1);
                const isLast = ci === total - 1;
                const totalProducts = menuPreview.reduce((n, c) => n + c.products.length, 0);
                return (
                    <Modal
                        open
                        onClose={() => !confirmingMenu && closeMenuPreview()}
                        title={total > 1 ? `Revisa tu menú · categoría ${ci + 1} de ${total}` : 'Revisa tu menú'}
                        locked={confirmingMenu}
                        maxWidth="max-w-2xl"
                        footer={
                            <div className="flex items-center justify-between w-full gap-3">
                                <div className="flex items-center gap-2">
                                    <Button variant="ghost" onClick={closeMenuPreview} disabled={confirmingMenu}>
                                        Descartar
                                    </Button>
                                    {total > 1 && (
                                        <div className="hidden sm:flex items-center gap-2">
                                            {menuPreview.map((_, i) => (
                                                <button
                                                    key={i}
                                                    onClick={() => setPreviewStep(i)}
                                                    aria-label={`Categoría ${i + 1}`}
                                                    aria-current={i === ci}
                                                    className={cx(
                                                        'w-2 h-2 rounded-shape-xl transition-colors duration-short ease-standard',
                                                        i === ci ? 'bg-primary' : 'bg-outline-variant'
                                                    )}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    {ci > 0 && (
                                        <Button variant="ghost" onClick={() => setPreviewStep(ci - 1)} disabled={confirmingMenu}>
                                            Anterior
                                        </Button>
                                    )}
                                    {!isLast ? (
                                        <Button onClick={() => setPreviewStep(ci + 1)}>
                                            Avanzar
                                        </Button>
                                    ) : (
                                        <Button onClick={confirmMenuPreview} loading={confirmingMenu} icon={Save}>
                                            {confirmingMenu ? 'Creando...' : `Crear menú (${totalProducts})`}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        }
                    >
                        <div className="space-y-4">
                            <div className="rounded-shape-md px-4 py-3 flex items-start gap-3 bg-secondary-container text-secondary-on-container">
                                <Sparkles size={ICON.sm} strokeWidth={ICON.stroke} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                                <span className="text-body">
                                    Te tomará poco tiempo — revisa nombres y precios y tu menú quedará perfecto.
                                    Corrige lo que la IA haya leído mal antes de crearlo.
                                </span>
                            </div>

                            <div className="flex items-end gap-3">
                                <div className="flex-1 min-w-0">
                                    <Field label="Nombre de la categoría">
                                        <input
                                            type="text"
                                            value={cat.name}
                                            onChange={(e) => setPreviewCategoryName(ci, e.target.value)}
                                            className={inputCls(false)}
                                        />
                                    </Field>
                                </div>
                                <Badge tone="accent" className="mb-3 flex-shrink-0">
                                    {cat.products.length} producto{cat.products.length !== 1 ? 's' : ''}
                                </Badge>
                            </div>

                            <div className="border border-outline-variant rounded-shape-md overflow-hidden max-h-[48vh] overflow-y-auto divide-y divide-outline-variant">
                                {cat.products.map((p, pi) => {
                                    const isOpen = !!expandedProducts[`${ci}-${pi}`];
                                    const hasExtras = (p.description || '').trim() || p.variants?.length > 0;
                                    return (
                                        <div key={pi} className={cx(isOpen && 'bg-surface-container')}>
                                            <div className="flex items-center gap-1.5 pl-2 pr-1.5 py-1">
                                                <input
                                                    type="text"
                                                    value={p.name}
                                                    onChange={(e) => setPreviewProduct(ci, pi, 'name', e.target.value)}
                                                    className="min-w-0 h-10 px-2 text-body text-on-surface bg-transparent border border-transparent rounded-shape-xs outline-none focus:border-primary transition-colors duration-short ease-standard"
                                                    style={{ flex: '1 1 auto' }}
                                                    placeholder="Nombre del producto"
                                                />
                                                {p.variants?.length > 0 && !isOpen && (
                                                    <span className="hidden sm:inline text-label text-on-surface-muted flex-shrink-0">
                                                        {p.variants.length} var.
                                                    </span>
                                                )}
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    value={formatCOP(p.price)}
                                                    onChange={(e) => setPreviewProduct(ci, pi, 'price', Number(e.target.value.replace(/\D/g, '') || 0))}
                                                    className="h-10 px-2 text-body text-on-surface text-right tabular-nums bg-transparent border border-transparent rounded-shape-xs outline-none focus:border-primary transition-colors duration-short ease-standard"
                                                    style={{ flex: '0 0 6.5rem', width: '6.5rem' }}
                                                    placeholder="Precio"
                                                />
                                                <IconButton
                                                    icon={ChevronDown}
                                                    size="sm"
                                                    tone={hasExtras && !isOpen ? 'primary' : 'variant'}
                                                    className={cx('transition-transform duration-short ease-standard', isOpen && 'rotate-180')}
                                                    label={isOpen ? 'Ocultar detalle' : 'Editar detalle'}
                                                    onClick={() => toggleExpandedProduct(ci, pi)}
                                                />
                                                <IconButton
                                                    icon={Trash2}
                                                    size="sm"
                                                    tone="danger"
                                                    label="Quitar producto"
                                                    onClick={() => removePreviewProduct(ci, pi)}
                                                />
                                            </div>
                                            {isOpen && (
                                                <div className="px-3 pb-3 pt-0.5 space-y-3">
                                                    <input
                                                        type="text"
                                                        value={p.description}
                                                        onChange={(e) => setPreviewProduct(ci, pi, 'description', e.target.value)}
                                                        className={inputCls(false)}
                                                        placeholder="Descripción (opcional)"
                                                    />
                                                    {p.variants?.length > 0 && (
                                                        <div className="space-y-2">
                                                            <p className="text-label text-on-surface-variant">Variantes</p>
                                                            {p.variants.map((v, vi) => (
                                                                <div key={vi} className="flex gap-2 items-center">
                                                                    <input
                                                                        type="text"
                                                                        value={v.name}
                                                                        onChange={(e) => setPreviewVariant(ci, pi, vi, 'name', e.target.value)}
                                                                        className={cx(inputCls(false), 'min-w-0')}
                                                                        style={{ flex: '1 1 auto' }}
                                                                        placeholder="Ej: Familiar"
                                                                    />
                                                                    <input
                                                                        type="text"
                                                                        inputMode="numeric"
                                                                        value={formatCOP(v.price)}
                                                                        onChange={(e) => setPreviewVariant(ci, pi, vi, 'price', Number(e.target.value.replace(/\D/g, '') || 0))}
                                                                        className={cx(inputCls(false), 'text-right tabular-nums')}
                                                                        style={{ flex: '0 0 6.5rem', width: '6.5rem' }}
                                                                        placeholder="Precio"
                                                                    />
                                                                    <IconButton
                                                                        icon={X}
                                                                        size="sm"
                                                                        tone="danger"
                                                                        label="Quitar variante"
                                                                        onClick={() => removePreviewVariant(ci, pi, vi)}
                                                                    />
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {!cat.products.length && (
                                    <p className="text-body text-on-surface-muted text-center py-6">
                                        Quitaste todos los productos de esta categoría — no se creará.
                                    </p>
                                )}
                            </div>
                        </div>
                    </Modal>
                );
            })()}

            {/* ============ MODAL CATEGORÍA ============ */}
            <Modal
                open={showCategoryModal}
                onClose={() => !saving && setShowCategoryModal(false)}
                title={editingCategory ? 'Editar categoría' : 'Nueva categoría'}
                locked={saving}
                footer={
                    <>
                        <Button variant="ghost" onClick={() => setShowCategoryModal(false)} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button onClick={saveCategory} loading={saving} icon={Save}>
                            {saving ? 'Guardando...' : 'Guardar'}
                        </Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <Field label="Nombre" required error={categoryErrors.name}>
                        <input
                            type="text"
                            value={categoryForm.name}
                            onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                            onKeyDown={(e) => e.key === 'Enter' && saveCategory()}
                            className={inputCls(categoryErrors.name)}
                            placeholder="Ej: Hamburguesas"
                            autoFocus
                        />
                    </Field>
                    <Field label="Orden de visualización" hint="Categorías con menor número aparecen primero">
                        <input
                            type="number"
                            value={categoryForm.display_order}
                            onChange={(e) => setCategoryForm({ ...categoryForm, display_order: parseInt(e.target.value) || 0 })}
                            className={inputCls(false)}
                            min="0"
                        />
                    </Field>
                </div>
            </Modal>

            {/* ============ MODAL PRODUCTO ============ */}
            <Modal
                open={showProductModal}
                onClose={() => !saving && setShowProductModal(false)}
                title={editingProduct ? 'Editar producto' : 'Nuevo producto'}
                locked={saving}
                footer={
                    <>
                        <Button variant="ghost" onClick={() => setShowProductModal(false)} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button onClick={saveProduct} loading={saving} icon={Save}>
                            {saving ? 'Guardando...' : 'Guardar'}
                        </Button>
                    </>
                }
            >
                <div className="space-y-4">
                    <Field label="Nombre" required error={productErrors.name}>
                        <input
                            type="text"
                            value={productForm.name}
                            onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                            className={inputCls(productErrors.name)}
                            placeholder="Ej: Hamburguesa Clásica"
                            autoFocus
                        />
                    </Field>
                    <Field label="Descripción">
                        <textarea
                            value={productForm.description}
                            onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                            className={textareaCls(false)}
                            rows={2}
                            placeholder="Ej: Carne de res, lechuga, tomate..."
                        />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Precio" required error={productErrors.price}>
                            <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-body text-on-surface-variant" aria-hidden="true">$</span>
                                <input
                                    type="number"
                                    value={productForm.price}
                                    onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                                    className={cx(inputCls(productErrors.price), 'pl-8')}
                                    placeholder="15000"
                                    min="0"
                                    step="100"
                                />
                            </div>
                        </Field>
                        <Field label="Categoría" required error={productErrors.category}>
                            <select
                                value={productForm.category}
                                onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
                                className={inputCls(productErrors.category)}
                            >
                                <option value="">Selecciona...</option>
                                {categories.map(cat => (
                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                ))}
                            </select>
                        </Field>
                    </div>
                    <Field label="URL de imagen">
                        <div className="relative">
                            <ImageIcon size={ICON.xs} strokeWidth={ICON.stroke} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" aria-hidden="true" />
                            <input
                                type="url"
                                value={productForm.image_url}
                                onChange={(e) => setProductForm({ ...productForm, image_url: e.target.value })}
                                className={cx(inputCls(false), 'pl-10')}
                                placeholder="https://ejemplo.com/imagen.jpg"
                            />
                        </div>
                    </Field>

                    {/* Variantes (se guardan junto con el producto) */}
                    <Field label="Variantes" optional="(tamaños, adiciones...)">
                        {(productForm.variants || []).map((variant, idx) => (
                            <div key={idx} className="flex gap-2 mb-2 items-center">
                                <input
                                    type="text"
                                    value={variant.name}
                                    onChange={(e) => {
                                        const newVariants = [...productForm.variants];
                                        newVariants[idx] = { ...variant, name: e.target.value };
                                        setProductForm({ ...productForm, variants: newVariants });
                                    }}
                                    className={cx(inputCls(false), 'flex-1')}
                                    placeholder="Nombre (ej: Grande)"
                                />
                                <div className="w-28 flex-shrink-0">
                                    <input
                                        type="number"
                                        value={variant.price_adjustment}
                                        onChange={(e) => {
                                            const newVariants = [...productForm.variants];
                                            newVariants[idx] = { ...variant, price_adjustment: e.target.value };
                                            setProductForm({ ...productForm, variants: newVariants });
                                        }}
                                        className={inputCls(false)}
                                        placeholder="+$"
                                    />
                                </div>
                                <IconButton
                                    icon={X}
                                    size="sm"
                                    tone="danger"
                                    label="Quitar variante"
                                    type="button"
                                    onClick={() => {
                                        const newVariants = [...productForm.variants];
                                        newVariants.splice(idx, 1);
                                        setProductForm({ ...productForm, variants: newVariants });
                                    }}
                                />
                            </div>
                        ))}
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            icon={Plus}
                            onClick={() => setProductForm({
                                ...productForm,
                                variants: [...(productForm.variants || []), { name: '', price_adjustment: 0, is_active: true }]
                            })}
                        >
                            Agregar variante
                        </Button>
                    </Field>

                    <div className="pt-2">
                        <Switch
                            checked={productForm.is_active}
                            onChange={(e) => setProductForm({ ...productForm, is_active: e.target.checked })}
                            label="Disponible para la venta"
                        />
                    </div>
                </div>
            </Modal>
        </DashboardLayout>
    );
};

export default StoreConfig;
