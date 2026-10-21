// Node-only Stockfish engine for scripts (not part of the browser bundle).
// Same semantics as src/engine/stockfishEngine.ts: one job at a time, deepest line per multipv,
// and the depth-0 terminal reply for mate/stalemate positions.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { Engine, EngineLine } from '../src/types';
import { parseInfo, parseTerminalInfo } from '../src/engine/uci';

const ENGINE_JS = fileURLToPath(new URL('../node_modules/stockfish/bin/stockfish-19-lite-single.js', import.meta.url));

type Job = { fen: string; depth: number; multiPv: number; resolve: (l: EngineLine[]) => void; reject: (e: Error) => void };

export async function createNodeEngine(): Promise<Engine> {
  const proc = spawn(process.execPath, [ENGINE_JS], { stdio: ['pipe', 'pipe', 'inherit'] });
  const rl = createInterface({ input: proc.stdout });
  let listener: ((line: string) => void) | null = null;
  let failure: Error | null = null;
  const queue: Job[] = [];
  let current: Job | null = null;
  let disposed = false;

  const fail = (err: Error) => {
    if (failure) return;
    failure = err;
    current?.reject(err);
    current = null;
    for (const j of queue.splice(0)) j.reject(err);
  };
  proc.on('exit', () => fail(new Error('Engine process exited')));
  proc.on('error', (e) => fail(e));
  rl.on('line', (line) => { if (line) listener?.(line); });
  const send = (cmd: string) => proc.stdin.write(cmd + '\n');

  const waitFor = (token: string) => new Promise<void>((resolve) => {
    listener = (line) => { if (line.trim() === token) { listener = null; resolve(); } };
  });
  const uciok = waitFor('uciok'); send('uci'); await uciok;
  const ready = waitFor('readyok'); send('isready'); await ready;

  function pump() {
    if (current || disposed) return;
    const job = queue.shift();
    if (!job) return;
    current = job;
    const best = new Map<number, EngineLine>();
    let terminal: EngineLine | null = null;
    listener = (line) => {
      if (line.startsWith('bestmove')) {
        listener = null;
        current = null;
        const out = best.size ? [...best.values()].sort((a, b) => a.multipv - b.multipv)
          : [terminal ?? { multipv: 1, score: { cp: 0 }, pv: [], depth: 0 }];
        job.resolve(out);
        pump();
        return;
      }
      const info = parseInfo(line);
      if (info) {
        const prev = best.get(info.multipv);
        if (!prev || info.depth >= prev.depth) best.set(info.multipv, info);
      } else {
        terminal = parseTerminalInfo(line) ?? terminal;
      }
    };
    send(`setoption name MultiPV value ${job.multiPv}`);
    send(`position fen ${job.fen}`);
    send(`go depth ${job.depth}`);
  }

  return {
    analyse(fen, opts) {
      if (failure) return Promise.reject(failure);
      if (disposed) return Promise.reject(new Error('Engine disposed'));
      return new Promise((resolve, reject) => {
        queue.push({ fen, depth: opts.depth, multiPv: opts.multiPv ?? 1, resolve, reject });
        pump();
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      send('quit');
      proc.kill();
    },
  };
}

/** Wraps an engine with a JSON disk memo keyed by fen|depth|multipv. Call flush() to save. */
export function withDiskMemo(engine: Engine, file: string): Engine & { flush(): void; hits: number; misses: number } {
  let memo: Record<string, EngineLine[]> = {};
  try {
    if (existsSync(file)) memo = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    console.warn(`Engine memo ${file} is unreadable; starting empty.`);
    memo = {};
  }
  let dirty = 0;
  const self = {
    hits: 0,
    misses: 0,
    async analyse(fen: string, opts: { depth: number; multiPv?: number }) {
      const key = `${fen}|${opts.depth}|${opts.multiPv ?? 1}`;
      if (memo[key]) { self.hits++; return memo[key]; }
      self.misses++;
      const lines = await engine.analyse(fen, opts);
      memo[key] = lines;
      if (++dirty >= 200) self.flush();
      return lines;
    },
    flush() { // atomic: write a temp file, then rename over the memo
      const tmp = `${file}.${process.pid}.tmp`;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(tmp, JSON.stringify(memo));
      renameSync(tmp, file);
      dirty = 0;
    },
    dispose() { self.flush(); engine.dispose(); },
  };
  return self;
}
