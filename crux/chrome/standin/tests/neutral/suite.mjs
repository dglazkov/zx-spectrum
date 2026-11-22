// A suite with no `start` or `neutral` of its own, where one group says them and another does not.
import { serve } from "../../serve.mjs";

export default {
  serve,
  open: (page, base) => page.goto(base),
};
