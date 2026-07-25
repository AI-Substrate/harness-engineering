import { describe, expect, it } from 'vitest';
import type { TokenEvidence } from '../../../src/services/telemetry/token-evidence.js';
import {
  mergeTokenEvidence,
  reduceUsageObservations,
  tokenEvidenceFromLegacyTokens,
  tokenEvidenceFromObservation,
} from '../../../src/services/telemetry/usage-observation.js';

describe('P063 findings 03/04 — kind precedence must not discard measured data', () => {
  it('flags the tail when messages continue after the selected checkpoint', () => {
    // Finding 03 (HIGH): a copilot session that checkpoints, keeps working, then is
    // killed without a graceful shutdown — the fleet-teardown pattern. The reducer
    // returned the checkpoint verbatim and the 999-token tail vanished, still
    // labelled `measured`. We do not ADD unlike kinds; we stop calling it complete.
    const reduced = reduceUsageObservations([
      {
        t: '2026-07-23T10:00:00Z',
        observation_kind: 'cumulative_checkpoint',
        input: 10,
        output: 20,
        cache_read: 30,
        cache_create: 40,
      },
      { t: '2026-07-23T10:30:00Z', observation_kind: 'message_output', output: 999 },
    ]);

    expect(reduced?.input).toBe(10); // still the checkpoint's numbers, not a sum
    const evidence = tokenEvidenceFromObservation(reduced, 'live');
    expect(evidence.coverage).toBe('partial');
    expect(evidence.reason).toBe('post_checkpoint_tail');
  });

  it('does not flag a tail when the messages precede the checkpoint', () => {
    const reduced = reduceUsageObservations([
      { t: '2026-07-23T09:00:00Z', observation_kind: 'message_output', output: 5 },
      {
        t: '2026-07-23T10:00:00Z',
        observation_kind: 'cumulative_checkpoint',
        input: 10,
        output: 20,
        cache_read: 30,
        cache_create: 40,
      },
    ]);
    expect(tokenEvidenceFromObservation(reduced, 'live').coverage).toBe('measured');
  });

  it('keeps a fuller checkpoint alive under a sparse final, per field', () => {
    // Finding 04 (HIGH): a nano-AIU-only `final_shutdown` reduced to itself and the
    // checkpoint's four measured buckets came back `unavailable` — a false unavailable
    // is a collection failure too. Compose per field; never add unlike kinds.
    const reduced = reduceUsageObservations([
      {
        t: '2026-07-23T10:00:00Z',
        observation_kind: 'cumulative_checkpoint',
        input: 10,
        output: 20,
        cache_read: 30,
        cache_create: 40,
      },
      { t: '2026-07-23T11:00:00Z', observation_kind: 'final_shutdown', nano_aiu: 5 },
    ]);

    expect(reduced).toMatchObject({ input: 10, output: 20, cache_read: 30, cache_create: 40 });
    expect(reduced?.nano_aiu).toBe(5); // the final still owns the bucket it carries

    const evidence = tokenEvidenceFromObservation(reduced, 'live');
    expect(evidence.fields.input).toMatchObject({
      value: 10,
      coverage: 'measured',
      observation_kind: 'cumulative_checkpoint',
    });
    expect(evidence.fields.nano_aiu).toMatchObject({
      value: 5,
      observation_kind: 'final_shutdown',
    });
    // Composed from unlike kinds → honest about it rather than claiming `measured`.
    expect(evidence.coverage).toBe('partial');
    expect(evidence.reason).toBe('mixed_observation_kinds');
  });

  it('still reports a complete single-kind final as measured', () => {
    const reduced = reduceUsageObservations([
      {
        t: '2026-07-23T11:00:00Z',
        observation_kind: 'final_shutdown',
        input: 1,
        output: 2,
        cache_read: 3,
        cache_create: 4,
      },
    ]);
    expect(tokenEvidenceFromObservation(reduced, 'live')).toMatchObject({
      coverage: 'measured',
      reason: null,
    });
  });
});

