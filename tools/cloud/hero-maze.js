// The landing hero: the Command Center's maze seen as a living galaxy. The Whalyom symbol burns at the
// heart; the six engraved rings turn at their own speeds; every agent rides its layer ring in its
// department's colour; every skill and verified fact is dust on spiral arms; signals run from agents to
// the heart. No network beyond three.js and the symbol; without WebGL the static picture stays.
(() => {
  'use strict';
  const box = document.querySelector('[data-maze3d]');
  const cv = box && box.querySelector('canvas');
  if (!cv || !window.THREE) return;
  const THREE = window.THREE;
  let data = {};
  try { data = JSON.parse(document.getElementById('maze-data').textContent); } catch { /* defaults below */ }
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch { return; }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;
  let seed = 20261107;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 2;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x071013, 0.018);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 500);
  const world = new THREE.Group();
  world.rotation.set(0.05, 0, -0.06);
  scene.add(world);

  const C = { ink: 0x090D10, ivory: 0xD5D3C8, brass: 0xAD9570, gold: 0xE4BE4B, signal: 0x8EDDE2, faint: 0x29413F };
  const tex = (draw, w = 64, h = 64) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return new THREE.CanvasTexture(c); };
  const dot = tex((g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.85)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); });
  const glow = tex((g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,.95)'); r.addColorStop(0.15, 'rgba(255,255,255,.45)'); r.addColorStop(0.45, 'rgba(255,255,255,.1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); }, 128, 128);
  const shaft = tex((g, w, h) => { const r = g.createLinearGradient(0, 0, 0, h); r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.5, 'rgba(255,255,255,.9)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); const s = g.createLinearGradient(0, 0, w, 0); s.addColorStop(0, 'rgba(0,0,0,1)'); s.addColorStop(0.5, 'rgba(0,0,0,0)'); s.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = s; g.fillRect(0, 0, w, h); }, 32, 256);
  const add = THREE.AdditiveBlending;

  // ── The maze: the same six engraved rings as the Command Center, each turning on its own ──
  const R0 = 4.9, RSTEP = 2.6, ringR = (l) => R0 + (l - 1) * RSTEP, R_OUT = ringR(6) + 1.9;
  const lineMat = (color, opacity) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: add, depthWrite: false });
  const lines = (pos, mat) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); const m = new THREE.LineSegments(g, mat); m.frustumCulled = false; return m; };
  const arc = (v, r, a0, a1, y = 0) => { const n = Math.max(1, Math.ceil((a1 - a0) / 0.03)); for (let i = 0; i < n; i++) { const s = a0 + (a1 - a0) * i / n, e = a0 + (a1 - a0) * (i + 1) / n; v.push(Math.cos(s) * r, y, Math.sin(s) * r, Math.cos(e) * r, y, Math.sin(e) * r); } };
  const rad = (v, a, r0, r1) => v.push(Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(a) * r1, 0, Math.sin(a) * r1);
  const wall = (v, m, bars) => { let a = rnd() * TAU; const end = a + TAU - 0.12; while (a < end) { const len = 0.35 + rnd() * 1.4; arc(v, m, a, Math.min(a + len, end)); a += len + 0.05 + rnd() * 0.2; } for (let i = 0; i < bars; i++) rad(v, rnd() * TAU, m - 0.34, m + 0.34); };
  const layers = [];
  for (let l = 1; l <= 6; l++) {
    const g = new THREE.Group(), main = [], walls = [];
    arc(main, ringR(l), 0, TAU);
    wall(walls, ringR(l) + RSTEP / 2, 7 + Math.floor(rnd() * 5));
    g.add(lines(main, lineMat(C.brass, 0.55)), lines(walls, lineMat(C.signal, 0.16)));
    g.userData.w = 0.055 / Math.pow(l, 0.8) * (l % 2 ? 1 : -0.6);
    world.add(g); layers.push(g);
  }
  const inner = new THREE.Group(); { const v = []; wall(v, 3.5, 6); inner.add(lines(v, lineMat(C.signal, 0.22))); inner.userData.w = -0.09; world.add(inner); }
  const rim = new THREE.Group();
  { const a = [], b = []; arc(a, R_OUT, 0, TAU); arc(a, R_OUT - 0.2, 0, TAU); for (let i = 0; i < 180; i++) { const major = i % 5 === 0; rad(major ? b : a, i / 180 * TAU, R_OUT - (major ? 0.7 : 0.34), R_OUT - 0.22); }
    rim.add(lines(a, lineMat(C.brass, 0.5)), lines(b, lineMat(C.gold, 0.75))); rim.userData.w = -0.012; world.add(rim); }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R_OUT, 120).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0B1A1D, transparent: true, opacity: 0.55, depthWrite: false }));
  disc.position.y = -0.06; world.add(disc);

  // ── Agents: one pearl of light per agent, on its layer ring, grouped by department ──
  const roster = Array.isArray(data.agents) && data.agents.length ? data.agents : Array.from({ length: data.count || 536 }, (_, i) => [1 + (i % 6), i % 28, '']);
  const PAL = ['#8EDDE2', '#E4BE4B', '#A9E7EA', '#D5D3C8', '#AD9570', '#5EEAD4', '#F0C987', '#C4B5FD'];
  const byLayer = [[], [], [], [], [], []];
  roster.forEach((a, i) => byLayer[Math.max(1, Math.min(6, a[0] | 0)) - 1].push({ d: a[1] | 0, hex: a[2], i }));
  const agents = [];
  byLayer.forEach((list, li) => {
    list.sort((x, y) => x.d - y.d);
    const groups = []; for (const r of list) { const g = groups[groups.length - 1]; if (g && g.d === r.d) g.list.push(r); else groups.push({ d: r.d, list: [r] }); }
    const gap = groups.length > 1 ? 0.07 : 0, usable = TAU - gap * groups.length, r0 = ringR(li + 1);
    let a = -Math.PI / 2 + gap / 2;
    for (const g of groups) {
      const m = g.list.length, span = usable * m / list.length, cap = Math.max(1, Math.floor(span * r0 / 0.62)), rows = Math.min(5, Math.ceil(m / cap)), per = Math.ceil(m / rows);
      g.list.forEach((r, j) => {
        const row = Math.floor(j / per), idx = j % per, cnt = Math.min(per, m - row * per);
        const col = new THREE.Color(/^#[0-9a-f]{6}$/i.test(r.hex || '') ? r.hex : PAL[r.d % PAL.length]);
        col.lerp(new THREE.Color(0xffffff), 0.35);
        agents.push({ a: a + span * (idx + 0.5) / cnt, r: r0 + (row - (rows - 1) / 2) * 0.46, layer: li, col, glow: 0, ph: rnd() * TAU });
      });
      a += span + gap;
    }
  });
  const pointsOf = (n, size, opacity) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ size, map: dot, vertexColors: true, transparent: true, opacity, blending: add, depthWrite: false, sizeAttenuation: true }));
    p.frustumCulled = false; return p;
  };
  const agentPts = pointsOf(agents.length, 0.95, 1); world.add(agentPts);
  const agentHalo = pointsOf(agents.length, 2.6, 0.3); world.add(agentHalo);

  // ── Skills and facts: dust on two spiral arms, turning slower the further out it is ──
  const dustOf = (n, rMin, rMax, arms, palette, size, opacity) => {
    const p = pointsOf(n, size, opacity), list = [];
    const col = p.geometry.attributes.color;
    for (let i = 0; i < n; i++) {
      const t = Math.pow(rnd(), 0.8), r = rMin + t * (rMax - rMin);
      const a = (i % arms) * TAU / arms + t * 5.2 + gauss() * 0.42;
      const c = new THREE.Color(palette[Math.floor(rnd() * palette.length)]);
      col.setXYZ(i, c.r, c.g, c.b);
      list.push({ a, r, y: gauss() * (0.25 + t * 0.5) });
    }
    p.userData.list = list; world.add(p); return p;
  };
  const skills = dustOf(Math.max(60, data.skills || 498), 2.2, R_OUT + 2, 2, ['#E4BE4B', '#F0C987', '#D5D3C8', '#AD9570'], 0.34, 0.9);
  const facts = dustOf(Math.max(60, data.facts || 1100), 3, R_OUT + 9, 2, ['#8EDDE2', '#A9E7EA', '#D5D3C8', '#5E8F94'], 0.2, 0.7);

  // far stars and a thin milky way band
  { const n = 1800, g = new THREE.BufferGeometry(), v = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const band = i < 900; const th = rnd() * TAU, ph = band ? Math.PI / 2 + gauss() * 0.18 : Math.acos(2 * rnd() - 1), R = 140 + rnd() * 60; v.set([R * Math.sin(ph) * Math.cos(th), R * Math.cos(ph), R * Math.sin(ph) * Math.sin(th)], i * 3); }
    g.setAttribute('position', new THREE.BufferAttribute(v, 3));
    const s = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.55, map: dot, color: 0xBFC9C6, transparent: true, opacity: 0.7, blending: add, depthWrite: false, fog: false }));
    s.rotation.set(0.5, 0, 0.9); scene.add(s); }

  // ── The heart: the Whalyom symbol, a shaft of light, and armillary rings turning around it ──
  const heart = new THREE.Group(); heart.position.y = 1.7; scene.add(heart);
  const sprite = (map, color, opacity, sx, sy = sx) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, transparent: true, opacity, blending: add, depthWrite: false, fog: false })); s.scale.set(sx, sy, 1); return s; };
  const halo1 = sprite(glow, C.signal, 0.75, 11), halo2 = sprite(glow, C.gold, 0.28, 26), beam = sprite(shaft, C.signal, 0.32, 1.4, 34);
  heart.add(halo2, halo1, beam);
  const symMat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false, opacity: 0 });
  const sym = new THREE.Sprite(symMat); sym.scale.set(3.6, 3.6 * 512 / 502, 1); sym.renderOrder = 10; heart.add(sym);
  new THREE.TextureLoader().load(data.symbol || '/brand/whalyom-symbol.png', (t) => { symMat.map = t; symMat.needsUpdate = true; symMat.opacity = 1; });
  const loop = (r, color, op) => { const v = []; arc(v, r, 0, TAU); return lines(v, lineMat(color, op)); };
  const armA = loop(2.3, C.gold, 0.55), armB = loop(2.65, C.signal, 0.4), armC = loop(3.0, C.brass, 0.45);
  armB.rotation.x = Math.PI / 3; armC.rotation.z = Math.PI / 2.6;
  const arms = new THREE.Group(); arms.add(armA, armB, armC); heart.add(arms);

  // ── Signals: an agent flares and a spark runs to the heart; a ripple crosses the maze ──
  const SPARKS = 10;
  const sparkPts = pointsOf(SPARKS, 0.8, 1); world.add(sparkPts);
  const sparks = Array.from({ length: SPARKS }, () => ({ t: 1, from: null }));
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 160).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: C.signal, transparent: true, opacity: 0, blending: add, depthWrite: false, side: THREE.DoubleSide }));
  ripple.position.y = 0.02; world.add(ripple);
  let rippleT = 2;

  // ── Camera: a slow cinematic drift, with a little parallax from the pointer ──
  let mx = 0, my = 0, tx = 0, ty = 0;
  window.addEventListener('pointermove', (e) => { tx = (e.clientX / window.innerWidth - 0.5); ty = (e.clientY / window.innerHeight - 0.5); }, { passive: true });
  const resize = () => { const w = box.clientWidth, h = box.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(box); resize();

  const _v = new THREE.Vector3();
  let last = performance.now(), T = 0, visible = true, running = false;
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; T += dt;
    mx += (tx - mx) * 0.03; my += (ty - my) * 0.03;
    const az = -0.35 + Math.sin(T * 0.045) * 0.32 + mx * 0.35, el = 0.42 + Math.sin(T * 0.06) * 0.04 - my * 0.12, dist = 40 - Math.sin(T * 0.05) * 2;
    cam.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
    cam.lookAt(0, 0.4, 0);

    for (const g of layers) g.rotation.y += g.userData.w * dt;
    inner.rotation.y += inner.userData.w * dt; rim.rotation.y += rim.userData.w * dt;

    const pp = agentPts.geometry.attributes.position, pc = agentPts.geometry.attributes.color, hp = agentHalo.geometry.attributes.position, hc = agentHalo.geometry.attributes.color;
    if (!reduce && rnd() < dt * 1.6) { const ag = agents[Math.floor(rnd() * agents.length)]; ag.glow = 1; const s = sparks.find((x) => x.t >= 1); if (s) { s.t = 0; s.from = ag; } }
    agents.forEach((ag, i) => {
      const a = ag.a + layers[ag.layer].rotation.y * -1;
      const y = 0.25 + Math.sin(T * 0.8 + ag.ph) * 0.06;
      ag.x = Math.cos(a) * ag.r; ag.z = Math.sin(a) * ag.r; ag.y = y;
      pp.setXYZ(i, ag.x, y, ag.z); hp.setXYZ(i, ag.x, y, ag.z);
      ag.glow = Math.max(0, ag.glow - dt * 0.6);
      const k = 0.75 + ag.glow * 1.6 + Math.sin(T * 1.3 + ag.ph) * 0.12;
      pc.setXYZ(i, ag.col.r * k, ag.col.g * k, ag.col.b * k);
      const hk = 0.35 + ag.glow * 2.4; hc.setXYZ(i, ag.col.r * hk, ag.col.g * hk, ag.col.b * hk);
    });
    pp.needsUpdate = pc.needsUpdate = hp.needsUpdate = hc.needsUpdate = true;

    for (const d of [skills, facts]) {
      const pos = d.geometry.attributes.position, list = d.userData.list, k = d === skills ? 0.22 : 0.14;
      for (let i = 0; i < list.length; i++) { const p = list[i]; p.a += dt * k / Math.pow(p.r / 4, 1.2); pos.setXYZ(i, Math.cos(p.a) * p.r, p.y, Math.sin(p.a) * p.r); }
      pos.needsUpdate = true;
    }

    const sp = sparkPts.geometry.attributes.position, sc = sparkPts.geometry.attributes.color;
    sparks.forEach((s, i) => {
      if (s.t >= 1 || !s.from) { sp.setXYZ(i, 0, -999, 0); return; }
      s.t = Math.min(1, s.t + dt * 0.7);
      const e = s.t * s.t * (3 - 2 * s.t), lift = Math.sin(s.t * Math.PI) * 1.6;
      _v.set(s.from.x * (1 - e), s.from.y + lift + (1.7 - s.from.y) * e, s.from.z * (1 - e));
      sp.setXYZ(i, _v.x, _v.y, _v.z);
      const f = 1 - s.t * 0.4; sc.setXYZ(i, 0.6 * f + 0.4, 0.9 * f, 0.9 * f);
      if (s.t >= 1) { halo1.material.opacity = 1; }
    });
    sp.needsUpdate = sc.needsUpdate = true;

    rippleT += dt / 6;
    if (rippleT >= 1) { rippleT = 0; }
    const rr = 1 + rippleT * (R_OUT + 3); ripple.scale.set(rr, 1, rr); ripple.material.opacity = 0.45 * (1 - rippleT) * Math.min(1, rippleT * 8);

    arms.rotation.y += dt * 0.35; armB.rotation.y += dt * 0.5; armC.rotation.x += dt * 0.28;
    halo1.material.opacity += (0.72 + Math.sin(T * 1.4) * 0.08 - halo1.material.opacity) * 0.04;
    halo2.material.opacity = 0.24 + Math.sin(T * 0.5) * 0.05;
    beam.material.opacity = 0.26 + Math.sin(T * 0.9) * 0.06;
    heart.position.y = 1.7 + Math.sin(T * 0.7) * 0.12;

    renderer.render(scene, cam);
    if (visible && !reduce && !document.hidden) requestAnimationFrame(frame); else running = false;
  };
  const start = () => { if (running) return; running = true; last = performance.now(); requestAnimationFrame(frame); };
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) start(); }).observe(box);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
  box.classList.add('live');
  start();
})();
