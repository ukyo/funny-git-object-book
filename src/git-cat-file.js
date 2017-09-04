const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const { parse } = require('./git-object-parser');
const { Packfile } = require('./packfile');
const { resolveRef } = require('./ref');

// hashからGitオブジェクトのパスを作る
function getObjectPath(sha1) {
  return path.resolve(
    process.cwd(),
    '.git/objects',
    sha1.replace(/^(.{2})(.{38})$/, '$1/$2')
  );
}

const gitDir = path.resolve(process.cwd(), '.git');
const sha1 = resolveRef(gitDir, process.argv[2]);
const packfile = new Packfile(gitDir);
const buff = packfile.find(sha1);
if (buff) {
  console.log(parse(buff));
} else {
  const objectPath = getObjectPath(sha1);
  const buff = zlib.inflateSync(fs.readFileSync(objectPath));
  console.log(parse(buff));
}
