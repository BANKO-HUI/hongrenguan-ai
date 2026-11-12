import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
await sharp(path.join(root, 'build', 'icon-source.png'))
  .resize(1024, 1024)
  .png()
  .toFile(path.join(root, 'build', 'icon.png'));
console.log(path.join(root, 'build', 'icon.png'));
