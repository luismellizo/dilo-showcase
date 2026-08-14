import { formatCOP } from './config';

/**
 * Comanda imprimible estilo ticket térmico 80mm.
 * Abre una ventana mínima con el pedido y lanza el diálogo de impresión.
 * Sin dependencias — HTML plano con CSS de impresión embebido.
 */

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export function printTicket(order, storeName = 'DILO') {
    const items = (order.items || [])
        .map(it => `
            <tr>
                <td class="qty">${esc(it.quantity)}×</td>
                <td class="name">${esc(it.product_name)}</td>
                <td class="price">${esc(formatCOP(it.unit_price))}</td>
            </tr>`)
        .join('');

    const created = order.created_at
        ? new Date(order.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })
        : '';

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Comanda #${esc(String(order.id).slice(0, 8))}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Courier New', monospace;
    width: 80mm;
    padding: 4mm;
    font-size: 12px;
    color: #000;
  }
  .center { text-align: center; }
  .store { font-size: 16px; font-weight: bold; text-transform: uppercase; }
  .meta { margin-top: 2mm; font-size: 11px; }
  hr { border: none; border-top: 1px dashed #000; margin: 3mm 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1mm 0; vertical-align: top; }
  .qty { width: 9mm; font-weight: bold; }
  .name { padding-right: 2mm; word-break: break-word; }
  .price { text-align: right; white-space: nowrap; }
  .total-row { font-size: 15px; font-weight: bold; }
  .block { margin-top: 2mm; font-size: 11px; white-space: pre-wrap; word-break: break-word; }
  .label { font-weight: bold; }
  @media print { body { width: auto; } }
</style>
</head>
<body>
  <div class="center">
    <div class="store">${esc(storeName)}</div>
    <div class="meta">Pedido #${esc(String(order.id).slice(0, 8))}</div>
    <div class="meta">${esc(created)}</div>
  </div>
  <hr>
  <div><span class="label">Cliente:</span> ${esc(order.customer_name || 'Cliente')}</div>
  ${order.customer_phone ? `<div><span class="label">Tel:</span> ${esc(order.customer_phone)}</div>` : ''}
  <hr>
  <table>${items || '<tr><td>—</td></tr>'}</table>
  <hr>
  <table>
    ${parseFloat(order.delivery_fee || 0) > 0 ? `
    <tr>
      <td class="name">Domicilio</td>
      <td class="price">${esc(formatCOP(order.delivery_fee))}</td>
    </tr>` : ''}
    <tr class="total-row">
      <td class="name">TOTAL</td>
      <td class="price">${esc(formatCOP(order.total_amount))}</td>
    </tr>
  </table>
  ${order.payment_method ? `<div class="block"><span class="label">Pago:</span> ${esc(order.payment_method)}</div>` : ''}
  ${order.delivery_address ? `<div class="block"><span class="label">Entrega:</span> ${esc(order.delivery_address)}</div>` : ''}
  ${order.notes ? `<hr><div class="block"><span class="label">NOTAS:</span>\n${esc(order.notes)}</div>` : ''}
  <hr>
  <div class="center meta">dilo · pedidos por chat</div>
  <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); };</script>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=380,height=640');
    if (!win) return false; // popup bloqueado
    win.document.write(html);
    win.document.close();
    return true;
}

export default printTicket;
