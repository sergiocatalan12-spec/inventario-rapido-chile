// /api/inventario.js — Endpoint público para ERPs
// Uso: GET /api/inventario?api_key=TU_KEY&levantamiento_id=UUID
//      POST /api/inventario — recibe webhook cuando operador da OK

const SB_URL = process.env.SUPABASE_URL;
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Obtener API key desde header o query
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) return res.status(401).json({ error: 'API key requerida' });

  // Validar API key en Supabase
  const clientRes = await fetch(
    `${SB_URL}/rest/v1/api_clients?api_key=eq.${apiKey}&activo=eq.true&select=id,nombre`,
    { headers: { 'apikey': SB_SERVICE_KEY, 'Authorization': `Bearer ${SB_SERVICE_KEY}` } }
  );
  const clients = await clientRes.json();
  if (!clients.length) return res.status(403).json({ error: 'API key inválida o inactiva' });
  const client = clients[0];

  // GET — consultar levantamiento específico o listar todos
  if (req.method === 'GET') {
    const { levantamiento_id } = req.query;

    let url = `${SB_URL}/rest/v1/levantamientos?api_client_id=eq.${client.id}&estado=eq.completado&select=id,created_at,completado_at,operador_id,levantamiento_items(barcode,nombre,formato,unidad,precio_costo,cantidad,es_nuevo,product_id)&order=completado_at.desc`;
    if (levantamiento_id) url += `&id=eq.${levantamiento_id}`;

    const r = await fetch(url, {
      headers: { 'apikey': SB_SERVICE_KEY, 'Authorization': `Bearer ${SB_SERVICE_KEY}` }
    });
    const data = await r.json();

    // Formatear respuesta
    const result = data.map(lev => ({
      levantamiento_id: lev.id,
      fecha: lev.completado_at,
      total_productos: lev.levantamiento_items?.length || 0,
      total_unidades: lev.levantamiento_items?.reduce((s, i) => s + i.cantidad, 0) || 0,
      productos_nuevos: lev.levantamiento_items?.filter(i => i.es_nuevo).length || 0,
      items: lev.levantamiento_items?.map(i => ({
        codigo_barra: i.barcode,
        product_id: i.product_id,
        nombre: i.nombre,
        formato: i.formato,
        unidad: i.unidad,
        precio_costo: i.precio_costo,
        cantidad: i.cantidad,
        es_nuevo: i.es_nuevo
      }))
    }));

    // Marcar como enviado si se pidió uno específico
    if (levantamiento_id && result.length) {
      await fetch(`${SB_URL}/rest/v1/levantamientos?id=eq.${levantamiento_id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SB_SERVICE_KEY,
          'Authorization': `Bearer ${SB_SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ estado: 'enviado' })
      });
    }

    return res.status(200).json({
      cliente: client.nombre,
      levantamientos: levantamiento_id ? result[0] || null : result
    });
  }

  return res.status(405).json({ error: 'Método no permitido' });
};
