// 작은 QR 코드 생성기. 바이트 모드(UTF-8), 오류정정 M, 버전 1~10(최대 213바이트).
// 외부 라이브러리 없이 브라우저(window.QrCode)와 Node(module.exports) 양쪽에서 쓴다.
// 문자 안내용 QR 한 가지 용도만 지원하므로 모드·오류정정 등급·버전은 일부러 제한했다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QrCode = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 오류정정 M 등급: [블록당 오류정정 바이트 수, [[블록 수, 블록당 데이터 바이트 수], ...]]
  const BLOCKS = {
    1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]],
    6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]],
    10: [26, [[4, 43], [1, 44]]]
  };
  const ALIGNMENT = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42],
    9: [6, 26, 46], 10: [6, 28, 50]
  };
  const MAX_VERSION = 10;
  const encoder = new TextEncoder();

  function dataCapacity(version) {
    return BLOCKS[version][1].reduce((sum, [count, size]) => sum + count * size, 0);
  }
  // 바이트 모드 머리글: 모드 4비트 + 글자 수(버전 1~9는 8비트, 10은 16비트)
  function capacityBytes(version) {
    return Math.floor((dataCapacity(version) * 8 - 4 - (version < 10 ? 8 : 16)) / 8);
  }
  const MAX_BYTES = capacityBytes(MAX_VERSION);

  function byteLength(text) { return encoder.encode(text).length; }

  function tooLong() {
    const error = new Error('QR 코드에 넣기에는 문구가 너무 깁니다.');
    error.code = 'TOO_LONG';
    return error;
  }

  // ---- 갈루아 체(GF(256)) 리드솔로몬 ----
  function gfMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i -= 1) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i += 1) {
      for (let j = 0; j < degree; j += 1) {
        result[j] = gfMultiply(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMultiply(root, 2);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    const result = new Array(divisor.length).fill(0);
    data.forEach((byte) => {
      const factor = byte ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => { result[i] ^= gfMultiply(coef, factor); });
    });
    return result;
  }

  // ---- 데이터 → 코드워드 ----
  function buildDataCodewords(bytes, version) {
    const bits = [];
    const push = (value, length) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
    push(0b0100, 4);
    push(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach((byte) => push(byte, 8));
    const capacityBits = dataCapacity(version) * 8;
    push(0, Math.min(4, capacityBits - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    // 자리가 남으면 0 바이트 하나를 더 둔다. 사장님 폰에서 읽힘을 확인한 segno 시험 QR과 비트까지 같게 하려는 것이며,
    // 읽는 쪽은 종결 비트에서 멈추므로 결과에는 영향이 없다.
    if (bits.length < capacityBits) push(0, 8);
    for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);
    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
    }
    return codewords;
  }

  function interleave(dataCodewords, version) {
    const [ecLength, groups] = BLOCKS[version];
    const divisor = rsDivisor(ecLength);
    const blocks = [];
    let offset = 0;
    groups.forEach(([count, size]) => {
      for (let i = 0; i < count; i += 1) {
        const data = dataCodewords.slice(offset, offset + size);
        offset += size;
        blocks.push({ data, ec: rsRemainder(data, divisor) });
      }
    });
    const result = [];
    const longest = Math.max(...blocks.map((block) => block.data.length));
    for (let i = 0; i < longest; i += 1) blocks.forEach((block) => { if (i < block.data.length) result.push(block.data[i]); });
    for (let i = 0; i < ecLength; i += 1) blocks.forEach((block) => result.push(block.ec[i]));
    return result;
  }

  // ---- 칸 배치 ----
  function createGrid(version) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFunction = (x, y, dark) => { modules[y][x] = dark; isFunction[y][x] = true; };

    for (let i = 0; i < size; i += 1) { setFunction(6, i, i % 2 === 0); setFunction(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          const x = cx + dx; const y = cy + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) setFunction(x, y, distance !== 2 && distance !== 4);
        }
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const positions = ALIGNMENT[version];
    positions.forEach((px, i) => positions.forEach((py, j) => {
      const atFinder = (i === 0 && j === 0) || (i === 0 && j === positions.length - 1) || (i === positions.length - 1 && j === 0);
      if (atFinder) return;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) setFunction(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    // 형식·버전 정보 칸은 코드워드가 들어가지 않도록 예약만 하고 비워 둔다. 마스크 감점은 이 칸이 비어 있는 상태에서 계산하고
    // (segno와 같은 방식), 마스크가 정해진 뒤에 finishGrid로 채운다.
    const reserved = isFunction.map((row) => row.slice());
    drawFormat(modules, isFunction, size, 0);
    drawVersion(setFunction, size, version);
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (isFunction[y][x] && !reserved[y][x]) modules[y][x] = false;
    return { size, modules, isFunction, version };
  }

  function drawFormat(modules, isFunction, size, mask) {
    const set = (x, y, dark) => { modules[y][x] = dark; isFunction[y][x] = true; };
    const data = (0 << 3) | mask; // 오류정정 M의 형식 비트는 00
    let remainder = data;
    for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((data << 10) | remainder) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i += 1) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  }

  function finishGrid(grid, mask) {
    const { modules, isFunction, size, version } = grid;
    drawFormat(modules, isFunction, size, mask);
    drawVersion((x, y, dark) => { modules[y][x] = dark; isFunction[y][x] = true; }, size, version);
  }

  function drawVersion(setFunction, size, version) {
    if (version < 7) return;
    let remainder = version;
    for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (version << 12) | remainder;
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3); const b = Math.floor(i / 3);
      setFunction(a, b, dark); setFunction(b, a, dark);
    }
  }

  function placeCodewords(grid, codewords) {
    const { size, modules, isFunction } = grid;
    const totalBits = codewords.length * 8;
    let index = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < size; vertical += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vertical : vertical;
          if (!isFunction[y][x] && index < totalBits) {
            modules[y][x] = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) !== 0;
            index += 1;
          }
        }
      }
    }
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0,
    (x, y) => ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0
  ];

  function applyMask(grid, mask) {
    const { size, modules, isFunction } = grid;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (!isFunction[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
      }
    }
  }

  // ---- 마스크 선택용 감점 (QR 규격 N1~N4) ----
  function penalty(modules) {
    const size = modules.length;
    let score = 0;
    const lineScore = (get) => {
      let total = 0;
      for (let i = 0; i < size; i += 1) {
        let run = 1;
        for (let j = 1; j < size; j += 1) {
          if (get(i, j) === get(i, j - 1)) run += 1;
          else { if (run >= 5) total += run - 2; run = 1; }
        }
        if (run >= 5) total += run - 2;
      }
      return total;
    };
    score += lineScore((i, j) => modules[i][j]) + lineScore((i, j) => modules[j][i]);
    for (let y = 0; y < size - 1; y += 1) {
      for (let x = 0; x < size - 1; x += 1) {
        const v = modules[y][x];
        if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) score += 3;
      }
    }
    // N3: 어두운 1·밝은 1·어두운 3·밝은 1·어두운 1(1011101) 앞이나 뒤에 밝은 칸 4개가 오거나 줄 끝에 닿은 경우
    const core = [1, 0, 1, 1, 1, 0, 1];
    const countN3 = (line) => {
      let count = 0;
      let index = indexOfCore(line, 0);
      while (index !== -1) {
        let offset = index + 7;
        const before = line.slice(Math.max(index - 4, 0), index);
        const after = line.slice(offset, Math.min(offset + 4, size));
        if (index === 0 || index === size - 7 || !before.some(Boolean) || !after.some(Boolean)) count += 40;
        else offset = index + 4;
        index = indexOfCore(line, offset);
      }
      return count;
    };
    const indexOfCore = (line, from) => {
      for (let i = from; i + 7 <= line.length; i += 1) if (core.every((bit, k) => (line[i + k] ? 1 : 0) === bit)) return i;
      return -1;
    };
    for (let i = 0; i < size; i += 1) {
      score += countN3(modules[i]);
      score += countN3(modules.map((row) => row[i]));
    }
    const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
    score += 10 * Math.floor(Math.abs((dark / (size * size)) * 100 - 50) / 5);
    return score;
  }

  function encode(text, options) {
    const bytes = Array.from(encoder.encode(String(text)));
    if (bytes.length > MAX_BYTES) throw tooLong();
    let version = 1;
    while (capacityBytes(version) < bytes.length) version += 1;
    const codewords = interleave(buildDataCodewords(bytes, version), version);
    const grid = createGrid(version);
    placeCodewords(grid, codewords);

    let mask = options && Number.isInteger(options.mask) ? options.mask : -1;
    if (mask < 0) {
      let best = Infinity;
      for (let candidate = 0; candidate < 8; candidate += 1) {
        applyMask(grid, candidate);
        const score = penalty(grid.modules);
        if (score < best) { best = score; mask = candidate; }
        applyMask(grid, candidate); // 되돌리기
      }
    }
    applyMask(grid, mask);
    finishGrid(grid, mask);
    return { version, size: grid.size, modules: grid.modules };
  }

  function toSvg(modules, options) {
    const scale = (options && options.scale) || 6;
    const border = options && options.border !== undefined ? options.border : 4;
    const full = modules.length + border * 2;
    const cells = [];
    modules.forEach((row, y) => row.forEach((dark, x) => {
      if (dark) cells.push(`<rect x="${x + border}" y="${y + border}" width="1" height="1"/>`);
    }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" width="${full * scale}" height="${full * scale}" shape-rendering="crispEdges" role="img" aria-label="문자 보내기 QR 코드">`
      + `<rect width="${full}" height="${full}" fill="#fff"/><g fill="#000">${cells.join('')}</g></svg>`;
  }

  return { MAX_BYTES, byteLength, encode, toSvg };
});
