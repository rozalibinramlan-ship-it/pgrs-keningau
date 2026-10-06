const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ===== CONFIG =====
const APP_PASSWORD = process.env.APP_PASSWORD || 'pgrs-keningau';
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '';
const GOOGLE_SERVICE_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const GOOGLE_PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

// ===== AI =====
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'MISSING' });
const AI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];

// ===== DUN DATABASE =====
let KAMPUNG_DATABASE = {};

const DUN_LIST = ['N39 TAMBUNAN', 'N40 BINGKOR', 'N41 LIAWAN'];

// ===== PASSWORD MIDDLEWARE =====
function checkPassword(req, res, next) {
    const pass = req.query.pass || req.body.pass || req.headers['x-app-pass'];
    if (pass !== APP_PASSWORD) {
        if (req.path === '/' || req.path === '/register') {
            return res.send(`<!DOCTYPE html><html><head><title>Login PGRS</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{background:#050a15;color:white;font-family:Arial;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}.login-box{background:linear-gradient(135deg,#0d1526,#101c33);border:1px solid #38bdf8;border-radius:15px;padding:40px 30px;max-width:400px;width:100%;text-align:center;box-shadow:0 0 30px rgba(56,189,248,0.3)}h1{color:#fbbf24;margin-bottom:10px;font-size:22px;letter-spacing:2px}p{color:#94a3b8;margin-bottom:30px;font-size:12px}input{width:100%;padding:15px;font-size:16px;border-radius:10px;border:1px solid #38bdf8;background:rgba(5,10,21,0.8);color:white;box-sizing:border-box;margin-bottom:15px}button{width:100%;padding:15px;font-size:16px;background:linear-gradient(135deg,#38bdf8,#0284c7);color:white;border:none;border-radius:10px;cursor:pointer;font-weight:bold;letter-spacing:2px}</style></head><body><div class="login-box"><h1>🔒 PGRS KENINGAU</h1><p>REGISTER AHLI PARTI</p><form method="GET"><input type="password" name="pass" placeholder="Masukkan password" autofocus><button type="submit">MASUK</button></form></div></body></html>`);
        }
        return res.status(401).json({ status: 'error', message: 'Password salah' });
    }
    next();
}

// ===== GOOGLE SHEETS CLIENT =====
function getSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: GOOGLE_SERVICE_EMAIL,
            private_key: GOOGLE_PRIVATE_KEY
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    return google.sheets({ version: 'v4', auth });
}

// ===== AI CALL =====
async function callAI(prompt, imageBase64 = null) {
    const contents = [];
    if (imageBase64) {
        contents.push({ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } });
    }
    contents.push({ text: prompt });
    
    let lastErr = null;
    for (const model of AI_MODELS) {
        try {
            const result = await ai.models.generateContent({ model: model, contents: contents });
            console.log(`✅ AI guna model: ${model}`);
            return result.text;
        } catch (e) {
            console.log(`❌ ${model} gagal: ${e.message}`);
            lastErr = e;
        }
    }
    throw lastErr;
}

// ===== CLEAN JSON =====
function cleanJSON(text) {
    let clean = text.trim();
    clean = clean.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1) clean = clean.substring(start, end + 1);
    return clean;
}

// ===== AUTO-DETECT DUN =====
function detectDUN(alamat) {
    if (!alamat) return { dun: null, confidence: 'none', keyword: null };
    const alamatLower = alamat.toLowerCase();
    for (const [keyword, dun] of Object.entries(KAMPUNG_DATABASE)) {
        if (alamatLower.includes(keyword.toLowerCase())) {
            return { dun: dun, confidence: 'auto', keyword: keyword };
        }
    }
    if (alamatLower.includes('liawan') || alamatLower.includes('agudon')) return { dun: 'N41 LIAWAN', confidence: 'guess', keyword: 'agudon' };
    if (alamatLower.includes('bingkor') || alamatLower.includes('bunsit')) return { dun: 'N40 BINGKOR', confidence: 'guess', keyword: 'bingkor' };
    if (alamatLower.includes('tambunan') || alamatLower.includes('keranaan')) return { dun: 'N39 TAMBUNAN', confidence: 'guess', keyword: 'tambunan' };
    return { dun: null, confidence: 'none', keyword: null };
}

// ===== ROUTES =====
app.get('/', checkPassword, (req, res) => res.sendFile(__dirname + '/register.html'));
app.get('/register', checkPassword, (req, res) => res.sendFile(__dirname + '/register.html'));
app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));

