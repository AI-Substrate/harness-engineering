/** @type {import('@ai-substrate/engineering-harness/contract').ExtensionDefinition} */
const extension = {
  kind: 'extension',
  name: 'bare-literal',
  summary: 'Bare-literal api-2 fixture',
  verbs: {
    bare: {
      summary: 'Bare literal verb',
      run: (ctx) => ctx.ok({ form: 'bare-literal' }),
    },
  },
};

export default extension;
