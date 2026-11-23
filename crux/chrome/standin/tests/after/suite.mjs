// A suite with an `after` hook that fails only when the run is whole.
export default {
  browser: false,
  after({ whole, parts }) {
    if (whole) throw new Error(`whole run checked ${parts} parts`);
  },
};
