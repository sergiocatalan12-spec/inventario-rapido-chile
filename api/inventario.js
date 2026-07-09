// /api/inventario.js — Endpoint público para ERPs
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SB_URL = 'https://vqwgxshbxixsbqxrejpi.supabase.co';
  const SB_KEY = 'sb_publishable_7kPWMGQhvmDTmVkcqVVsZw_zRWJDYc3';
  const H = { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };

  // Obtener API key
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) return res.status(401).json({ error: 'API key requerida' });

  try {
    // Validar API key
    const clientRes = await fetch(
      `${SB_URL}/rest/v1/api_clients?api_key=eq.${apiKey}&activo=eq.true&select=id,nombre`,
      { headers: H }
    );
    const clients = await clientRes.json();
    if (!clients.length) return res.status(403).json({ error: 'API key inválida o inactiva' });
    const client = clients[0];

    const { levantamiento_id } = req.query;

    // Consultar levantamientos completados
    let url = `${SB_URL}/rest/v1/levantamientos?api_client_id=eq.${client.id}&estado=eq.completado&select=id,created_at,completado_at,levantamiento_items(barcode,nombre,formato,unidad,precio_costo,cantidad,es_nuevo,product_id)&order=completado_at.desc`;
    if (levantamiento_id) url += `&id=eq.${levantamiento_id}`;

    const r = await fetch(url, { headers: H });
    const data = await r.json();

    const result = (data || []).map(lev => ({
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

    return res.status(200).json({
      cliente: client.nombre,
      total: result.length,
      levantamientos: levantamiento_id ? (result[0] || null) : result
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
