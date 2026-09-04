/**
 * Falla el build si faltan artefactos críticos en dist/.
 * Evita deploys en Railway con dist incompleto (MODULE_NOT_FOUND en runtime).
 */
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const required = [
  'main.js',
  'app.module.js',
  'app.controller.js',
  'app.service.js',
];

if (!fs.existsSync(dist)) {
  console.error(`[assert-dist] Missing directory: ${dist}`);
  process.exit(1);
}

const missing = required.filter((f) => !fs.existsSync(path.join(dist, f)));
if (missing.length) {
  console.error(`[assert-dist] Missing files in dist/: ${missing.join(', ')}`);
  try {
    console.error('[assert-dist] dist listing:');
    for (const name of fs.readdirSync(dist).sort()) {
      console.error(`  - ${name}`);
    }
  } catch {
    /* ignore */
  }
  process.exit(1);
}

console.log(`[assert-dist] OK (${required.join(', ')})`);
