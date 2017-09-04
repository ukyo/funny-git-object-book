const path = require('path');
const fs = require('fs');

const pathes = [
  '<refname>',
  'refs/<refname>',
  'refs/tags/<refname>',
  'refs/heads/<refname>',
  'refs/remotes/<refname>',
  'refs/remotes/<refname>/HEAD',
];

function parsePackedRefs(gitDir) {
  const refs = {};
  try {
    const lines = fs
      .readFileSync(path.join(gitDir, 'packed-refs'), 'utf8')
      .trim()
      .split('\n');
    lines.forEach(line => {
      const m = line.match(/^([\da-f]+) (.+)$/);
      if (!m) return;
      const [, sha1, refName] = m;
      refs[refName] = sha1;
    });
  } catch (e) {}
  return refs;
}

function resolveRef(gitDir, refName) {
  const packedRefs = parsePackedRefs(gitDir);
  for (let i = 0; i < pathes.length; i++) {
    const p = pathes[i].replace('<refname>', refName);
    try {
      const ref = fs.readFileSync(path.join(gitDir, p), 'utf8').trim();
      if (/^[\da-f]{40}$/.test(ref)) return ref;
      return resolveRef(gitDir, ref.match(/^ref: (.+)$/)[1]);
    } catch (e) {
      if (packedRefs[p]) return packedRefs[p];
    }
  }
  return refName;
};

module.exports.resolveRef = resolveRef;

