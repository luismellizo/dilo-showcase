import React, { useState, useEffect } from 'react';
import { Save, User, Mail, Phone, Trash2 } from 'lucide-react';
import { useAuth } from './AuthContext';
import DashboardLayout from './DashboardLayout';
import { Avatar, SectionCard, Button, Field, Toast, Skeleton, Modal, inputCls, ICON, cx } from './ui';
import { API_BASE_URL } from './config';

/**
 * Zona de peligro: borrado definitivo de la cuenta.
 *
 * Meta exige que el usuario pueda eliminar sus datos desde el propio producto,
 * no solo escribiendo un correo. El borrado es real (arrastra tienda, menú,
 * clientes, pedidos y conversaciones), así que se pide escribir ELIMINAR.
 *
 * Visual: NO es una caja roja gritona. En M3 la gravedad la comunica la ACCIÓN
 * (un botón en rol de error + un diálogo que exige escribir la palabra), no un
 * bloque de color que grita antes de que el usuario haya hecho nada.
 */
const DangerZone = ({ fetchWithAuth, onError }) => {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState(null);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/auth/delete-account/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'ELIMINAR' }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setDone(data.confirmation_code);
        // Se cierra sesión tras un momento: la cuenta ya no existe.
        setTimeout(() => { logout(); window.location.href = '/'; }, 4000);
      } else {
        onError(data.error || 'No se pudo eliminar la cuenta');
        setOpen(false);
      }
    } catch {
      onError('Error de conexión');
      setOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <SectionCard
        className="mt-6"
        title="Eliminar mi cuenta"
        description={
          <>
            Borra de forma permanente tu negocio, tu menú, tus clientes, tus pedidos
            y todas las conversaciones. También desconecta tu canal de WhatsApp.
            No se puede deshacer.
          </>
        }
      >
        <Button
          variant="danger"
          icon={Trash2}
          onClick={() => { setConfirm(''); setOpen(true); }}
        >
          Eliminar mi cuenta
        </Button>
      </SectionCard>

      <Modal
        open={open}
        onClose={() => !deleting && setOpen(false)}
        title="Eliminar cuenta"
        footer={done ? null : (
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={deleting}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              loading={deleting}
              disabled={confirm.trim().toUpperCase() !== 'ELIMINAR' || deleting}
              onClick={handleDelete}
            >
              Eliminar definitivamente
            </Button>
          </>
        )}
      >
        {done ? (
          <div className="space-y-3">
            <p className="text-body">
              Tu cuenta y todos tus datos fueron eliminados.
            </p>
            <p className="text-body">
              Código de confirmación:{' '}
              <span className="text-on-surface tabular-nums">{done}</span>
            </p>
            <p className="text-body-sm text-on-surface-muted">Cerrando sesión...</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-body">
              Esta acción es irreversible. Se eliminarán tu tienda, tu menú completo,
              tus clientes, todos tus pedidos y su historial de conversaciones.
            </p>
            <Field label="Escribe ELIMINAR para confirmar">
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputCls(false)}
                placeholder="ELIMINAR"
                autoComplete="off"
              />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
};

/**
 * Cambio del correo de acceso.
 *
 * No se aplica aquí: se manda un enlace al buzón NUEVO y hasta que no se abra,
 * la cuenta sigue con el correo viejo. Así una sesión robada no puede quedarse
 * con la cuenta — y al correo viejo le llega la alarma.
 */
const EmailChangeModal = ({ open, onClose, currentEmail, fetchWithAuth, onToast }) => {
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!/\S+@\S+\.\S+/.test(newEmail)) return setError('Escribe un correo válido.');
    setSending(true);
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/auth/email-change/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_email: newEmail, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'No pudimos procesar el cambio.');
        return;
      }
      onToast({ message: data.message || `Confirma el cambio desde ${newEmail}`, type: 'success' });
      setNewEmail('');
      setPassword('');
      onClose();
    } catch {
      setError('Error de conexión');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !sending && onClose()}
      title="Cambiar correo de acceso"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={sending}>Cancelar</Button>
          <Button onClick={submit} loading={sending} disabled={sending}>
            Enviar confirmación
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-body">
          Te enviaremos un enlace de confirmación al correo nuevo. Tu correo actual
          (<span className="text-on-surface">{currentEmail}</span>) sigue siendo el de
          acceso hasta que lo abras.
        </p>
        <Field label="Correo nuevo">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className={inputCls(false)}
            placeholder="nuevo@correo.com"
            autoComplete="email"
          />
        </Field>
        <Field label="Tu contraseña actual" hint="Si entraste con Google, déjalo vacío.">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls(false)}
            autoComplete="current-password"
          />
        </Field>
        {error && <p className="text-body text-danger">{error}</p>}
      </div>
    </Modal>
  );
};