describe('P063 Phase 2 — per-field token evidence', () => {
  it('classifies incomplete typed evidence as partial without zero-filling absent fields', () => {
    const evidence = tokenEvidenceFromObservation(
      {
        t: '2026-07-23T00:00:00Z',
        observation_kind: 'final_shutdown',
        output: 22,
      },
      'live',
    );

    expect(evidence).toMatchObject({
      coverage: 'partial',
      reason: 'partial_observation',
      cause: 'unknown',
      source: 'live',
      fields: {
        input: { value: null, coverage: 'unavailable', reason: 'field_absent' },
        output: { value: 22, coverage: 'measured', source: 'live' },
      },
    });
  });

  it('lets measured vendor evidence outrank an empty ref and merges complementary fields', () => {
    const ref = tokenEvidenceFromObservation(null, 'ref');
    const ledger = tokenEvidenceFromObservation(
      {
        t: '2026-07-23T00:00:01Z',
        observation_kind: 'final_shutdown',
        input: 10,
        output: 20,
      },
      'ledger',
    );
    const live = tokenEvidenceFromObservation(
      {
        t: '2026-07-23T00:00:02Z',
        observation_kind: 'cumulative_checkpoint',
        cache_read: 30,
        cache_create: 40,
      },
      'live',
    );

    expect(mergeTokenEvidence([ref, ledger, live])).toMatchObject({
      coverage: 'measured',
      source: 'live',
      fields: {
        input: { value: 10, source: 'ledger' },
        output: { value: 20, source: 'ledger' },
        cache_read: { value: 30, source: 'live' },
        cache_create: { value: 40, source: 'live' },
      },
    });
  });

  it('keeps partial compaction aggregate coverage partial even with every bucket', () => {
    expect(
      tokenEvidenceFromObservation(
        {
          t: '2026-07-23T00:00:00Z',
          observation_kind: 'partial_compaction',
          input: 1,
          output: 2,
          cache_read: 3,
          cache_create: 4,
        },
        'live',
      ),
    ).toMatchObject({ coverage: 'partial', reason: 'partial_observation' });
  });
  it('lets an authoritative ledger final outrank a live message-only observation on every field', () => {
    // Finding 1 (CRITICAL): the normal copilot fleet shape. Live capture windows never
    // contain the shutdown event (capture runs on harness commands; the shutdown is
    // written after the last one), so the live candidate is structurally message-kind
    // while the ledger holds the authoritative final. Ranking source above kind produced
    // a Frankenstein lane: ledger input/cache with a live output undercount, labelled
    // `measured` with no reason.
    const live = tokenEvidenceFromObservation(
      { t: '2026-07-23T10:30:00Z', observation_kind: 'message_output', output: 100 },
      'live',
    );
    const ledger = tokenEvidenceFromObservation(
      {
        t: '2026-07-23T11:00:00Z',
        observation_kind: 'final_shutdown',
        input: 1000,
        output: 500,
        cache_read: 2000,
        cache_create: 300,
      },
      'ledger',
    );

    const merged = mergeTokenEvidence([live, ledger]);

    expect(merged.coverage).toBe('measured');
    expect(merged.fields).toMatchObject({
      input: { value: 1000, source: 'ledger', observation_kind: 'final_shutdown' },
      output: { value: 500, source: 'ledger', observation_kind: 'final_shutdown' },
      cache_read: { value: 2000, source: 'ledger', observation_kind: 'final_shutdown' },
      cache_create: { value: 300, source: 'ledger', observation_kind: 'final_shutdown' },
    });
    // The whole point: no field may come from the live message-kind candidate.
    for (const key of ['input', 'output', 'cache_read', 'cache_create'] as const) {
      expect(merged.fields[key].observation_kind).not.toBe('message_output');
    }
  });

  it('lets an authoritative ledger final outrank a live wire cumulative checkpoint', () => {
    // R2-01 (HIGH): the surviving corner of finding 01. A live capture window can
    // contain a REAL `session.usage_checkpoint` (copilot maps it to
    // `cumulative_checkpoint`), and while both kinds shared one scope the source axis
    // handed the lane to the stale live checkpoint — everything between it and the
    // graceful shutdown vanished, still labelled `measured`. A vendor final speaks for
    // the WHOLE session; a wire checkpoint speaks only for the session so far.
    const liveCheckpoint = tokenEvidenceFromObservation(
      {
        t: '2026-07-23T10:00:00Z',
        observation_kind: 'cumulative_checkpoint',
        input: 10,
        output: 20,
        cache_read: 30,
        cache_create: 40,
      },
      'live',
    );
    const ledgerFinal = tokenEvidenceFromObservation(
      {
        t: '2026-07-23T11:00:00Z',
        observation_kind: 'final_shutdown',
        input: 1000,
        output: 500,
        cache_read: 2000,
        cache_create: 300,
      },
      'ledger',
    );

    const merged = mergeTokenEvidence([liveCheckpoint, ledgerFinal]);

    expect(merged.fields).toMatchObject({
      input: { value: 1000, source: 'ledger', observation_kind: 'final_shutdown' },
      output: { value: 500, source: 'ledger', observation_kind: 'final_shutdown' },
      cache_read: { value: 2000, source: 'ledger', observation_kind: 'final_shutdown' },
      cache_create: { value: 300, source: 'ledger', observation_kind: 'final_shutdown' },
    });
    // Order must not decide an authority question.
    expect(mergeTokenEvidence([ledgerFinal, liveCheckpoint])).toEqual(merged);
  });

  it('never lets a live BUFFER sum claim whole-session authority over a vendor final', () => {
    // R2-01, the other half: the legacy fallback sums the lane's captured windows.
    // Capture runs on harness commands and the shutdown is written after the last one,
    // so that sum structurally cannot contain the tail — it is NOT whole-session by
    // construction and must not be stamped as if it were.
    const liveBufferSum = tokenEvidenceFromLegacyTokens(
      { input: 10, output: 20, cache_read: 30, cache_create: 40 },
      'live',
    );
    const ledgerFinal = tokenEvidenceFromObservation(
      {
        t: '2026-07-23T11:00:00Z',
        observation_kind: 'final_shutdown',
        input: 1000,
        output: 500,
        cache_read: 2000,
        cache_create: 300,
      },
      'ledger',
    );

    expect(mergeTokenEvidence([liveBufferSum, ledgerFinal]).fields.input).toMatchObject({
      value: 1000,
      source: 'ledger',
    });
  });

  it('keeps source as the tiebreak only among equal observation SCOPES', () => {
    const liveCheckpoint = tokenEvidenceFromObservation(
      { t: '2026-07-23T00:00:02Z', observation_kind: 'cumulative_checkpoint', output: 7 },
      'live',
    );
    const ledgerCheckpoint = tokenEvidenceFromObservation(
      { t: '2026-07-23T00:00:01Z', observation_kind: 'cumulative_checkpoint', output: 9 },
      'ledger',
    );

    expect(mergeTokenEvidence([ledgerCheckpoint, liveCheckpoint]).fields.output).toMatchObject({
      value: 7,
      source: 'live',
    });
  });

  it('keeps the compatibility source deterministic when measured ref and ledger overlap', () => {
    // Plan 052 AC-06: a committed ref rollup outranks the vendor ledger. The ref lane
    // reaches the merge through `tokenEvidenceFromLegacyTokens` — a rolled ref holds the
    // WHOLE session in one tree, so it is whole-session BY CONSTRUCTION and ties the
    // vendor final on scope, leaving source (plan 052) to decide. R2-01: this must stay
    // true after real wire checkpoints are demoted below a final.
    const ref = tokenEvidenceFromLegacyTokens(
      { input: 1, output: 2, cache_read: 3, cache_create: 4 },
      'ref',
      { wholeSession: true },
    );
    const ledger = tokenEvidenceFromObservation(
      {
        t: '2026-07-23T00:00:01Z',
        observation_kind: 'final_shutdown',
        input: 10,
        output: 20,
        cache_read: 30,
        cache_create: 40,
      },
      'ledger',
    );

    expect(ref.fields.output.observation_kind).toBe('session_total');
    const merged = mergeTokenEvidence([ledger, ref]);
    expect(merged.source).toBe('ref');
    expect(merged.fields.output).toMatchObject({ value: 2, source: 'ref' });
    expect(mergeTokenEvidence([ref, ledger])).toEqual(merged);
  });

  it('still projects ref over ledger deterministically when the kinds are equal', () => {
    const observation = {
      t: '2026-07-23T00:00:00Z',
      observation_kind: 'cumulative_checkpoint' as const,
      input: 1,
      output: 2,
      cache_read: 3,
      cache_create: 4,
    };
    const ref = tokenEvidenceFromObservation(observation, 'ref');
    const ledger = tokenEvidenceFromObservation({ ...observation, output: 20 }, 'ledger');

    const merged = mergeTokenEvidence([ledger, ref]);
    expect(merged.source).toBe('ref');
    expect(merged.fields.output).toMatchObject({ value: 2, source: 'ref' });
    expect(mergeTokenEvidence([ref, ledger])).toEqual(merged);
  });
});

