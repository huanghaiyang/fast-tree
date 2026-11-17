import { buildTree } from "../src/core/treeBuilder.js";
import { buildBarkSkin } from "../src/core/barkSkin.js";
import { normalizeParams, defaultParams } from "../src/core/params.js";
import { applyPreset } from "../src/core/presets.js";
const TAU = Math.PI * 2;
for (const id of ["oak","banyan","pine","willow"]) {
  const p = normalizeParams(applyPreset(defaultParams(), id, "mature", "summer"));
  p.seed = 20240607; p.leaves.enabled = false; if (p.fruit) p.fruit.enabled = false;
  const r = buildTree(p, { validate: false });
  const sk = buildBarkSkin(r.skeleton, { validate: false, debug: true });
  const { plan, attachOf, skinFrames } = sk.debug;
  const pos = sk.geometry.attributes.position.array;
  const br = r.skeleton.branches;
  let narrowed = 0, total = 0, worst = 0, worstInfo = "";
  for (const [pi, pl] of plan) {
    const M = sk.ringM[pi];
    for (const w of pl.windows) {
      const att = attachOf.get(w.child); if (!att) continue;
      const pa = skinFrames[pi][w.band], pb = skinFrames[pi][w.band + 1];
      const A = sk.rings[pi][w.band], B = sk.rings[pi][w.band + 1];
      let rp = 0, n = 0;
      for (let k = 0; k < M; k++) {
        const va = A + k, vb = B + k;
        for (const v of [va, vb]) {
          const dx = pos[v*3]-pa.pos.x, dy = pos[v*3+1]-pa.pos.y, dz = pos[v*3+2]-pa.pos.z;
          const al = dx*pa.dir.x+dy*pa.dir.y+dz*pa.dir.z;
          rp += Math.hypot(dx-al*pa.dir.x, dy-al*pa.dir.y, dz-al*pa.dir.z); n++;
        }
      }
      rp /= Math.max(1, n);
      const ratio = Math.max(0.06, Math.min(0.92, att.childRadius / Math.max(1e-6, rp)));
      const idealK = Math.max(1, Math.ceil(M * (2*Math.asin(ratio)/TAU) - 1e-9));
      total++;
      if (w.K < idealK) { narrowed++; const f = (idealK-w.K)/idealK; if (f>worst){worst=f;worstInfo=`父#${pi}(L${br[pi].level}) 子#${w.child} M=${M} K=${w.K}/${idealK} rC=${att.childRadius.toFixed(3)} rP=${rp.toFixed(3)}`;} }
    }
  }
  console.log(id, `窗口=${total} 被收窄=${narrowed} (${(100*narrowed/total).toFixed(1)}%) 最严重=${(100*worst).toFixed(0)}% ${worstInfo}`);
}
