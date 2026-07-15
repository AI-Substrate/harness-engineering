export default {
  kind: 'extension',
  name: 'unknown-field',
  summary: 'Carries a tolerated nested field',
  verbs: {
    inspect: {
      summary: 'Inspect',
      futureField: { enabled: true },
      run: (ctx) => ctx.ok({ inspected: true }),
    },
  },
};
