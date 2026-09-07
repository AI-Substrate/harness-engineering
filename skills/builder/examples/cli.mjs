import { readFile, writeFile } from 'node:fs/promises';
import { createConvert } from './compose.mjs';
import { createParser } from './parser.mjs';
import { createRenderer } from './renderer.mjs';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Usage: node cli.mjs <source> <destination>');
const convert = createConvert({
  parse: createParser({ read: (path) => readFile(path, 'utf8') }),
  render: createRenderer({ write: (path, text) => writeFile(path, text, 'utf8') }),
});
console.log(JSON.stringify(await convert(source, destination)));
