// Shared presentation-path resolver for the deck tooling (tts / record /
// align / scrub / snap / comp). Each presentation is self-contained:
//
//   docs/harness-presentations/<slug>/
//       <slug>.html            the deck
//       narration/NNN-id.txt   one narration file per slide (+ .words.json)
//
// while the tools and brand assets stay shared one level up:
//
//   docs/harness-presentations/tools/          (these scripts)
//   docs/harness-presentations/nucleus-assets/ (fonts, referenced ../ from a deck)
//
// Rendered clips (gitignored) go to scratch/ml-video/<slug>/.
//
// A tool picks its target presentation in this order:
//   1. --pres <slug>   explicit
//   2. --deck <path>   slug = the deck's parent folder name
//   3. auto-detect     the only presentation subfolder, when exactly one exists
// Auto-detect deliberately FAILS when more than one presentation is present, so
// a second deck can never be built into the wrong one by accident — once you
// add another presentation, every command needs --pres <slug>.

const fs = require('fs');
const path = require('path');

const PRES_ROOT = path.join(__dirname, '..');           // docs/harness-presentations
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const NON_PRES = new Set(['tools', 'nucleus-assets']);

const hasHtml = (dir) => fs.readdirSync(dir).some((f) => f.endsWith('.html'));

// Every subfolder (other than the shared ones) that contains a deck .html.
function listPres() {
  return fs.readdirSync(PRES_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !NON_PRES.has(d.name))
    .map((d) => d.name)
    .filter((name) => hasHtml(path.join(PRES_ROOT, name)))
    .sort();
}

// Prefer <slug>.html; otherwise the only / first .html in the folder.
function findDeck(presDir, slug) {
  const htmls = fs.readdirSync(presDir).filter((f) => f.endsWith('.html')).sort();
  if (!htmls.length) throw new Error(`no .html deck in ${presDir}`);
  const pick = htmls.includes(`${slug}.html`) ? `${slug}.html` : htmls[0];
  return path.join(presDir, pick);
}

// opts: { pres, deck, out } — any may be undefined.
// Returns { slug, presDir, deck, narrDir, outDir, PRES_ROOT, REPO_ROOT }.
function resolvePres(opts = {}) {
  let slug = opts.pres || null;
  if (!slug && opts.deck) slug = path.basename(path.dirname(path.resolve(opts.deck)));
  if (!slug) {
    const all = listPres();
    if (all.length === 1) slug = all[0];
    else if (!all.length) throw new Error(`no presentations under ${PRES_ROOT}`);
    else throw new Error(`multiple presentations (${all.join(', ')}); pass --pres <slug>`);
  }
  const presDir = path.join(PRES_ROOT, slug);
  if (!fs.existsSync(presDir)) throw new Error(`no presentation "${slug}" at ${presDir}`);
  const deck = opts.deck ? path.resolve(opts.deck) : findDeck(presDir, slug);
  const narrDir = path.join(presDir, 'narration');
  const outDir = opts.out ? path.resolve(opts.out)
    : path.join(REPO_ROOT, 'scratch', 'ml-video', slug);
  return { slug, presDir, deck, narrDir, outDir, PRES_ROOT, REPO_ROOT };
}

module.exports = { resolvePres, listPres, findDeck, PRES_ROOT, REPO_ROOT };
