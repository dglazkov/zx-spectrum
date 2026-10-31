import { serve } from "../../../serve.mjs";

export default { serve, open: (page, base) => page.goto(base), shared: ["web/src/shared.ts"] };