describe('R2-02 — a merge must never claim more coverage than the evidence it selected', () => {
  it('carries a contributing candidate’s post_checkpoint_tail through the merge', () => {
    // The killed-lane shape this repo documents: the ledger checkpointed, work
    // continued, the peer was killed without a graceful shutdown. That candidate says
    // `partial`/`post_checkpoint_tail` honestly — and the merge recomputed coverage from
    // field counts alone, so four measured fields laundered it back to measured/null and
    // the known-missing tail disappeared from every public surface.
    const ledger = tokenEvidenceFromObservation(
      reduceUsageObservations([
        {
          t: '2026-07-23T10:00:00Z',
          observation_kind: 'cumulative_checkpoint',
          input: 10,
          output: 20,
          cache_read: 30,
          cache_create: 40,
        },
        { t: '2026-07-23T10:30:00Z', observation_kind: 'message_output', output: 999 },
      ]),
      'ledger',
    );
    expect(ledger).toMatchObject({ coverage: 'partial', reason: 'post_checkpoint_tail' });

    const liveWindow = tokenEvidenceFromObservation(
      { t: '2026-07-23T10:31:00Z', observation_kind: 'message_output', output: 5 },
      'live',
    );

    const merged = mergeTokenEvidence([liveWindow, ledger]);

    // The ledger checkpoint supplied every winning field, so the merged verdict cannot
    // be stronger than the ledger's own.
    expect(merged.fields.input).toMatchObject({ value: 10, source: 'ledger' });
    expect(merged.coverage).toBe('partial');
    expect(merged.reason).toBe('post_checkpoint_tail');
  });

  it('carries flushed_segments_unreadable through the merge', () => {
    // Finding 02's honesty marking is applied to the live lane, then the lane is merged
    // with its ref/ledger candidates. Recomputing coverage from field counts erased it,
    // so a post-prune subset went back to reporting `measured` on the fleet surface.
    const pruned = tokenEvidenceFromLegacyTokens(
      { input: 10, output: 5, cache_read: 0, cache_create: 0 },
      'live',
    );
    pruned.coverage = 'partial';
    pruned.reason = 'flushed_segments_unreadable';

    const merged = mergeTokenEvidence([pruned]);

    expect(merged.coverage).toBe('partial');
    expect(merged.reason).toBe('flushed_segments_unreadable');
  });

  it('still reports measured when every contributing candidate is measured', () => {
    // The guard must not become a blanket degrade: a merge of honest, complete
    // candidates is still `measured`.
    const complete = {
      t: '2026-07-23T00:00:00Z',
      observation_kind: 'final_shutdown' as const,
      input: 1,
      output: 2,
      cache_read: 3,
      cache_create: 4,
    };
    const merged = mergeTokenEvidence([
      tokenEvidenceFromObservation(complete, 'ledger'),
      tokenEvidenceFromObservation(complete, 'ref'),
    ]);

    expect(merged.coverage).toBe('measured');
    expect(merged.reason).toBeNull();
  });

  it('repairs mere SPARSITY instead of propagating it', () => {
    // The boundary the rule turns on. Both candidates are `partial` — but only because
    // each lacks buckets, which is precisely what the other supplies. Propagating that
    // would degrade a genuinely complete four-bucket set, an under-claim in the opposite
    // direction. Only short VALUES survive a merge; absent buckets get filled.
    const sparseFinal = tokenEvidenceFromObservation(
      { t: '2026-07-23T00:00:01Z', observation_kind: 'final_shutdown', input: 10, output: 20 },
      'ledger',
    );
    const sparseLive = tokenEvidenceFromObservation(
      {
        t: '2026-07-23T00:00:02Z',
        observation_kind: 'cumulative_checkpoint',
        cache_read: 30,
        cache_create: 40,
      },
      'live',
    );
    expect(sparseFinal.reason).toBe('partial_observation');
    expect(sparseLive.reason).toBe('partial_observation');

    const merged = mergeTokenEvidence([sparseFinal, sparseLive]);
    expect(merged.coverage).toBe('measured');
    expect(merged.reason).toBeNull();

    // …but one substantive shortfall on either side still survives.
    const tailed = {
      ...sparseFinal,
      coverage: 'partial' as const,
      reason: 'post_checkpoint_tail' as const,
    };
    expect(mergeTokenEvidence([tailed, sparseLive])).toMatchObject({
      coverage: 'partial',
      reason: 'post_checkpoint_tail',
    });
  });

  it('ignores a partial candidate that contributed no winning field', () => {
    // Only the candidates the merge actually SELECTED FROM constrain the verdict — a
    // rejected partial candidate must not degrade an otherwise complete answer.
    const winner = tokenEvidenceFromObservation(
      {
        t: '2026-07-23T00:00:01Z',
        observation_kind: 'final_shutdown',
        input: 1,
        output: 2,
        cache_read: 3,
        cache_create: 4,
        nano_aiu: 9,
      },
      'ref',
    );
    const rejected = tokenEvidenceFromObservation(
      { t: '2026-07-23T00:00:00Z', observation_kind: 'partial_compaction', output: 77 },
      'ledger',
    );

    const merged = mergeTokenEvidence([rejected, winner]);

    expect(merged.fields.output).toMatchObject({ value: 2, source: 'ref' });
    expect(merged.coverage).toBe('measured');
    expect(merged.reason).toBeNull();
  });
});

