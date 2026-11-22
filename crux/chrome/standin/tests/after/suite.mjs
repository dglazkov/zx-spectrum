// A suite with an `after` hook that fails only when the run is whole.
import { serve } from "../../serve.mjs";

export default {
  serve,
  browser: false,
  after({ whole, parts }) {
    if (whole) throw new Error(`whole run checked ${parts} parts`);
  },
};
