/* NeuroSync WalkAssist backend. Node 18+, no dependencies. Run: node server.js */
const http = require('http');
const fs = require('fs');
const path = require('path');

// Safe load for escalation.js if it exists in public/
let E = null;
try {
  E = require('./public/escalation.js');
} catch (e) {
  try {
    E = require('./escalation.js');
  } catch (err) {
    console.warn("Notice: escalation.js running in fallback mode.");
  }
}

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'neurosync.json');

/* ---------- JSON Database & State ---------- */
let db = { freezes: [], doses: [], notes: [], settings: { autoEmergency: true } };
try { 
  db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); 
} catch (e) {}
const save = () => fs.writeFile(DB_FILE, JSON.stringify(db, null, 1), () => {});

const CONTACTS = {
  sarah: { name: 'Sarah Vance', tel: '+21698420115' },
  clinic: { name: 'Dr. Ahmed Ben Salah', tel: '+21671850000' },
  emergency: { name: 'Emergency services', tel: '190' },
};

// Live Telemetry shared across band, patient app, and doctor dashboard
let telemetryState = {
  patient_id: "PT-1042",
  freeze_index: 0.0006,
  cadence_spm: 109,
  state: "NORMAL",
  cue_active: false,
  timestamp: 0.0,
  last_updated: new Date().toLocaleTimeString(),
  episodes: [],
  notes: []
};

/* ---------- Outbound Actions & Escalation ---------- */
async function notify(kind, who, ep) {
  console.log(`[${new Date().toISOString()}] ${kind.toUpperCase()} -> ${who.name} (${who.tel})`);
}

let ep = null;
function onStage(stage) {
  if (stage === 'window') return console.log('Push notification: "Are you okay?"');
  if (stage === 'emergency' && !db.settings.autoEmergency) return console.log('Auto-dial disabled.');
  if (CONTACTS[stage]) notify('call', CONTACTS[stage], ep);
}

function endEpisode(how) {
  if (!ep) return;
  if (E && E.resolve) E.resolve(ep, how);
  db.freezes.push({ at: ep.t0 || Date.now(), how, stages: ep.entered || [] });
  save();
  ep = null;
}

if (E && E.advance) {
  setInterval(() => {
    if (ep && ep.stage !== 'resolved') E.advance(ep, Date.now()).forEach(onStage);
  }, 250);
}

/* ---------- API Routes ---------- */
const routes = {
  // 1. Ingestion endpoint for mock_band.js streaming algorithm_output.csv
  'POST /api/telemetry': (b) => {
    telemetryState.freeze_index = parseFloat(b.freeze_index) || telemetryState.freeze_index;
    telemetryState.cadence_spm = parseInt(b.cadence_spm, 10) || telemetryState.cadence_spm;
    telemetryState.state = b.state || telemetryState.state;
    telemetryState.cue_active = b.cue_active !== undefined ? b.cue_active : telemetryState.cue_active;
    telemetryState.timestamp = b.timestamp !== undefined ? b.timestamp : telemetryState.timestamp;
    telemetryState.last_updated = new Date().toLocaleTimeString();

    if (b.state === 'FOG_DETECTED' && (!telemetryState.in_freeze)) {
      telemetryState.in_freeze = true;
      const episode = {
        time: telemetryState.last_updated,
        duration: 8.0,
        peak_fi: parseFloat(b.freeze_index).toFixed(2),
        latency: 310,
        context: "Doorway Hesitation / Turning Block"
      };
      telemetryState.episodes.unshift(episode);
      db.freezes.unshift(episode);
      save();
    } else if (b.state === 'NORMAL') {
      telemetryState.in_freeze = false;
    }
    return { success: true, state: telemetryState.state };
  },

  // 2. Telemetry polling endpoint (polled by patient app & doctor portal)
  'GET /api/live': () => telemetryState,

  // 3. Original companion endpoints
  'GET /api/dashboard/PT-1042': () => ({
    now: Date.now(),
    status: telemetryState.state === 'FOG_DETECTED' ? 'freeze' : 'nominal',
    cadence: telemetryState.cadence_spm,
    fi: telemetryState.freeze_index,
    freezes_24h: 4 + db.freezes.length,
    episode: ep,
    settings: db.settings,
    doses: db.doses.slice(-5),
  }),

  'POST /api/simulate/freeze': () => {
    if (E && (!ep || ep.stage === 'resolved')) {
      ep = E.start(Date.now(), { auto: db.settings.autoEmergency });
      onStage('window');
    }
    telemetryState.state = 'FOG_DETECTED';
    telemetryState.freeze_index = 2.83;
    telemetryState.cadence_spm = 0;
    return { episode: ep, now: Date.now() };
  },

  'POST /api/escalation/dismiss': () => { endEpisode('patient_dismissed'); return { episode: ep }; },
  'POST /api/escalation/answered': (b) => { endEpisode('answered_' + (b.by || 'caregiver')); return { episode: ep }; },
  'POST /api/sos': () => {
    if (E && (!ep || ep.stage === 'resolved')) ep = E.start(Date.now());
    if (ep) {
      ep.stage = 'emergency'; 
      ep.deadline = (E && E.FAR) || Date.now() + 999999; 
      ep.total = 0; 
      ep.entered = ep.entered || [];
      ep.entered.push('emergency');
    }
    onStage('emergency');
    return { episode: ep, now: Date.now() };
  },

  'POST /api/settings': (b) => { db.settings.autoEmergency = b.autoEmergency !== false; save(); return db.settings; },
  'POST /api/meds/log': () => { db.doses.push({ at: Date.now(), drug: 'Levodopa/Carbidopa 100/25 CR' }); save(); return { ok: true }; },
  'GET /api/notes': () => db.notes,
  'POST /api/notes': (b) => { 
    const note = { at: Date.now(), time: new Date().toLocaleTimeString(), text: String(b.text || '').slice(0, 2000) };
    db.notes.unshift(note);
    telemetryState.notes.unshift(note);
    save(); 
    return { ok: true }; 
  },
};

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

/* ---------- HTTP Server with Route Dispatching ---------- */
http.createServer((req, res) => {
  // Enable CORS headers so requests from any port or local client work cleanly
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = req.url.split('?')[0];

  // Route: / or /patient -> public/patient.html
  if (req.method === 'GET' && (url === '/' || url === '/patient')) {
    const patientFile = path.join(__dirname, 'public', 'patient.html');
    return fs.readFile(patientFile, (err, data) => {
      if (err) { res.writeHead(404); return res.end('patient.html not found in public/'); }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  }

  // Route: /doctor -> public/doctor.html
  if (req.method === 'GET' && url === '/doctor') {
    const doctorFile = path.join(__dirname, 'public', 'doctor.html');
    return fs.readFile(doctorFile, (err, data) => {
      if (err) { res.writeHead(404); return res.end('doctor.html not found in public/'); }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  }

  // API Route Dispatcher
  const handler = routes[`${req.method} ${url}`];
  if (handler) {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (e) {}
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(handler(body)));
    });
    return;
  }

  if (url.startsWith('/api/')) {
    res.writeHead(404);
    return res.end('{"error":"not found"}');
  }

  // Static File Fallback (serves CSS, JS, images from public/)
  const file = path.join(__dirname, 'public', url);
  if (!file.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);
    return res.end();
  }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('File not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`\n=================================================`);
  console.log(`NeuroSync Server Running on port ${PORT}:`);
  console.log(`- Patient Mobile App:  http://localhost:${PORT}/patient`);
  console.log(`- Doctor Dashboard:    http://localhost:${PORT}/doctor`);
  console.log(`=================================================\n`);
});