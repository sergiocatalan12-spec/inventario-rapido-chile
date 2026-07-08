export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const { imageBase64, mediaType, modo } = req.body;
    if (!imageBase64 || !mediaType) return res.status(400).json({ error: 'Faltan datos' });

    const prompt = modo === 'barcode'
      ? `Analiza esta imagen y encuentra el código de barra EAN-13 o similar. Responde SOLO con JSON: {"barcode":"el número del código de barra"} o {"barcode":null} si no hay código visible.`
      : `Eres experto en productos de supermercado chileno. Analiza esta imagen y responde SOLO con JSON válido sin markdown: {"nombre":"nombre completo en español","marca":"marca o fabricante","categoria":"una de: lacteos|carnes|panaderia|frutas_verduras|bebidas|snacks|condimentos|conservas|desayuno|limpieza|higiene|mascotas|otro","formato":"contenido neto como 170g o 1L","unidad":"una de: unidad|kg|g|l|ml|caja|pack|bolsa"}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const texto = data.content?.[0]?.text?.trim() || '';
    const info = JSON.parse(texto.replace(/```json|```/g, '').trim());
    return res.status(200).json(info);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
