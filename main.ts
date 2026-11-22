import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function solveSokoban(text: string): string {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const grid = new Uint8Array(w * h);
  const allGoals: number[] = [];
  const allBoxes: number[] = [];
  let startPlayer = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y]![x] ?? '#';
      const idx = y * w + x;
      if (ch === '#') {
        grid[idx] = 1;
      } else {
        if ('.*+'.includes(ch)) allGoals.push(idx);
        if ('$*'.includes(ch)) allBoxes.push(idx);
        if ('@+'.includes(ch)) startPlayer = idx;
      }
    }
  }

  if (startPlayer === -1 || allGoals.length === 0 || allBoxes.length === 0) return '';

  const py = Math.floor(startPlayer / w);
  const hallway = new Set<number>();
  const hq = [startPlayer];
  hallway.add(startPlayer);
  while (hq.length > 0) {
    const cur = hq.pop()!;
    for (const dx of [-1, 1]) {
      const nx = (cur % w) + dx;
      const nidx = py * w + nx;
      if (!grid[nidx] && !hallway.has(nidx)) {
        hallway.add(nidx);
        hq.push(nidx);
      }
    }
  }

  interface Door {
    x: number;
    y: number;
    doorIdx: number;
    hallwayIdx: number;
    dir: string;
    D: string;
  }

  const doors: Door[] = [];
  for (const hidx of hallway) {
    const x = hidx % w;
    if (py > 0 && !grid[(py - 1) * w + x]) {
      doors.push({ x, y: py - 1, doorIdx: (py - 1) * w + x, hallwayIdx: hidx, dir: 'u', D: 'U' });
    }
    if (py < h - 1 && !grid[(py + 1) * w + x]) {
      doors.push({ x, y: py + 1, doorIdx: (py + 1) * w + x, hallwayIdx: hidx, dir: 'd', D: 'D' });
    }
  }

  interface Room {
    door: Door;
    cells: Set<number>;
    boxes: number[];
    goals: number[];
  }

  const rooms: Room[] = [];
  for (const door of doors) {
    const roomCells = new Set<number>();
    const rq = [door.doorIdx];
    roomCells.add(door.doorIdx);
    while (rq.length > 0) {
      const cur = rq.pop()!;
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      for (const [dx, dy] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]) {
        const nx = cx + dx!;
        const ny = cy + dy!;
        const nidx = ny * w + nx;
        if (!grid[nidx] && !hallway.has(nidx) && !roomCells.has(nidx)) {
          roomCells.add(nidx);
          rq.push(nidx);
        }
      }
    }
    const rBoxes = allBoxes.filter((b) => roomCells.has(b));
    const rGoals = allGoals.filter((g) => roomCells.has(g));
    if (rBoxes.length > 0 && rGoals.length > 0) {
      rooms.push({ door, cells: roomCells, boxes: rBoxes, goals: rGoals });
    }
  }

  function walkPath(from: number, to: number, walkableSet: Set<number>): string | null {
    if (from === to) return '';
    const visited = new Set<number>([from]);
    const parent = new Map<number, number>();
    const moveChar = new Map<number, string>();
    const q = [from];
    const DIRS: [number, number, string][] = [
      [0, -1, 'u'],
      [0, 1, 'd'],
      [-1, 0, 'l'],
      [1, 0, 'r'],
    ];
    let found = false;
    let head = 0;
    while (head < q.length) {
      const cur = q[head++]!;
      if (cur === to) {
        found = true;
        break;
      }
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      for (const [dx, dy, ch] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        const nidx = ny * w + nx;
        if (walkableSet.has(nidx) && !visited.has(nidx)) {
          visited.add(nidx);
          parent.set(nidx, cur);
          moveChar.set(nidx, ch);
          q.push(nidx);
        }
      }
    }
    if (!found) return null;
    let path = '';
    let curr = to;
    while (curr !== from) {
      path = moveChar.get(curr)! + path;
      curr = parent.get(curr)!;
    }
    return path;
  }

  function solveRoom(
    room: Room,
    playerStartInRoom: number,
    mustExitToDoor: boolean,
  ): { moves: string; pushes: number; endPlayer: number } | null {
    const rCells = room.cells;
    const isGoal = new Uint8Array(w * h);
    for (const g of room.goals) isGoal[g] = 1;

    const isDead = new Uint8Array(w * h);
    for (const idx of rCells) {
      if (isGoal[idx]) continue;
      const up = !rCells.has(idx - w) || grid[idx - w];
      const down = !rCells.has(idx + w) || grid[idx + w];
      const left = !rCells.has(idx - 1) || grid[idx - 1];
      const right = !rCells.has(idx + 1) || grid[idx + 1];
      if ((up || down) && (left || right)) isDead[idx] = 1;
    }

    const dist = new Int32Array(w * h).fill(9999);
    const gq: number[] = [];
    for (const g of room.goals) {
      dist[g] = 0;
      gq.push(g);
    }
    let ghead = 0;
    const DIRS: [number, number, string, string][] = [
      [0, -1, 'u', 'U'],
      [0, 1, 'd', 'D'],
      [-1, 0, 'l', 'L'],
      [1, 0, 'r', 'R'],
    ];
    while (ghead < gq.length) {
      const cur = gq[ghead++]!;
      const d = dist[cur]!;
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      for (const [dx, dy] of DIRS) {
        const nidx = (cy + dy) * w + (cx + dx);
        if (rCells.has(nidx) && !grid[nidx] && dist[nidx]! > d + 1) {
          dist[nidx] = d + 1;
          gq.push(nidx);
        }
      }
    }

    function hVal(bs: number[]): number {
      let sum = 0;
      for (const b of bs) sum += dist[b]!;
      return sum;
    }

    function getReach(p: number, bs: number[]) {
      const bSet = new Uint8Array(w * h);
      for (const b of bs) bSet[b] = 1;
      const visited = new Uint8Array(w * h);
      const pWalk = new Int32Array(w * h).fill(-1);
      const wChar: string[] = new Array(w * h);
      let minIdx = p;
      const q = [p];
      visited[p] = 1;
      let head = 0;
      while (head < q.length) {
        const cur = q[head++]!;
        if (cur < minIdx) minIdx = cur;
        const cx = cur % w;
        const cy = Math.floor(cur / w);
        for (const [dx, dy, l] of DIRS) {
          const nidx = (cy + dy) * w + (cx + dx);
          if (rCells.has(nidx) && !grid[nidx] && !bSet[nidx] && !visited[nidx]) {
            visited[nidx] = 1;
            pWalk[nidx] = cur;
            wChar[nidx] = l;
            q.push(nidx);
          }
        }
      }
      return { minIdx, visited, pWalk, wChar };
    }

    const startBoxes = room.boxes.slice().sort((a, b) => a - b);
    const initReach = getReach(playerStartInRoom, startBoxes);

    const sBoxes: number[][] = [startBoxes];
    const sPlayer: number[] = [playerStartInRoom];
    const sParent: number[] = [-1];
    const sMove: string[] = [''];
    const sG: number[] = [0];

    const seen = new Map<string, number>();
    seen.set(initReach.minIdx + ':' + startBoxes.join(','), 0);

    const heap: [number, number, number][] = [[hVal(startBoxes), 0, 0]];
    function pushH(item: [number, number, number]): void {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const parentIdx = (i - 1) >> 1;
        if (heap[i]![0] >= heap[parentIdx]![0]) break;
        const tmp = heap[i]!;
        heap[i] = heap[parentIdx]!;
        heap[parentIdx] = tmp;
        i = parentIdx;
      }
    }
    function popH(): [number, number, number] {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        while (true) {
          let left = 2 * i + 1;
          if (left >= heap.length) break;
          if (left + 1 < heap.length && heap[left + 1]![0] < heap[left]![0]) left++;
          if (heap[i]![0] <= heap[left]![0]) break;
          const tmp = heap[i]!;
          heap[i] = heap[left]!;
          heap[left] = tmp;
          i = left;
        }
      }
      return top;
    }

    let expansions = 0;
    while (heap.length > 0 && expansions < 200_000) {
      const [, g, sId] = popH();
      const curB = sBoxes[sId]!;
      const curP = sPlayer[sId]!;

      let allG = true;
      for (const b of curB) {
        if (!isGoal[b]) {
          allG = false;
          break;
        }
      }
      if (allG) {
        const reach = getReach(curP, curB);
        if (!mustExitToDoor || reach.visited[room.door.doorIdx]) {
          let exitMoves = '';
          if (mustExitToDoor && curP !== room.door.doorIdx) {
            let step = room.door.doorIdx;
            while (step !== curP) {
              exitMoves = reach.wChar[step]! + exitMoves;
              step = reach.pWalk[step]!;
            }
          }
          let m = '';
          let c = sId;
          while (sParent[c]! !== -1) {
            m = sMove[c]! + m;
            c = sParent[c]!;
          }
          return { moves: m + exitMoves, pushes: g, endPlayer: mustExitToDoor ? room.door.doorIdx : curP };
        }
      }

      expansions++;
      const reach = getReach(curP, curB);
      const bSet = new Uint8Array(w * h);
      for (const b of curB) bSet[b] = 1;

      for (let bi = 0; bi < curB.length; bi++) {
        const b = curB[bi]!;
        const bx = b % w;
        const by = Math.floor(b / w);
        for (const [dx, dy, , U] of DIRS) {
          const fromIdx = (by - dy) * w + (bx - dx);
          const toIdx = (by + dy) * w + (bx + dx);

          if (!rCells.has(fromIdx) || !reach.visited[fromIdx]) continue;
          if (!rCells.has(toIdx) || grid[toIdx] || bSet[toIdx]) continue;
          if (isDead[toIdx]) continue;

          const nb = curB.slice();
          nb[bi] = toIdx;
          nb.sort((a, b) => a - b);
          const nextReach = getReach(b, nb);
          const nextKey = nextReach.minIdx + ':' + nb.join(',');
          const nextG = g + 1;
          if (seen.has(nextKey) && seen.get(nextKey)! <= nextG) continue;
          seen.set(nextKey, nextG);

          let walkM = '';
          let step = fromIdx;
          while (step !== curP) {
            walkM = reach.wChar[step]! + walkM;
            step = reach.pWalk[step]!;
          }

          const nextId = sBoxes.length;
          sBoxes.push(nb);
          sPlayer.push(b);
          sParent.push(sId);
          sMove.push(walkM + U);
          sG.push(nextG);

          pushH([nextG + hVal(nb), nextG, nextId]);
        }
      }
    }
    return null;
  }

  if (rooms.length > 0) {
    let curPlayer = startPlayer;
    let fullSolution = '';

    for (let ri = 0; ri < rooms.length; ri++) {
      const room = rooms[ri]!;
      const isLast = ri === rooms.length - 1;

      const hwWalk = walkPath(curPlayer, room.door.hallwayIdx, hallway);
      if (hwWalk === null) return '';
      fullSolution += hwWalk;
      curPlayer = room.door.hallwayIdx;

      const boxAtDoor = room.boxes.includes(room.door.doorIdx);
      let playerInRoom: number;
      if (boxAtDoor) {
        fullSolution += room.door.D;
        const dirOffset = room.door.dir === 'u' ? -w : w;
        const boxNewPos = room.door.doorIdx + dirOffset;
        const bIdx = room.boxes.indexOf(room.door.doorIdx);
        room.boxes[bIdx] = boxNewPos;
        playerInRoom = room.door.doorIdx;
      } else {
        fullSolution += room.door.dir;
        playerInRoom = room.door.doorIdx;
      }

      const rRes = solveRoom(room, playerInRoom, !isLast);
      if (!rRes) return '';
      fullSolution += rRes.moves;

      if (!isLast) {
        const exitDir = room.door.dir === 'u' ? 'd' : 'u';
        fullSolution += exitDir;
        curPlayer = room.door.hallwayIdx;
      }
    }
    return fullSolution;
  }

  return '';
}

for (const id of readdirSync(I).sort()) {
  const levelPath = join(I, id, 'level.txt');
  const moves = solveSokoban(readFileSync(levelPath, 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