const Profile = () => {
  const { fetchWithAuth } = useAuth();
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', whatsapp_number: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [emailModal, setEmailModal] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetchWithAuth(`${API_BASE_URL}/api/auth/me/`);
        if (res.ok) {
          const data = await res.json();
          setForm({
            first_name: data.first_name || '',
            last_name: data.last_name || '',
            email: data.email || '',
            whatsapp_number: data.whatsapp_number || '',
          });
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [fetchWithAuth]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/auth/me/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: form.first_name,
          last_name: form.last_name,
          whatsapp_number: form.whatsapp_number,
        }),
      });
      if (res.ok) {
        setToast({ message: 'Perfil actualizado correctamente', type: 'success' });
      } else {
        setToast({ message: 'Error al guardar los cambios', type: 'error' });
      }
    } catch {
      setToast({ message: 'Error de conexión', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout title="Mi perfil" subtitle="Gestiona tu información personal">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="max-w-2xl">
        {loading ? (
          <div className="bg-surface-low rounded-shape-lg p-6">
            <div className="flex items-center gap-4 mb-6 pb-6 border-b border-outline-variant">
              <Skeleton className="w-12 h-12 rounded-shape-xl" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </div>
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </div>
        ) : (
          <SectionCard>
            <div className="flex items-center gap-4 mb-6 pb-6 border-b border-outline-variant">
              <Avatar name={form.first_name} size="xl" icon={User} />
              <div className="min-w-0">
                <p className="text-title text-on-surface truncate">{form.first_name} {form.last_name}</p>
                <p className="text-body text-on-surface-variant truncate">{form.email}</p>
              </div>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Nombre">
                  <div className="relative">
                    <User
                      size={ICON.sm}
                      strokeWidth={ICON.stroke}
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      autoComplete="given-name"
                      value={form.first_name}
                      onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                      className={cx(inputCls(false), 'pl-12')}
                      placeholder="Tu nombre"
                    />
                  </div>
                </Field>
                <Field label="Apellido">
                  <input
                    type="text"
                    autoComplete="family-name"
                    value={form.last_name}
                    onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    className={inputCls(false)}
                    placeholder="Tu apellido"
                  />
                </Field>
              </div>

              <Field
                label="Email"
                hint="Es tu usuario de acceso. Cambiarlo exige confirmar desde el correo nuevo."
              >
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Mail
                      size={ICON.sm}
                      strokeWidth={ICON.stroke}
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      type="email"
                      value={form.email}
                      readOnly
                      className={cx(inputCls(false), 'pl-12 cursor-not-allowed')}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="lg"
                    onClick={() => setEmailModal(true)}
                    className="flex-shrink-0"
                  >
                    Cambiar
                  </Button>
                </div>
              </Field>

              <Field label="WhatsApp">
                <div className="relative">
                  <Phone
                    size={ICON.sm}
                    strokeWidth={ICON.stroke}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    type="tel"
                    autoComplete="tel"
                    value={form.whatsapp_number}
                    onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })}
                    className={cx(inputCls(false), 'pl-12')}
                    placeholder="+57 300 000 0000"
                  />
                </div>
              </Field>

              <div className="pt-2">
                <Button type="submit" loading={saving} icon={Save}>
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </Button>
              </div>
            </form>
          </SectionCard>
        )}

        <EmailChangeModal
          open={emailModal}
          onClose={() => setEmailModal(false)}
          currentEmail={form.email}
          fetchWithAuth={fetchWithAuth}
          onToast={setToast}
        />

        {!loading && (
          <DangerZone
            fetchWithAuth={fetchWithAuth}
            onError={(message) => setToast({ message, type: 'error' })}
          />
        )}
      </div>
    </DashboardLayout>
  );
};

export default Profile;
