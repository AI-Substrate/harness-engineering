/**
 * Failure class E424 `DD_ADAPTER_LOAD_FAILED`, wrong-signature half: the module
 * imports cleanly but its default export is not a callable `(value, ctx) => string`,
 * so nothing loadable was ever obtained.
 */
export default { render: 'I am an object, not a function' };
