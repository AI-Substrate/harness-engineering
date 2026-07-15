export default {
  kind: 'extension',
  name: 'invalid-sensor',
  summary: 'Exercises E216 for an invalid api-2 sensor declaration',
  sensors: {
    broken: {
      summary: 'Missing its required run function',
    },
  },
};