describe('R3-02 — vendor_field_absent names an ABSENT BUCKET, so a filled bucket clears it', () => {
  /**
   * The codex ledger lane's exact shape (`fleet-evidence.ts` · finding 09): codex
   * reports input/cached/output/reasoning and has NO cache-write concept, so
   * `cache_create` is absent rather than zero and the lane says so by name.
   */
  function codexLedgerEvidence(): TokenEvidence {
    const evidence = tokenEvidenceFromObservation(
      {
        t: '1970-01-01T00:00:00.000Z',
        observation_kind: 'final_shutdown',
        input: 100,
        output: 200,
        cache_read: 300,
      },
      'ledger',
    );
    expect(evidence).toMatchObject({ coverage: 'partial', reason: 'partial_observation' });
    evidence.reason = 'vendor_field_absent';
    return evidence;
  }

  it('clears the reason once a second source supplies the vendor-absent bucket', () => {
    // The rule this classification is judged by: short VALUES survive a merge, absent
    // BUCKETS get filled. `vendor_field_absent` says the vendor has no CONCEPT of the
    // bucket — the values it did measure are not short of the session. Carrying it
    // regardless labelled a complete four-bucket set `partial`, the same false degrade
    // the substantive/structural split exists to prevent.
    const filler = tokenEvidenceFromObservation(
      { t: '2026-07-23T00:00:02Z', observation_kind: 'cumulative_checkpoint', cache_create: 7 },
      'live',
    );

    const merged = mergeTokenEvidence([codexLedgerEvidence(), filler]);

    for (const key of ['input', 'output', 'cache_read', 'cache_create'] as const) {
      expect(merged.fields[key].coverage).toBe('measured');
    }
    expect(merged.fields.cache_create).toMatchObject({ value: 7, source: 'live' });
    expect(merged.coverage).toBe('measured');
    expect(merged.reason).toBeNull();
  });

  it('KEEPS the reason while the vendor-absent bucket is still unfilled', () => {
    // The other direction, and the one that is reachable today: nothing fills
    // `cache_create`, so the merged answer is genuinely short a bucket and must say WHY
    // — `vendor_field_absent` is more diagnosable than a generic `partial_observation`,
    // and losing it would be a regression in the opposite direction.
    const sameVendor = tokenEvidenceFromObservation(
      {
        t: '1970-01-01T00:00:00.000Z',
        observation_kind: 'cumulative_checkpoint',
        input: 1,
        output: 2,
      },
      'live',
    );

    const merged = mergeTokenEvidence([codexLedgerEvidence(), sameVendor]);

    expect(merged.fields.cache_create.coverage).toBe('unavailable');
    expect(merged.coverage).toBe('partial');
    expect(merged.reason).toBe('vendor_field_absent');
  });
});
