/**
 * The `harness plan` scaffold, as pure data.
 *
 * Nothing here touches a filesystem, a clock or a process — the act supplies the
 * ports and this module answers the only question that is actually hard: what
 * does a well-formed plan look like as deterministic documents? That split is
 * what lets the answer be tested exhaustively without a temp directory.
 */

const HEX_DIGITS = 4;

/**
 * Minted ids are DERIVED, not random.
 *
 * Workshop-001 requires four lowercase hex digits, born once and unique per file.
 * A random mint would satisfy the letter of that and break something the scaffold
 * needs: running `plan new` twice with the same arguments must produce the same
 * bytes, or the scaffold could not be golden-tested and every re-scaffold would
 * look like a diff. Derivation from the seed gives born-once ids that are also
 * reproducible; uniqueness within the file is enforced by probing, below.
 *
 * This is not a content hash and does not need to be — the requirement is
 * "distinct within one document", not "collision-resistant across the world".
 */
function mint(prefix: string, seed: string, taken: Set<string>): string {
  for (let probe = 0; probe < 0x10000; probe += 1) {
    // FNV-1a over the seed plus the probe counter: small, dependency-free, and
    // deterministic across platforms and Node versions.
    let hash = 0x811c9dc5;
    for (const char of `${seed}#${probe}`) {
      hash ^= char.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const id = `${prefix}-${(hash & 0xffff).toString(16).padStart(HEX_DIGITS, '0')}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
  /* c8 ignore next 2 -- unreachable: 65536 probes over a 65536-value space */
  throw new Error(`could not mint a unique ${prefix} id`);
}

/** Lowercase, hyphen-joined — the same shape the repo's plan folders already use. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'phase'
  );
}

export interface PlanScaffoldInput {
  slug: string;
  title?: string;
  /** Phase titles, in order. */
  phases: readonly string[];
}

export interface ScaffoldedDocument {
  /** Path relative to the plan folder. */
  relativePath: string;
  json: string;
}

export interface PlanScaffold {
  plan: ScaffoldedDocument;
  taskFiles: ScaffoldedDocument[];
}

function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Build a plan's documents.
 *
 * The shape is workshop-002 Ruling 4's multi-phase split, always — even for a
 * single phase. A plan that starts as one file and grows into many is a
 * migration; a plan that starts split is just a plan. The overview carries meta,
 * goals, non-goals, acceptance criteria and phases; each phase's detail lives in
 * its own task file with the done_when section already present, so the first task
 * added has somewhere to put its proof instead of inventing a section.
 */
export function buildPlanScaffold(input: PlanScaffoldInput): PlanScaffold {
  const title = input.title ?? input.slug;
  const ids = new Set<string>();
  const phases = input.phases.map((phaseTitle, index) => ({
    id: mint('ph', `${input.slug}/phase/${index}`, ids),
    title: phaseTitle,
    slug: `phase-${index + 1}-${slugify(phaseTitle)}`,
  }));

  const plan = {
    dd: { schema: 'builder/plan' },
    sections: [
      {
        name: 'meta',
        value: {
          title,
          slug: input.slug,
          status: 'draft',
          summary: '',
        },
      },
      // `summary` is a REQUIRED first-class section, not the meta field of the
      // same name — a scaffold that omitted it would emit a plan that fails its
      // own `plan validate` on the first run.
      { name: 'summary', value: '' },
      { name: 'goals', value: [] as string[] },
      { name: 'non_goals', value: [] as string[] },
      { name: 'acceptance_criteria', value: [] as unknown[] },
      {
        name: 'phases',
        value: phases.map((phase, index) => ({
          id: phase.id,
          title: phase.title,
          brief: '',
          state: 'unchecked',
          ...(index > 0 && { depends_on: [phases[index - 1]?.id] }),
          tasks: `tasks/${phase.slug}/tasks.dd.json#tasks`,
        })),
      },
    ],
    // Deliberately empty: a ledger entry means "I transclude this and my view of
    // it must be current", and a basis is recorded when it is first VERIFIED, not
    // when a file is created. `dd link verify-basis --update` is what mints one.
    references: [] as unknown[],
  };

  const taskFiles = phases.map((phase) => ({
    relativePath: `tasks/${phase.slug}/tasks.dd.json`,
    json: stringify({
      dd: { schema: 'builder/plan' },
      sections: [
        {
          name: 'meta',
          value: { title: phase.title, slug: phase.slug, status: 'draft', summary: '' },
        },
        { name: 'summary', value: '' },
        { name: 'tasks', value: [] as unknown[] },
        // `done_when`, never `evidence`: the alias exists only for corpora that
        // predate the rename, and nothing new should be authored into it.
        { name: 'done_when', value: {} },
      ],
      references: [] as unknown[],
    }),
  }));

  return { plan: { relativePath: 'plan.dd.json', json: stringify(plan) }, taskFiles };
}
