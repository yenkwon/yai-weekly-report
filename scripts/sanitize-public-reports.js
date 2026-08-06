import fs from 'node:fs';
import path from 'node:path';

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['./docs'];
let changed = 0;

for (const root of roots) {
  for (const file of htmlFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    const match = source.match(/const DATA\s*=\s*(\{[^\n]*\});\r?\nconst KO=/);
    if (!match) continue;
    const data = JSON.parse(match[1]);
    const safe = sanitize(data);
    const replacement = `const DATA = ${JSON.stringify(safe)};\nconst KO=`;
    const output = source.replace(match[0], replacement);
    if (output !== source) {
      fs.writeFileSync(file, output);
      changed += 1;
    }
  }
}

console.log(`sanitized ${changed} public report(s)`);

function sanitize(report) {
  delete report.selfReports;
  delete report.eventHistory;
  delete report.spotlight;
  delete report.special;
  if (report.subjective?.gap) {
    delete report.subjective.gap.note;
    delete report.subjective.gap.distance;
  }
  return report;
}

function htmlFiles(root) {
  if (!fs.existsSync(root)) return [];
  const stat = fs.statSync(root);
  if (stat.isFile()) return root.endsWith('.html') ? [root] : [];
  return fs.readdirSync(root, { withFileTypes:true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? htmlFiles(full) : entry.name.endsWith('.html') ? [full] : [];
  });
}
