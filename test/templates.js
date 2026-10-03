import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Evaluate only our checked-in object literal, never uploaded project code.
export function loadTemplates() {
  const html = fs.readFileSync(fileURLToPath(new URL('../playground/index.html', import.meta.url)), 'utf8');
  const match = html.match(/const TEMPLATES = ({[\s\S]*?^    };)/m);
  if (!match) throw new Error('Could not find TEMPLATES in playground/index.html');
  return new Function(`return ${match[1]};`)();
}
