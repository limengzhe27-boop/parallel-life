import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import {
  removePortraitBackground,
  PORTRAIT_MATTING_MODEL,
  PORTRAIT_MATTING_REVISION,
} from '../src/modules/media/infrastructure/portrait-matting.ts';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error(
    'Usage: node --experimental-strip-types scripts/verify-portrait-matting.mjs input-image output.png',
  );
  process.exitCode = 2;
} else {
  const started = performance.now(),
    rss = process.memoryUsage().rss,
    cpu = process.cpuUsage();
  const bytes = await removePortraitBackground(await readFile(input), AbortSignal.timeout(180000));
  const meta = await sharp(bytes).metadata(),
    stats = await sharp(bytes).stats();
  await writeFile(output, bytes, { flag: 'wx', mode: 0o600 });
  const used = process.cpuUsage(cpu);
  console.log(
    JSON.stringify(
      {
        model: PORTRAIT_MATTING_MODEL,
        revision: PORTRAIT_MATTING_REVISION,
        durationMs: Math.round(performance.now() - started),
        cpuMs: Math.round((used.user + used.system) / 1000),
        rssDeltaBytes: process.memoryUsage().rss - rss,
        width: meta.width,
        height: meta.height,
        hasAlpha: meta.hasAlpha,
        alphaMin: stats.channels[3]?.min,
        alphaMax: stats.channels[3]?.max,
      },
      null,
      2,
    ),
  );
}
