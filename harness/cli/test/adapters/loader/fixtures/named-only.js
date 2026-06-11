// Loader edge fixture: a plain .js module with ONLY a named export and NO
// default — proves the native-import path returns the default export (undefined
// here), not the whole namespace object (F002).
export const verb = { name: 'named-only', summary: 's', run: () => ({ status: 'ok' }) };
