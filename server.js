// ============================================================
// PGRS KENINGAU — SERVER (v7 FINAL + HEALTH)
// Role: staff / admin
// Auto UPPERCASE
// Health endpoint untuk UptimeRobot
// ============================================================

const express = require('express');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIG
// ============================================================
const APP_PASSWORD = process.env.APP_PASSWORD;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Validate env variables on startup
if (!APP_PASSWORD) {
  console.error('❌ APP_PASSWORD is not set in environment variables!');
  process.exit(1);
}
if (!ADMIN_PASSWORD) {
  console.error('❌ ADMIN_PASSWORD is not set in environment variables!');
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.warn('⚠️ GEMINI_API_KEY is not set — AI features will fail.');
}
if (!GOOGLE_SHEET_ID) {
  console.warn('⚠️ GOOGLE_SHEET_ID is not set — Sheet features will fail.');
}

// ============================================================
// GEMINI AI
// ============================================================
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Updated model list (gemini-3.8-flash does NOT exist)
const MODEL_LIST = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro'
];

// ============================================================
// GOOGLE SHEETS (SECRET FILE)
// ============================================================
const auth = new google.auth.GoogleAuth({
  keyFile: '/etc/secrets/google-key.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// ============================================================
// HELPER: ROLE
// ============================================================
function getRole(pass) {
  if (pass === ADMIN_PASSWORD) return 'admin';
  if (pass === APP_PASSWORD) return 'staff';
  return null;
}

function checkPassword(req, res, next) {
  const pass = req.query.pass || req.body.pass || req.headers['x-app-password'];
  const role = getRole(pass);
  if (!role) return res.status(401).json({ error: 'Password salah' });
  req.role = role;
  next();
}

function checkAdmin(req, res, next) {
  const pass = req.query.pass || req.body.pass || req.headers['x-app-password'];
  const role = getRole(pass);
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Access denied — admin only' });
  }
  req.role = role;
  next();
}

// ============================================================
// HELPER: GEMINI FALLBACK
// ============================================================
async function callGeminiWithFallback(parts) {
  let lastError = null;
  for (const modelName of MODEL_LIST) {
    try {
      console.log(`[AI] Trying: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(parts);
      const text = result.response.text();
      console.log(`[AI] ✅ Success: ${modelName}`);
      return { success: true, text, model: modelName };
    } catch (err) {
      console.log(`[AI] ❌ Failed ${modelName}: ${err.message.substring(0, 80)}`);
      lastError = err;
    }
  }
  return { success: false, error: lastError?.message || 'All models failed' };
}

// ============================================================
// ROUTES
// ============================================================

// ------------------------------------------------------------
// HEALTH CHECK (untuk UptimeRobot + monitoring)
// ------------------------------------------------------------
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'PGRS Keningau',
    version: 'v7',
    gemini_configured: !!GEMINI_API_KEY,
    sheet_configured: !!GOOGLE_SHEET_ID,
    models: MODEL_LIST,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()) + 's'
  });
});

// ------------------------------------------------------------
// CHECK ROLE
// ------------------------------------------------------------
app.get('/api/check-role', (req, res) => {
  const pass = req.query.pass;
  const role = getRole(pass);
  if (role) {
    res.json({ success: true, role });
  } else {
    res.status(401).json({ success: false, error: 'Password salah' });
  }
});

// ------------------------------------------------------------
// CHECK PASSWORD
// ------------------------------------------------------------
app.get('/api/check-password', (req, res) => {
  const pass = req.query.pass;
  if (getRole(pass)) return res.json({ success: true });
  res.status(401).json({ success: false });
});

// ------------------------------------------------------------
// NEXT NUMBER
// ------------------------------------------------------------
app.get('/api/next-number', checkPassword, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A:A',
    });
    const rows = response.data.values || [];
    const dataRows = rows.length > 1 ? rows.length - 1 : 0;
    const nextNum = 355001 + dataRows;
    res.json({ success: true, nextNumber: nextNum });
  } catch (err) {
    console.error('next-number:', err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// TEST AI
// ------------------------------------------------------------
app.get('/api/test-ai', checkPassword, async (req, res) => {
  const result = await callGeminiWithFallback('Balas dengan: OK');
  if (result.success) {
    res.json({ success: true, model: result.model, reply: result.text });
  } else {
    res.status(503).json({ error: result.error });
  }
});

// ------------------------------------------------------------
// SCAN (admin only)
// ------------------------------------------------------------
app.post('/api/scan', checkAdmin, async (req, res) => {
  try {
    const { image, mimeType } = req.body;
    if (!image) return res.status(400).json({ error: 'Tiada gambar' });

    const prompt = `Extract data from this PGRS membership form. Return ONLY JSON:
{"nama":"","ic":"","dun":"N39 or N40 or N41","cawangan":"","tarikhLahir":"DD/MM/YYYY","tempatLahir":"","noTel":"","jawatan":"","alamat":""}
Use null if unclear.`;

    const result = await callGeminiWithFallback([
      prompt,
      { inlineData: { mimeType: mimeType || 'image/jpeg', data: image } }
    ]);

    if (!result.success) return res.status(503).json({ error: result.error });

    const cleanText = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const fb = cleanText.indexOf('{');
    const lb = cleanText.lastIndexOf('}');
    const jsonText = (fb !== -1 && lb !== -1) ? cleanText.substring(fb, lb + 1) : cleanText;
    const data = JSON.parse(jsonText);

    res.json({ success: true, data, model: result.model });
  } catch (err) {
    console.error('scan:', err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// SAVE (staff + admin) — AUTO UPPERCASE
// ------------------------------------------------------------
app.post('/api/save', checkPassword, async (req, res) => {
  try {
    const {
      nama, ic, dun, cawangan,
      tarikhLahir, tempatLahir, noTel, jawatan, alamat,
      noAhliManual
    } = req.body;

    if (!nama || !ic) return res.status(400).json({ error: 'Nama dan IC wajib' });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A:A',
    });
    const rows = response.data.values || [];
    const dataRows = rows.length > 1 ? rows.length - 1 : 0;
    const nextNum = 355001 + dataRows;
    const noAhli = noAhliManual || nextNum;

    const tarikhDaftar = new Date().toLocaleString('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A:L',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          nextNum,
          noAhli,
          (nama || '').toString().toUpperCase(),
          (ic || '').toString().toUpperCase(),
          (dun || '').toString().toUpperCase(),
          (cawangan || '').toString().toUpperCase(),
          (tarikhLahir || '').toString().toUpperCase(),
          (tempatLahir || '').toString().toUpperCase(),
          (noTel || '').toString().toUpperCase(),
          (jawatan || '').toString().toUpperCase(),
          (alamat || '').toString().toUpperCase(),
          tarikhDaftar
        ]],
      },
    });

    res.json({ success: true, noBorang: nextNum, noAhli });
  } catch (err) {
    console.error('save:', err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// LIST (admin only)
// ------------------------------------------------------------
app.get('/api/list', checkAdmin, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A:L',
    });
    const rows = response.data.values || [];
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// STATS (staff + admin)
// ------------------------------------------------------------
app.get('/api/stats', checkPassword, async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Sheet1!A:L',
    });
    const rows = response.data.values || [];
    const dataRows = rows.slice(1);

    const stats = {
      total: dataRows.length,
      n39: dataRows.filter(r => (r[4] || '').toString().toUpperCase().includes('N39')).length,
      n40: dataRows.filter(r => (r[4] || '').toString().toUpperCase().includes('N40')).length,
      n41: dataRows.filter(r => (r[4] || '').toString().toUpperCase().includes('N41')).length,
    };

    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// SERVE register.html
// ------------------------------------------------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'));
});

// ============================================================
// 404 FALLBACK
// ============================================================
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
  console.log('════════════════════════════════════════════');
  console.log(`✅ PGRS Keningau server running on port ${PORT}`);
  console.log(`🔑 Staff password: ${APP_PASSWORD ? 'SET' : 'MISSING ⚠️'}`);
  console.log(`🔐 Admin password: ${ADMIN_PASSWORD ? 'SET' : 'MISSING ⚠️'}`);
  console.log(`⚡ AI models: ${MODEL_LIST.length} (with fallback)`);
  console.log(`   → ${MODEL_LIST.join(', ')}`);
  console.log(`📊 Sheet ID: ${GOOGLE_SHEET_ID ? 'SET' : 'MISSING ⚠️'}`);
  console.log(`🩺 Health: /health & /api/health`);
  console.log('════════════════════════════════════════════');
});
