import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Evaluate only our checked-in object literal, never uploaded project code.
export function loadTemplates() {
  const html = fs.readFileSync(
    fileURLToPath(new URL('../playground/index.html', import.meta.url)),
    'utf8',
  );
  const match = html.match(/const TEMPLATES = ({[\s\S]*?^    };)/m);
  if (!match)
    throw new Error('Could not find TEMPLATES in playground/index.html');
  return new Function(`return ${match[1]};`)();
}

// Titles and groups come from the same selector shown in the Playground.
export function loadTemplateCatalog() {
  const html = fs.readFileSync(
    new URL('../playground/index.html', import.meta.url),
    'utf8',
  );
  const templates = loadTemplates();
  const catalog = [];
  for (const group of html.matchAll(
    /<optgroup label="([^"]+)">([\s\S]*?)<\/optgroup>/g,
  )) {
    for (const option of group[2].matchAll(
      /<option value="([^"]+)">([^<]+)<\/option>/g,
    )) {
      if (!templates[option[1]])
        throw new Error(`Missing template: ${option[1]}`);
      catalog.push({
        id: option[1],
        title: option[2]
          .replaceAll('&lt;', '<')
          .replaceAll('&gt;', '>')
          .replaceAll('&amp;', '&'),
        category: group[1],
        ...templates[option[1]],
      });
    }
  }
  if (
    catalog.length !== Object.keys(templates).length ||
    new Set(catalog.map((t) => t.id)).size !== catalog.length
  )
    throw new Error('Playground selector and template catalog are out of sync');
  return catalog;
}
