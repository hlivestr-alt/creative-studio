const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { extractFile } = require('@electron/asar');
const obsoleteProviderCompletionError = ['H3 execution has not finished in ComfyUI history', 'VRAM release was not requested.'].join('; ');

function verifyH3Package(projectDir, resourcesDir) {
  const source = readFileSync(join(projectDir, 'workflows/minimax-h3-api.json'));
  const packaged = readFileSync(join(resourcesDir, 'workflows/minimax-h3-api.json'));
  for (const [label, bytes] of [['source', source], ['packaged', packaged]]) {
    const workflow = JSON.parse(bytes.toString('utf8'));
    if (bytes.includes('H3_MAX_TOKENS') || 'max_tokens' in workflow['149'].inputs || 'max_output_tokens' in workflow['149'].inputs) {
      throw new Error(`${label} H3 workflow contains an obsolete output-token input`);
    }
  }
  if (!source.equals(packaged)) throw new Error('Source and packaged H3 workflows differ');
  const main = extractFile(join(resourcesDir, 'app.asar'), 'dist-electron/main.cjs').toString();
  if (/H3_MAX_TOKENS|\bmaxTokens\b/.test(main)) throw new Error('Packaged H3 injector/settings contain obsolete token controls');
  const oldErrorOccurrences = main.split(obsoleteProviderCompletionError).length - 1;
  if (oldErrorOccurrences !== 0) throw new Error('Packaged app contains the obsolete provider-level H3 completion guard');
  const hash = createHash('sha256').update(source).digest('hex');
  return { sourceSha256: hash, packagedSha256: createHash('sha256').update(packaged).digest('hex'), staleOccurrences: 0, oldErrorOccurrences };
}

module.exports = async (context) => {
  const result = verifyH3Package(context.packager.projectDir, join(context.appOutDir, 'resources'));
  console.log('Verified H3 production package:', JSON.stringify(result));
};
module.exports.verifyH3Package = verifyH3Package;

if (require.main === module) {
  console.log(JSON.stringify(verifyH3Package(resolve(__dirname, '..'), resolve(process.argv[2] || 'release/win-unpacked/resources')), null, 2));
}
