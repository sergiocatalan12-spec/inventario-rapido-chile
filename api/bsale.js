// /api/bsale.js — Integración ICH ↔ Bsale
// Permite a un cliente Bsale:
// 1. Conectar su cuenta Bsale a ICH (POST /api/bsale?action=conectar)
// 2. Importar su catálogo de Bsale a ICH para mapeo (POST /api/bsale?action=importar)
// 3. Enviar levantamiento ICH directo a Bsale (POST /api/bsale?action=enviar)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SB_URL = 'https://vqwgxshbxixsbqxrejpi.supabase.co';
  const SB_KEY = 'sb_publishable_7kPWMGQhvmDTmVkcqVVsZw_zRWJDYc3';
  const H_SB = { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };

  const { action } = req.query;
  const body = req.body || {};

  try {

    // ══ ACCIÓN 1 — CONECTAR cuenta Bsale ══
    // El cliente pega su access_token de Bsale y su subdominio
    // ICH guarda las credenciales y verifica que funcionen
    if (action === 'conectar') {
      const { bsale_token, bsale_url, levantamiento_id } = body;
      if (!bsale_token || !bsale_url) return res.status(400).json({ error: 'Falta bsale_token o bsale_url' });

      // Verificar que el token funcione llamando a Bsale
      const test = await fetch(`https://${bsale_url}.bsale.cl/v1/products/count.json`, {
        headers: { 'access_token': bsale_token }
      });
      if (!test.ok) return res.status(401).json({ error: 'Token de Bsale inválido' });
      const { count } = await test.json();

      // Guardar credenciales en Supabase vinculadas al levantamiento
      await fetch(`${SB_URL}/rest/v1/erp_conexiones`, {
        method: 'POST',
        headers: { ...H_SB, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          levantamiento_id,
          erp_tipo: 'bsale',
          erp_token: bsale_token,
          erp_url: bsale_url,
          productos_en_erp: count
        })
      });

      return res.status(200).json({
        ok: true,
        mensaje: `Conectado a Bsale — ${count} productos en tu cuenta`
      });
    }

    // ══ ACCIÓN 2 — IMPORTAR catálogo Bsale ══
    // Descarga todos los productos de Bsale con su barCode
    // Crea tabla de mapeo: barCode → variantId de Bsale
    if (action === 'importar') {
      const { bsale_token, bsale_url } = body;
      if (!bsale_token || !bsale_url) return res.status(400).json({ error: 'Falta bsale_token o bsale_url' });

      const BSALE_BASE = `https://${bsale_url}.bsale.cl/v1`;
      const BSALE_H = { 'access_token': bsale_token };

      // Descargar variantes de Bsale (tienen el barCode)
      let offset = 0;
      let mapeo = []; // [{barcode, variant_id, sku, nombre}]
      let totalDescargado = 0;

      while (true) {
        const r = await fetch(`${BSALE_BASE}/variants.json?limit=50&offset=${offset}&expand=[product]`, {
          headers: BSALE_H
        });
        const data = await r.json();
        if (!data.items || data.items.length === 0) break;

        data.items.forEach(v => {
          if (v.barCode) {
            mapeo.push({
              barcode: v.barCode,
              variant_id: v.id,
              sku: v.code,
              nombre: v.product?.name || v.description
            });
          }
        });

        totalDescargado += data.items.length;
        if (data.items.length < 50) break;
        offset += 50;
      }

      return res.status(200).json({
        ok: true,
        total_variantes: totalDescargado,
        con_barcode: mapeo.length,
        mapeo: mapeo.slice(0, 10), // Preview de los primeros 10
        mensaje: `${mapeo.length} productos con código de barra listos para mapear`
      });
    }

    // ══ ACCIÓN 3 — ENVIAR levantamiento a Bsale ══
    // Toma los items del levantamiento ICH
    // Los cruza con el catálogo Bsale por barCode
    // Crea o actualiza el stock en Bsale
    if (action === 'enviar') {
      const { bsale_token, bsale_url, levantamiento_id, office_id = 1 } = body;
      if (!bsale_token || !bsale_url || !levantamiento_id) {
        return res.status(400).json({ error: 'Faltan parámetros' });
      }

      // Obtener items del levantamiento ICH
      const levR = await fetch(
        `${SB_URL}/rest/v1/levantamiento_items?levantamiento_id=eq.${levantamiento_id}&select=*`,
        { headers: H_SB }
      );
      const items = await levR.json();
      if (!items.length) return res.status(404).json({ error: 'No hay items en este levantamiento' });

      const BSALE_BASE = `https://${bsale_url}.bsale.cl/v1`;
      const BSALE_H = { 'access_token': bsale_token, 'Content-Type': 'application/json' };

      let enviados = 0;
      let nuevos = 0;
      let errores = [];

      for (const item of items) {
        try {
          if (!item.barcode) continue;

          // Buscar variante en Bsale por código de barra
          const buscar = await fetch(
            `${BSALE_BASE}/variants.json?barcode=${item.barcode}&expand=[product]`,
            { headers: BSALE_H }
          );
          const resultado = await buscar.json();

          if (resultado.items && resultado.items.length > 0) {
            // ✅ Producto existe en Bsale — actualizar stock
            const variante = resultado.items[0];

            await fetch(`${BSALE_BASE}/stocks.json`, {
              method: 'POST',
              headers: BSALE_H,
              body: JSON.stringify({
                quantity: item.cantidad,
                variantId: variante.id,
                officeId: office_id,
                note: `Levantamiento ICH — ${new Date().toLocaleDateString('es-CL')}`
              })
            });
            enviados++;

          } else {
            // ⚠️ Producto NO existe en Bsale — crearlo primero
            // 1. Crear producto
            const prodR = await fetch(`${BSALE_BASE}/products.json`, {
              method: 'POST',
              headers: BSALE_H,
              body: JSON.stringify({
                name: item.nombre,
                stockControl: 1,
                allowDecimal: 0,
                productTypeId: 1
              })
            });
            const prod = await prodR.json();

            // 2. Crear variante con barCode
            const varR = await fetch(`${BSALE_BASE}/variants.json`, {
              method: 'POST',
              headers: BSALE_H,
              body: JSON.stringify({
                productId: prod.id,
                description: item.formato || item.nombre,
                barCode: item.barcode,
                code: item.barcode,
                unlimitedStock: 0,
                allowNegativeStock: 0
              })
            });
            const variante = await varR.json();

            // 3. Registrar stock inicial
            await fetch(`${BSALE_BASE}/stocks.json`, {
              method: 'POST',
              headers: BSALE_H,
              body: JSON.stringify({
                quantity: item.cantidad,
                variantId: variante.id,
                officeId: office_id,
                note: `Producto nuevo — Levantamiento ICH`
              })
            });
            nuevos++;
          }
        } catch (e) {
          errores.push({ barcode: item.barcode, error: e.message });
        }
      }

      // Marcar levantamiento como enviado a Bsale
      await fetch(`${SB_URL}/rest/v1/levantamientos?id=eq.${levantamiento_id}`, {
        method: 'PATCH',
        headers: H_SB,
        body: JSON.stringify({ estado: 'enviado', enviado_a: 'bsale' })
      });

      return res.status(200).json({
        ok: true,
        total_procesados: items.length,
        actualizados_en_bsale: enviados,
        creados_en_bsale: nuevos,
        errores: errores.length,
        detalle_errores: errores,
        mensaje: `✅ ${enviados} productos actualizados y ${nuevos} creados en Bsale`
      });
    }

    return res.status(400).json({ error: 'Acción no válida. Usa: conectar, importar o enviar' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
