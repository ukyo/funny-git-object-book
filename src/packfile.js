const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const ObjectTypeEnum = {
  OBJ_COMMIT: 1,
  OBJ_TREE: 2,
  OBJ_BLOB: 3,
  OBJ_TAG: 4,
  OBJ_OFS_DELTA: 6,
  OBJ_REF_DELTA: 7,
};

const ObjectTypeStrings = {
  1: 'commit',
  2: 'tree',
  3: 'blob',
  4: 'tag',
};

function inflatePackedObject(fd, offset, size) {
  const buff = Buffer.alloc(Math.max(size * 2, 128));
  fs.read(fd, buff, 0, buff.length, offset);
  return zlib.inflateSync(buff);
}

function readDataSize(buff, offset) {
  let cmd;
  let size = 0;
  let x = 1;
  do {
    cmd = buff[offset++];
    size += (cmd & 0x7f) * x;
    x *= 128;
  } while (cmd & 0x80);
  return [size, offset];
}

function patchDelta(src, delta) {
  let deltaOffset;
  let srcSize;
  let dstSize;
  [srcSize, deltaOffset] = readDataSize(delta, 0);
  [dstSize, deltaOffset] = readDataSize(delta, deltaOffset);
  let dstOffset = 0;
  let cmd;
  const dst = Buffer.alloc(dstSize);
  while (deltaOffset < delta.length) {
    cmd = delta[deltaOffset++];
    if (cmd & 0x80) {
      let offset = 0;
      let size = 0;
      if (cmd & 0x01) offset = delta[deltaOffset++];
      if (cmd & 0x02) offset |= (delta[deltaOffset++] << 8);
      if (cmd & 0x04) offset |= (delta[deltaOffset++] << 16);
      if (cmd & 0x08) offset |= (delta[deltaOffset++] << 24);
      if (cmd & 0x10) size = delta[deltaOffset++];
      if (cmd & 0x20) size |= (delta[deltaOffset++] << 8);
      if (cmd & 0x40) size |= (delta[deltaOffset++] << 16);
      if (size === 0) size = 0x10000;
      dst.set(src.slice(offset, offset + size), dstOffset);
      dstOffset += size;
      dstSize -= size;
    } else if (cmd) {
      if (cmd > dstSize) {
        break;
      }
      dst.set(delta.slice(deltaOffset, deltaOffset + cmd), dstOffset);
      dstOffset += cmd;
      deltaOffset += cmd;
      dstSize -= cmd;
    }
  }
  return dst;
}

module.exports.Packfile = class Packfile {
  constructor(gitDir) {
    this.packDir = path.join(gitDir, 'objects', 'pack');
    this.idxs = fs.readdirSync(this.packDir)
      .filter(name => /\.idx$/.test(name))
      .map(name => name.match(/(pack-[a-f\d]{40})\.idx/)[1])
      .map(name => this._parseIdx(name));
  }

  _parseIdx(name) {
    const buff = fs.readFileSync(path.join(this.packDir, `${name}.idx`));
    const idx = {
      objects: [],
      pack: `${name}.pack`
    };
    if (buff.readUInt32BE(0) === 0xff744f63) {
      const version = buff.readUInt32BE(4);
      let index = 8 + 255 * 4;
      const n = buff.readUInt32BE(index);
      index += 4;
      let off32 = index + n * 24;
      let off64 = off32 + n * 4;
      for (let i = 0; i < n; i++) {
        const sha1 = buff.slice(index, index += 20).toString('hex');
        let offset = buff.readUInt32BE(off32);
        off32 += 4;
        if (offset & 0x80000000) {
          offset = buff.readUInt32BE(off64) * 4294967296;
          offset += buff.readUInt32BE(off64 += 4);
          off64 += 4;
        }
        idx.objects.push({ sha1, offset });
      }
    } else {
      let index = 255 * 4;
      const n = buff.readUInt32BE(index);
      index += 4;
      for (let i = 0; i < n; i++) {
        const offset = buff.readUInt32BE(index);
        const sha1 = buff.slice(index += 4, index += 20).toString('hex');
        idx.objects.push({ sha1, offset });
      }
    }
    return idx;
  }

  _findByOffset(fd, offset) {
    const head = Buffer.alloc(32);
    fs.readSync(fd, head, 0, head.length, offset);
    let c = head[0];
    const type = (c & 0x7f) >> 4;
    let size = c & 15;
    let x = 16;
    let i = 1;
    while (c & 0x80) {
      c = head[i++];
      size += (c & 0x7f) * x;
      x *= 128; // x << 7
    }
    switch (type) {
      case ObjectTypeEnum.OBJ_COMMIT:
      case ObjectTypeEnum.OBJ_TREE:
      case ObjectTypeEnum.OBJ_BLOB:
      case ObjectTypeEnum.OBJ_TAG:
        return { type, size, buff: inflatePackedObject(fd, offset + i, size) };
      case ObjectTypeEnum.OBJ_OFS_DELTA:
      case ObjectTypeEnum.OBJ_REF_DELTA:
        return this._resolveDelta(fd, offset, type, size, head, i);
    }
  }

  _binarySearch(objects, sha1) {
    let x = 0, y = objects.length - 1;
    while (x <= y) {
      const c = x + ((y - x) >> 1);
      const v = objects[c];
      if (v.sha1.startsWith(sha1)) return v;
      if (v.sha1 > sha1) {
        y = c - 1;
      } else {
        x = c + 1;
      }
    }
  }

  _findBySha1(sha1) {
    let pack;
    let offset;
    for (let i = 0; i < this.idxs.length; i++) {
      const idx = this.idxs[i];
      const v = this._binarySearch(idx.objects, sha1);
      if (v) {
        pack = idx.pack;
        offset = v.offset;
        break;
      }
    }
    if (!pack) return;
    const packFilePath = path.join(this.packDir, pack);
    const fd = fs.openSync(packFilePath, 'r');
    const result = this._findByOffset(fd, offset);
    fs.closeSync(fd);
    return result;
  }

  find(sha1) {
    const o = this._findBySha1(sha1);
    if (!o) return;
    return Buffer.concat([new Buffer(`${ObjectTypeStrings[o.type]} ${o.size}\x00`), o.buff]);
  }

  _resolveDelta(fd, offset, type, size, head, i) {
    let src;
    if (type === ObjectTypeEnum.OBJ_OFS_DELTA) {
      let c = head[i++];
      let ofs = c & 7;
      while (c & 0x80) {
        ofs++;
        c = head[i++];
        ofs = ofs * 128 + (c & 0x7f);
      }
      const baseOffset = offset - ofs;
      src = this._findByOffset(fd, baseOffset);
    } else {
      const sha1 = head.slice(i, i += 20).toString('hex');
      src = this._findBySha1(sha1);
    }
    const delta = inflatePackedObject(fd, offset + i, size);
    const buff = patchDelta(src.buff, delta);
    return { type: src.type, size: buff.length, buff };
  }
}