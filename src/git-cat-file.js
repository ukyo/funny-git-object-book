const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const { parse } = require('./git-object-parser');
const { Packfile } = require('./packfile');
const { resolveRef } = require('./ref');

// sha1(短縮版含む)からGitオブジェクトのパスを探す
function findGitObjectPath(sha1) {
  if (!/^[\da-f]{4,40}$/.test(sha1)) return null;
  let [, dir, file] = sha1.match(/^([\da-f]{2})([\da-f]{2,})$/);
  const gitObjectsDir = path.resolve(process.cwd(), '.git/objects');
  if (fs.readdirSync(gitObjectsDir).indexOf(dir) === -1) return null;
  dir = path.join(gitObjectsDir, dir);
  file = fs.readdirSync(dir).find(s => s.startsWith(file));
  if (!file) return null;
  return path.join(dir, file);
}

const gitDir = path.resolve(process.cwd(), '.git');
const sha1 = resolveRef(gitDir, process.argv[2]);
const packfile = new Packfile(gitDir);
const buff = packfile.find(sha1);
if (buff) {
  console.log(parse(buff));
} else {
  const objectPath = findGitObjectPath(sha1);
  const buff = zlib.inflateSync(fs.readFileSync(objectPath));
  console.log(parse(buff));
}