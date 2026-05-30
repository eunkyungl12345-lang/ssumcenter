module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;

  if (!TOKEN || !BASE_ID) {
    return res.status(500).json({ error: "서버 환경변수가 설정되지 않았습니다" });
  }

  const { table, recordId, filter, sort } = req.query;
  if (!table) return res.status(400).json({ error: "table 파라미터 필요" });

  let url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`;
  if (recordId) url += `/${recordId}`;

  const params = new URLSearchParams();
  if (filter) params.set("filterByFormula", filter);
  if (sort) params.set("sort[0][field]", sort);
  params.set("sort[0][direction]", "desc");
  if (!recordId && req.method === "GET") url += `?${params.toString()}`;

  try {
    const options = {
      method: req.method,
      headers: {
        "Authorization": `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      }
    };
    if (req.method === "POST" || req.method === "PATCH") {
      options.body = JSON.stringify(req.body);
    }

    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) return res.status(response.status).json(data);
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
