import { serve } from "../../serve.mjs";

export default { serve, limit: 1, open: (page, base) => page.goto(base) };
