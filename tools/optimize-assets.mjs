import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, flatten, join, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

// Runtime assets target small mobile downloads and a 1024px texture ceiling.
// The full-resolution source GLBs, Blender projects and PNG previews remain in art/.
const root = path.resolve(import.meta.dirname, '..');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const outDir = path.join(root, 'public/assets/models');
const previewDir = path.join(root, 'public/previews');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(previewDir, { recursive: true });
const textureInfo = (doc) => doc.getRoot().listTextures().map((t) => ({
  name: t.getName(), resolution: t.getSize(), mime: t.getMimeType(), bytes: t.getImage()?.byteLength ?? 0,
}));
const geometryInfo = (doc) => {
  let triangles = 0, vertices = 0, primitives = 0;
  for (const node of doc.getRoot().listNodes()) {
    if (!node.getMesh()) continue;
    for (const p of node.getMesh().listPrimitives()) {
      primitives++;
      vertices += p.getAttribute('POSITION')?.getCount() ?? 0;
      if (p.getMode() === 4) triangles += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3;
    }
  }
  return { triangles, vertices, primitives };
};
const records = JSON.parse(fs.readFileSync(path.join(root, 'art/asset-manifest.json'), 'utf8'));
const report = [];
for (const item of records) {
  const output = path.join(outDir, item.id + '.glb');
  const doc = await io.read(item.glb);
  const sourceTextures = textureInfo(doc);
  const sourceGeometry = geometryInfo(doc);
  await doc.transform(dedup(), prune(), weld());
  if (!item.id.startsWith('operator-')) await doc.transform(flatten(), join(), weld(), prune());
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], slots: /^(baseColorTexture|emissiveTexture)$/, quality: 94, effort: 65 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], slots: /^(normalTexture|metallicRoughnessTexture|occlusionTexture)$/, lossless: true, effort: 65 }),
    meshopt({ encoder: MeshoptEncoder, level: 'high', quantizePosition: 16, quantizeTexcoord: 14 }),
  );
  await io.write(output, doc);
  // Decode the emitted file as a structural check, including the required Meshopt extension.
  const check = await io.read(output);
  const geometry = geometryInfo(check);
  if (geometry.triangles !== sourceGeometry.triangles) throw new Error(`${item.id}: triangle count changed unexpectedly`);
  if (check.getRoot().listAnimations().length !== doc.getRoot().listAnimations().length) throw new Error(`${item.id}: lost animation`);
  const textures = textureInfo(check);
  const estimatedTextureBytesRGBAWithMips = Math.ceil(textures.reduce((n, t) => n + (t.resolution?.[0] ?? 0) * (t.resolution?.[1] ?? 0) * 4 * 4 / 3, 0));
  const bytes = fs.statSync(output).size, stagedBytes = fs.statSync(item.glb).size;
  const previewSuffixes = item.id.startsWith('operator-') ? ['full', 'detail'] : ['overview', 'detail'];
  const previews = {};
  for (const suffix of previewSuffixes) {
    const src = path.join(root, 'art/previews', `${item.id}-${suffix}.png`);
    const dst = path.join(previewDir, `${item.id}-${suffix}.webp`);
    await sharp(src).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 90, effort: 5 }).toFile(dst);
    previews[suffix] = `/previews/${item.id}-${suffix}.webp`;
  }
  const record = {
    ...item, url: `/assets/models/${item.id}.glb`, bytes, stagedBytes,
    compressionRatio: +(stagedBytes / bytes).toFixed(3), sourceTextures, textures,
    sourceGeometry, ...geometry, materials: check.getRoot().listMaterials().length,
    animations: check.getRoot().listAnimations().map((a) => a.getName()),
    estimatedTextureBytesRGBAWithMips, maxTextureSize: 1024, previews,
    extensionsRequired: check.getRoot().listExtensionsRequired().map((e) => e.extensionName),
  };
  report.push(record);
  console.log(JSON.stringify({ id: item.id, ...geometry, beforeMiB: +(stagedBytes / 1048576).toFixed(3), afterMiB: +(bytes / 1048576).toFixed(3), textureMiBWithMips: +(estimatedTextureBytesRGBAWithMips / 1048576).toFixed(2), materials: record.materials }));
}
fs.writeFileSync(path.join(root, 'public/assets/model-manifest.json'), JSON.stringify(report, null, 2));
// Exact matching Three.js and addon versions, served locally.
const vendor = path.join(root, 'public/vendor');
fs.mkdirSync(vendor, { recursive: true });
fs.cpSync(path.join(root, 'node_modules/three/build'), path.join(vendor, 'three'), { recursive: true });
fs.cpSync(path.join(root, 'node_modules/three/examples/jsm'), path.join(vendor, 'addons'), { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/three/LICENSE'), path.join(vendor, 'THREE-LICENSE.txt'));
console.log('Optimized assets, readback checks, web previews and matching Three modules prepared.');
