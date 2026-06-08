// Loader smoke fixture: uses a TS enum (which plain type-stripping cannot handle)
// to prove the jiti path performs a FULL transpile, not just type erasure.
enum Color {
  Red = 'red',
  Blue = 'blue',
}

export default { name: 'enum-sample', color: Color.Red };
