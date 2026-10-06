const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname));

// Environment Variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const APP_PASSWORD = process.env.APP_PASSWORD || 'pgrs-keningau';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ============================================================
// PASSWORD MIDDLEWARE
// ============================================================
function checkPassword(req, res, next) {
  const pass = req.query.pass || req.body.pass;
  if (pass !== APP_PASSWORD) {
    return res.status(401).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>PGRS Keningau - Login</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: Arial; background: #0a1929; color: white; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
          .box { background: #132f4c; padding: 40px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); text-align: center; width: 90%; max-width: 400px; }
          h1 { color: #66b2ff; margin-bottom: 8px; }
          p { color: #b0c4de; margin-bottom: 24px; }
          input { width: 100%; padding: 12px; border: 2px solid #1e4976; border-radius: 8px; background: #0a1929; color: white; font-size: 16px; box-sizing: border-box; }
          button { width: 100%; padding: 12px; margin-top: 16px; background: #1976d2; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; }
          button:hover { background: #1565c0; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>🔒 PGRS KENINGAU</h1>
          <p>Register Ahli Parti</p>
          <form method="GET">
            <input type="password" name="pass" placeholder="Masukkan password" autofocus required>
            <button type="submit">MASUK</button>
          </form>
        </div>
      </body>
      </html>
    `);
  }
  next();
}

// ============================================================
// GOOGLE SHEETS HELPER
// ============================================================
async function getSheet() {
  const serviceAccountAuth = new JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  return doc;
}

// ============================================================
// ROUTES
// ============================================================

// Home page
app.get('/', checkPassword, (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'));
});

// Get next number
app.get('/api/next-number', checkPassword, async (req, res) => {
  try {
    const doc = await getSheet();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    const nextNum = 355001 + rows.length;
    res.json({ next: nextNum, total: rows.length });
  } catch (err) {
    console.error('Error next-number:', err);
    res.status(500).json({ error: err.message });
  }
});

// Scan borang (Gemini AI)
app.post('/api/scan', checkPassword, async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Tiada gambar' });
    }

    // ⭐ MODEL TERKINI — Gemini 2.5 Flash
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `Anda adalah pembantu untuk membaca borang pendaftaran ahli parti PGRS Keningau.
Baca maklumat dari gambar borang ini dan kembalikan dalam format JSON SAHAJA (tanpa markdown, tanpa penjelasan):

{
  "nama": "nama penuh",
  "ic": "nombor IC tanpa dash",
  "alamat": "alamat penuh",
  "telefon": "nombor telefon",
  "dun": "N39 atau N40 atau N41",
  "cawangan": "nama cawangan",
  "tarikh": "YYYY-MM-DD"
}

Jika ada maklumat yang tidak jelas atau tidak ada, letakkan string kosong "".
Pastikan output adalah JSON SAHAJA.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: image.replace(/^data:image\/\w+;base64,/, '')
        }
      }
    ]);

    const response = await result.response;
    let text = response.text().trim();

    // Clean up possible markdown
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({ error: 'Format JSON tak sah: ' + text });
    }

    res.json(data);
  } catch (err) {
    console.error('Error scan:', err);
    res.status(500).json({ error: err.message });
  }
});

// Save to Google Sheet
app.post('/api/save', checkPassword, async (req, res) => {
  try {
    const { nama, ic, alamat, telefon, dun, cawangan, tarikh } = req.body;

    if (!nama || !ic) {
      return res.status(400).json({ error: 'Nama dan IC wajib' });
    }

    const doc = await getSheet();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    const nextNum = 355001 + rows.length;

    await sheet.addRow({
      'NO': nextNum,
      'NAMA': nama,
      'IC': ic,
      'ALAMAT': alamat,
      'TELEFON': telefon,
      'DUN': dun,
      'CAWANGAN': cawangan,
      'TARIKH': tarikh || new Date().toISOString().split('T')[0],
      'MASA': new Date().toLocaleString('ms-MY', { timeZone: 'Asia/Kuala_Lumpur' })
    });

    res.json({ success: true, no: nextNum });
  } catch (err) {
    console.error('Error save:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all data
app.get('/api/all', checkPassword, async (req, res) => {
  try {
    const doc = await getSheet();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    const data = rows.map(r => ({
      no: r.get('NO'),
      nama: r.get('NAMA'),
      ic: r.get('IC'),
      alamat: r.get('ALAMAT'),
      telefon: r.get('TELEFON'),
      dun: r.get('DUN'),
      cawangan: r.get('CAWANGAN'),
      tarikh: r.get('TARIKH'),
      masa: r.get('MASA')
    }));
    res.json(data);
  } catch (err) {
    console.error('Error all:', err);
    res.status(500).json({ error: err.message });
  }
});

// Statistik
app.get('/api/stats', checkPassword, async (req, res) => {
  try {
    const doc = await getSheet();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();

    const stats = {
      total: rows.length,
      n39: rows.filter(r => r.get('DUN') === 'N39').length,
      n40: rows.filter(r => r.get('DUN') === 'N40').length,
      n41: rows.filter(r => r.get('DUN') === 'N41').length,
    };

    res.json(stats);
  } catch (err) {
    console.error('Error stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// Test AI
app.get('/api/test-ai', checkPassword, async (req, res) => {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent('Balas dengan: OK');
    res.json({ success: true, reply: result.response.text() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`✅ PGRS Keningau server running on port ${PORT}`);
  console.log(`🔒 Password: ${APP_PASSWORD}`);
  console.log(`🤖 AI Model: gemini-2.5-flash`);
});