// ===== SCAN BORANG =====
app.post('/api/scan-borang', checkPassword, async (req, res) => {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ status: 'error', message: 'No image' });
    try {
        const prompt = `Baca borang keahlian PARTI GAGASAN RAKYAT SABAH (PGRS) ini. Extract SEMUA data dan return JSON ONLY: {"no_borang":"355001","bahagian":"N41 LIAWAN","cawangan":"K4 AGUDON","nama":"NAMA","ic_no":"XXXXXX-XX-XXXX","tarikh_lahir":"DD/MM/YYYY","jantina":"LELAKI/PEREMPUAN","alamat":"ALAMAT","phone":"0123456789","jenis_keahlian":"BIASA"}`;
        const result = await callAI(prompt, imageBase64);
        const data = JSON.parse(cleanJSON(result));
        const detection = detectDUN(data.alamat);
        data.dun_detected = detection.dun;
        data.detection_confidence = detection.confidence;
        data.learn_keyword = detection.keyword;
        data.no_ahli = data.no_borang;
        data.tarikh_scan = new Date().toISOString();
        res.json({ status: 'success', data: data, auto_detected: detection.confidence === 'auto' });
    } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ===== SCAN IC =====
app.post('/api/scan-ic', checkPassword, async (req, res) => {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ status: 'error', message: 'No image' });
    try {
        const prompt = `Baca IC Malaysia ini. Return JSON ONLY: {"nama":"NAMA","ic_no":"XXXXXX-XX-XXXX","alamat":"ALAMAT"}`;
        const result = await callAI(prompt, imageBase64);
        const data = JSON.parse(cleanJSON(result));
        res.json({ status: 'success', data: data });
    } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ===== SAVE AHLI =====
app.post('/api/save-ahli', checkPassword, async (req, res) => {
    const { data, selected_dun, learn_keyword } = req.body;
    if (!data) return res.status(400).json({ status: 'error', message: 'No data' });
    try {
        if (selected_dun && learn_keyword) {
            KAMPUNG_DATABASE[learn_keyword.toLowerCase()] = selected_dun;
        }
        const dunFinal = selected_dun || data.dun_detected || data.bahagian;
        data.dun = dunFinal;
        if (GOOGLE_SHEET_ID && GOOGLE_SERVICE_EMAIL) {
            const sheets = getSheetsClient();
            const existing = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: 'Sheet1!A:A' });
            const noBorangList = (existing.data.values || []).map(r => r[0]);
            const rowIndex = noBorangList.indexOf(data.no_borang);
            const rowData = [[data.no_borang||'', data.no_ahli||'', data.dun||'', data.cawangan||'', data.nama||'', data.ic_no||'', data.tarikh_lahir||'', data.tempat_lahir||'', data.jantina||'', data.agama||'', data.bangsa||'', data.suku||'', data.alamat||'', data.poskod||'', data.daerah||'', data.negeri||'', data.phone||'', data.email||'', data.jenis_keahlian||'', data.tarikh_permohonan||'', data.tarikh_scan||new Date().toISOString()]];
            if (rowIndex > 0) {
                await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `Sheet1!A${rowIndex+1}:U${rowIndex+1}`, valueInputOption: 'USER_ENTERED', requestBody: { values: rowData } });
            } else {
                await sheets.spreadsheets.values.append({ spreadsheetId: GOOGLE_SHEET_ID, range: 'Sheet1!A:U', valueInputOption: 'USER_ENTERED', requestBody: { values: rowData } });
            }
        }
        res.json({ status: 'success', message: 'Saved', data: data });
    } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ===== AHLI LIST =====
app.get('/api/ahli-list', checkPassword, async (req, res) => {
    try {
        if (!GOOGLE_SHEET_ID) return res.json({ status: 'success', ahli: [], total: 0 });
        const sheets = getSheetsClient();
        const result = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: 'Sheet1!A2:U' });
        const rows = result.data.values || [];
        const ahli = rows.map(row => ({ no_borang: row[0]||'', no_ahli: row[1]||'', dun: row[2]||'', cawangan: row[3]||'', nama: row[4]||'', ic_no: row[5]||'', jantina: row[8]||'', phone: row[16]||'', jenis_keahlian: row[18]||'' }));
        res.json({ status: 'success', ahli: ahli, total: ahli.length });
    } catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ===== DOWNLOAD EXCEL =====
app.get('/api/download-excel', checkPassword, (req, res) => {
    if (!GOOGLE_SHEET_ID) return res.status(500).send('Sheet ID tak set');
    res.redirect(`https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=xlsx`);
});

// ===== PRINT VIEW =====
app.get('/api/print-view', checkPassword, (req, res) => {
    if (!GOOGLE_SHEET_ID) return res.status(500).send('Sheet ID tak set');
    res.redirect(`https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/print`);
});

// ===== KAMPUNG DB =====
app.get('/api/kampung-db', checkPassword, (req, res) => {
    res.json({ status: 'success', database: KAMPUNG_DATABASE, total: Object.keys(KAMPUNG_DATABASE).length });
});

// ===== DUN LIST =====
app.get('/api/dun-list', checkPassword, (req, res) => {
    res.json({ status: 'success', dun: DUN_LIST });
});

// ===== START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 PGRS KENINGAU berjalan di port ${PORT}`);
    console.log(`🔐 Password: ${APP_PASSWORD}`);
    console.log(`📊 Google Sheet: ${GOOGLE_SHEET_ID ? 'Set ✅' : 'Belum set ❌'}`);
});