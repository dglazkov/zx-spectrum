// A suite held granular, its files said by the test: harness.test.mts runs it.
const { STANDIN_GRANULAR, STANDIN_SHARED, STANDIN_MOST } = process.env;

export default {
  browser: false,
  shared: STANDIN_SHARED ? [STANDIN_SHARED] : [],
  granular: { files: (STANDIN_GRANULAR ?? "").split(","), ...(STANDIN_MOST ? { most: Number(STANDIN_MOST) } : {}) },
};
