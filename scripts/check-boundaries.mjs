import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

async function files(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : full;
  }))).flat();
}
const sourceFiles = (await files('src')).filter(file => /\.tsx?$/.test(file));
const violations = [];
for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8');
  const imports = [...source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)].map(match => match[1]);
  const domain = file.includes('/domain/');
  const application = file.includes('/application/');
  const client = /^\s*['"]use client['"]/m.test(source);
  const moduleName = file.match(/^src\/modules\/([^/]+)\//)?.[1];
  for (const specifier of imports) {
    const resolved = specifier.startsWith('.') ? path.normalize(path.join(path.dirname(file), specifier)) : specifier.replace(/^@\//, 'src/');
    if (domain && (!resolved.includes('/domain/') || !resolved.startsWith(`src/modules/${moduleName}/`))) violations.push(`${file}: domain import ${specifier}`);
    if (application && (resolved.includes('/infrastructure/') || resolved.startsWith('src/server/') || !resolved.startsWith('src/'))) violations.push(`${file}: application import ${specifier}`);
    if (client && (resolved.includes('/infrastructure/') || resolved.includes('/server/'))) violations.push(`${file}: client imported server code ${specifier}`);
    if (file.startsWith('src/app/') && resolved.includes('/infrastructure/')) violations.push(`${file}: app bypassed server composition ${specifier}`);
  }
  if (file.startsWith('src/modules/') && /process\.env/.test(source)) violations.push(`${file}: environment belongs in server composition`);
}
if (violations.length) { console.error(violations.join('\n')); process.exitCode = 1; }
else console.log(`Module boundary checks passed (${sourceFiles.length} files).`);
