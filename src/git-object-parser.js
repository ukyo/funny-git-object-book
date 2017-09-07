// 作成者情報をパース
function parseActor([name, email, time, tz]) {
  const [, hour, minute] = tz.match(/([+-]?\d{2})(\d{2})/);
  return {
    name,
    email: email.slice(1, -1),
    date: new Date(+time * 1000),
    timezoneOffset: (+hour * 60 + +minute) * 60 * 1000,
  };
}

function parseCommit(body) {
  const commit = {
    parents: [],
  };
  const lines = body.toString('utf8').split('\n');
  let i;
  for (i = 0; i < lines.length; i++) {
    if (!lines[i].length) break;
    const [type, ...rest] = lines[i].split(/\s/);
    switch (type) {
      case 'tree': commit.tree = rest[0]; break;
      case 'parent': commit.parents.push(rest[0]); break;
      case 'author':
      case 'committer': commit[type] = parseActor(rest); break;
    }
  }
  commit.message = lines.slice(i).join('\n').trim();
  return commit;
}

function parseTag(body) {
  const tag = {};
  const lines = body.toString('utf8').split('\n');
  let i;
  for (i = 0; i < lines.length; i++) {
    if (!lines[i].length) break;
    const [type, ...rest] = lines[i].split(/\s/);
    switch (type) {
      case 'object':
      case 'type':
      case 'tag': tag[type] = rest[0]; break;
      case 'tagger': tag[type] = parseActor(rest); break;
    }
  }
  tag.message = lines.slice(i).join('\n').trim();
  return tag;
}

function parseBlob(body) {
  return body.toString('utf8');
}

const treeChildrenTypes = {
  40: 'tree',
  100: 'blob',
  120: 'symlink',
  160: 'submodule',
};

function parseTree(body) {
  const children = [];
  let i = 0;
  while (i < body.length) {
    let j = i;
    while (body[j]) j++;
    const [, type, mode, name] = body.slice(i, j).toString('utf8').match(/(40|100|120|160)(\d{3}) (.+)/);
    children.push({
      type: treeChildrenTypes[type],
      mode,
      name,
      sha1: body.slice(j += 1, j += 20).toString('hex'),
    });
    i = j;
  }
  return children;
}

const parsers = {
  commit: parseCommit,
  tag: parseTag,
  blob: parseBlob,
  tree: parseTree,
};

module.exports.parse = function parse(buff) {
  // ヘッダーのパース
  let index = 0;
  while (buff[index]) index++;
  const [type, size] = buff.slice(0, index).toString('utf8').split(' ');
  // 本体のパース
  const body = parsers[type](buff.slice(index + 1));
  return { type, size, body };
}