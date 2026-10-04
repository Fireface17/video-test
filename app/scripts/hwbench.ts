// temporary A/B benchmark for the highway scene (interleaved configs in one browser session)
import { chromium } from 'playwright-core';
import path from 'node:path';
const APP = path.resolve(import.meta.dir, '..');
const argv = process.argv.slice(2);
const times = (argv[0] ?? '19.6,22.4,25.5,26.8,29.5').split(',').map(Number);
const configs: Record<string, unknown>[] = JSON.parse(argv[1] ?? '[{}]');
const rounds = +(argv[2] ?? '3');
const port = 5600 + Math.floor(Math.random() * 300);
const proc = Bun.spawn(['bunx', 'vite', '--port', String(port), '--strictPort'], { cwd: APP, stdout: 'ignore', stderr: 'ignore', env: { ...process.env, PDOOM_NO_HMR: '1' } });
const url = `http://localhost:${port}`;
for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) break; } catch {} await Bun.sleep(100); }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`${url}/?export=1&only=highway`);
  await page.waitForFunction(() => (window as any).__pdoom?.ready || (window as any).__pdoom?.error, null, { timeout: 120000 });
  const res: number[][] = configs.map(() => []);
  const { execSync } = await import('node:child_process');
  const bpid = (browser as any).process?.()?.pid;
  const gpuPids = () => {
    const rows = execSync('ps -eo pid=,ppid=,args=').toString().trim().split('\n').map((l) => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)!; return { pid: +m[1]!, ppid: +m[2]!, args: m[3]! }; });
    const mine = new Set([process.pid]);
    for (let k = 0; k < 6; k++) for (const r of rows) if (mine.has(r.ppid)) mine.add(r.pid);
    return rows.filter((r) => mine.has(r.pid) && r.args.includes('--type=gpu-process')).map((r) => String(r.pid));
  };
  const cpu = () => { let s = 0; for (const p of gpuPids()) { try { const f = require('node:fs').readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' '); s += (+f[11] + +f[12]) * 10; } catch {} } return s; };
  void bpid;
  for (let r = 0; r < rounds; r++) for (let c = 0; c < configs.length; c++) {
    const c0 = cpu();
    const ms0 = await page.evaluate(async ({ cfg, times }) => {
      (globalThis as any).__HW = cfg;
      const P = (window as any).__pdoom;
      const buf = new Uint8Array(P.width * P.height * 4);
      P.engine.render(times[0], 1 / 60, false, 1, 0.5); await P.engine.readPixelsAsync(buf);
      let tot = 0;
      for (const t of times) { const a = performance.now(); P.engine.render(t, 1 / 60, false, 1, 0.5); await P.engine.readPixelsAsync(buf); tot += performance.now() - a; }
      return tot / times.length;
    }, { cfg: configs[c], times });
    const cms = (cpu() - c0) / (times.length + 1);
    void ms0;
    res[c]!.push(cms);
  }
  configs.forEach((c, i) => console.log(JSON.stringify(c).padEnd(40), 'gpu-cpu ms/frame:', res[i]!.map((x) => x.toFixed(0)).join(' '), ' min', Math.min(...res[i]!).toFixed(0)));
} finally { await browser.close(); proc.kill(); }
