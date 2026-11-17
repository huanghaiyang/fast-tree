import { buildTree } from "../src/core/treeBuilder.js";
import { buildBarkSkin } from "../src/core/barkSkin.js";
import { normalizeParams, defaultParams } from "../src/core/params.js";
import { applyPreset } from "../src/core/presets.js";
for (const id of ["oak","pine","birch","willow","sakura","banyan","bamboo","dead"]) {
  const p = normalizeParams(applyPreset(defaultParams(), id, "mature", "summer"));
  p.seed = 20240607;
  p.leaves.enabled = false;
  if (p.fruit) p.fruit.enabled = false;
  const r = buildTree(p, { validate: false });
  const sk = buildBarkSkin(r.skeleton, { validate: true, debug: true });
  const st = sk.stats;
  console.log(id, "branches=" + r.skeleton.branches.length, "bridge=" + st.bridgeStrips, "failed=" + (st.failedWindows ?? "?"), "valid=" + (sk.validation ? sk.validation.ok : "null"));
}

