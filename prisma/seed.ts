/*
  Source of truth for seeding is prisma/seed.cjs.
  This wrapper keeps local tooling that references seed.ts aligned.
*/
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("./seed.cjs");
