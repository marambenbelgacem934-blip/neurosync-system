const fs = require('fs');
const path = require('path');
const http = require('http');

const CSV_FILE = path.join(__dirname, 'algorithm_output.csv');

function loadCsvData() {
  const content = fs.readFileSync(CSV_FILE, 'utf8');
  const lines = content.trim().split('\n');
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    if (cols.length >= 6) {
      rows.push({
        datetime: cols[0],
        timestamp: parseFloat(cols[1]),
        freeze_index: parseFloat(cols[2]),
        state: cols[3],
        cue_active: cols[4].toLowerCase() === 'true',
        cadence_spm: parseInt(cols[5], 10)
      });
    }
  }
  return rows;
}

const telemetryStream = loadCsvData();
console.log(`Loaded ${telemetryStream.length} seconds of IMU kinematics from algorithm_output.csv`);

let cursor = 0;

function streamNextPacket() {
  const packet = telemetryStream[cursor];
  const payload = JSON.stringify(packet);

  const req = http.request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/telemetry',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  });

  req.on('error', () => {}); // Avoid crashing if server is launching
  req.write(payload);
  req.end();

  const stateIcon = packet.state === 'FOG_DETECTED' ? '🚨 FOG ACTIVE' : (packet.state === 'PRE_FREEZE' ? '⚠️ PRE-FREEZE' : '✅ NORMAL');
  console.log(`[T+${packet.timestamp}s] ${stateIcon} \vert{} FI:${packet.freeze_index.toFixed(3)} | Cadence: ${packet.cadence_spm} SPM \vert{} Cue:${packet.cue_active}`);

  cursor = (cursor + 1) % telemetryStream.length;
}

// Stream at 1 Hz real-time rate
setInterval(streamNextPacket, 1000);