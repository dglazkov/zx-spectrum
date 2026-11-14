import { serve } from "../../serve.mjs";

// As many side by side as the harness says when none is given: its four.
export default { serve, open: (page, base) => page.goto(base) };
