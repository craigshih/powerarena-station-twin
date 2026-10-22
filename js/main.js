import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { P, CAMERAS, ZONES, SRC, PHASE_COLOR } from './params.js';
import { buildStation, stretch, projectBox } from './scene.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

// ── 主視窗 ───────────────────────────────────
const viewport = $('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'labels';
viewport.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e14);
const fog = new THREE.Fog(0x0a0e14, 22, 48);
scene.fog = fog;

scene.add(new THREE.HemisphereLight(0xbcd3ff, 0x1a1f28, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(6, 12, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
scene.add(sun);
const fill = new THREE.PointLight(0xffe2b0, 18, 9);
fill.position.set(0, 4.3, 1.8);
scene.add(fill);

const station = buildStation(scene);
const { d } = station;

const view = new THREE.PerspectiveCamera(42, 1, 0.05, 120);
const controls = new OrbitControls(view, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 1.2;
controls.maxDistance = 30;

// ── 視角預設 ─────────────────────────────────
const PRESETS = {
  orbit: { pos: [7.2, 6.2, 8.4], tgt: [0, 1.8, 0.8], fov: 42, label: '自由視角' },
  top: { pos: [0.01, 11.5, 1.4], tgt: [0, 1.4, 1.2], fov: 40, label: '由上往下' },
  front: { pos: [0, 4.4, 10.5], tgt: [0, 2.0, 0.6], fov: 40, label: '由前往後' },
  side: { pos: [10.5, 3.6, 1.2], tgt: [0, 2.0, 1.0], fov: 40, label: '側視' },
};
for (const c of station.cameras) {
  PRESETS[c.cfg.id] = { pos: c.pos.toArray(), tgt: c.tgt.toArray(), fov: c.vfov, label: c.cfg.name, cam: c };
}
let tween = null;
let activePreset = 'orbit';
// 直式或窄畫面時放大垂直視角，讓左右兩側高台都留在畫面內（攝影機視角維持實際參數）
function fitFov(base) {
  const a = view.aspect || 1.6;
  if (a >= 1.3) return base;
  return (2 * Math.atan(Math.tan((base * Math.PI) / 360) * (1.3 / a)) * 180) / Math.PI;
}
function goPreset(key, instant = false) {
  const p = PRESETS[key];
  activePreset = key;
  $$('[data-preset]').forEach((b) => b.classList.toggle('on', b.dataset.preset === key));
  const to = { pos: new THREE.Vector3(...p.pos), tgt: new THREE.Vector3(...p.tgt), fov: p.cam ? p.fov : fitFov(p.fov) };
  if (instant) {
    view.position.copy(to.pos); controls.target.copy(to.tgt); view.fov = to.fov; view.updateProjectionMatrix();
    return;
  }
  tween = { t: 0, from: { pos: view.position.clone(), tgt: controls.target.clone(), fov: view.fov }, to };
  // 進入攝影機視角時隱藏該支的視錐，避免擋住畫面
  station.cameras.forEach((c) => (c.frustum.userData.hiddenByPov = c === p.cam));
}
goPreset('orbit', true);

// ── 攝影機子畫面（PiP） ─────────────────────────
const pipStrip = $('#pips');
const pips = station.cameras.map((c) => {
  const el = document.createElement('figure');
  el.className = 'pip';
  el.style.setProperty('--c', c.hex);
  el.innerHTML = `<div class="pip-frame"><canvas class="pip-overlay"></canvas></div>
    <figcaption><b>${c.cfg.name}</b><span>${c.cfg.distance.v} m · 高 ${c.cfg.height.v} m · ${c.cfg.bearing.v}°</span></figcaption>`;
  const frame = $('.pip-frame', el);
  const r = new THREE.WebGLRenderer({ antialias: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  r.outputColorSpace = THREE.SRGBColorSpace;
  frame.prepend(r.domElement);
  el.addEventListener('click', () => goPreset(c.cfg.id));
  pipStrip.appendChild(el);
  return { c, el, frame, r, overlay: $('.pip-overlay', el) };
});

// ── 時間軸：3 分鐘偵測範圍的標準作業 ──────────────
const T = {
  window: P.detectWindow.v,
  p1Start: 6,
  checkpoint: 6 + P.phase1Duration.v + P.checkpointLead.v, // 承盤開始下降的時間點
};
T.p1End = T.checkpoint - P.checkpointLead.v;
T.trayEnd = T.checkpoint + P.trayDuration.v;
T.p2Start = T.trayEnd + 2;
T.p2End = T.p2Start + P.phase2Duration.v;

const zoneById = Object.fromEntries(station.zones.map((z) => [z.cfg.id, z]));
const zoneCenter = (id) => zoneById[id].mesh.position.clone();

// 每支工具的拜訪排程：[開始, 結束, 區域]
function schedule(side) {
  const p1 = ZONES.filter((z) => z.phase === 1 && z.side === side);
  const p2 = ZONES.filter((z) => z.phase === 2 && z.side === side);
  const out = [];
  const lay = (zones, t0, t1) => {
    const seg = (t1 - t0) / zones.length;
    zones.forEach((z, i) => out.push([t0 + i * seg + (i ? 1 : 2), t0 + (i + 1) * seg - 1.5, z]));
  };
  lay(p1, T.p1Start, T.p1End);
  lay(p2, T.p2Start, T.p2End);
  return out;
}
const plans = { L: schedule('L'), R: schedule('R') };

const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
function toolTarget(side, t) {
  const tool = station.tools[side];
  const plan = plans[side];
  const move = 1.6;
  for (let i = 0; i < plan.length; i++) {
    const [a, b, z] = plan[i];
    const base = zoneCenter(z.id);
    // 停留期間在數顆螺絲之間移動
    const dwell = Math.max(b - a, 0.01);
    const k = Math.min(Math.floor(((t - a) / dwell) * z.screws), z.screws - 1);
    const spread = (k - (z.screws - 1) / 2) / Math.max(z.screws - 1, 1);
    const screw = base.clone().add(new THREE.Vector3(0, 0.02, spread * z.size[2] * 0.6));
    if (t >= a && t <= b) return screw;
    if (t > b && t < b + move) {
      const next = plan[i + 1];
      const sameStage = next && next[0] - b < move + 1.5;
      const dest = sameStage ? zoneCenter(next[2].id) : tool.rest;
      return screw.lerp(dest, ease((t - b) / move));
    }
    if (t < a && t > a - move) {
      const prev = plan[i - 1];
      const src = prev && a - prev[1] < move + 1.5 ? null : tool.rest;
      if (src) return src.clone().lerp(base, ease(1 - (a - t) / move));
    }
  }
  return tool.rest.clone();
}

function phaseAt(t) {
  if (t < T.p1Start) return { key: 'ready', label: '待命', tone: 'muted' };
  if (t < T.p1End) return { key: 'A', label: 'A｜第一階段鎖附', tone: 'orange' };
  if (t < T.checkpoint) return { key: 'gate', label: '檢查點前緩衝（工具須離開）', tone: 'yellow' };
  if (t < T.trayEnd) return { key: 'B', label: 'B｜承盤下降', tone: 'yellow' };
  if (t < T.p2Start) return { key: 'gate2', label: '承盤到位', tone: 'muted' };
  if (t < T.p2End) return { key: 'C', label: 'C｜第二階段鎖附', tone: 'teal' };
  return { key: 'done', label: '本段完成', tone: 'green' };
}

let simT = 0;
let playing = true;
let speed = 4;
const slider = $('#t-slider');
slider.max = T.window;

// 時間軸上的階段色塊
const track = $('#t-track');
const segs = [
  [T.p1Start, T.p1End, 'orange', 'A'],
  [T.checkpoint, T.trayEnd, 'yellow', 'B'],
  [T.p2Start, T.p2End, 'teal', 'C'],
];
for (const [a, b, tone, txt] of segs) {
  const s = document.createElement('span');
  s.className = `seg seg-${tone}`;
  s.style.left = `${(a / T.window) * 100}%`;
  s.style.width = `${((b - a) / T.window) * 100}%`;
  s.textContent = txt;
  track.appendChild(s);
}
const cp = document.createElement('span');
cp.className = 'checkpoint';
cp.style.left = `${(T.checkpoint / T.window) * 100}%`;
cp.title = '檢查點：承盤開始下降';
track.appendChild(cp);

const playBtn = $('#t-play');
playBtn.addEventListener('click', () => { playing = !playing; playBtn.classList.toggle('paused', !playing); playBtn.setAttribute('aria-label', playing ? '暫停' : '播放'); });
slider.addEventListener('input', () => { simT = +slider.value; });
$$('[data-speed]').forEach((b) => b.addEventListener('click', () => {
  speed = +b.dataset.speed;
  $$('[data-speed]').forEach((x) => x.classList.toggle('on', x === b));
}));

// ── 狀態更新 ─────────────────────────────────
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const _toolBox = new THREE.Box3();
let lastPhase = '';
const log = $('#event-log');
const logged = new Set();
function pushLog(text, tone) {
  const li = document.createElement('li');
  li.className = `tone-${tone}`;
  li.innerHTML = `<time>${fmt(simT)}</time>${text}`;
  log.prepend(li);
  while (log.children.length > 8) log.lastChild.remove();
}

function applyTime(t) {
  // 承盤
  const drop = THREE.MathUtils.clamp((t - T.checkpoint) / P.trayDuration.v, 0, 1);
  station.tray.position.y = -ease(drop) * P.trayDrop.v;

  // 工具、纜線、作業員手臂
  for (const side of ['L', 'R']) {
    const tool = station.tools[side];
    const target = toolTarget(side, t);
    tool.group.position.copy(target);
    const sideSign = side === 'L' ? 1 : -1;
    tool.group.rotation.set(0.35, sideSign > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
    const anchorZ = THREE.MathUtils.clamp(target.z, -0.8, 3.5);
    tool.balancer.position.set(tool.anchor.x, tool.anchor.y - 0.08, anchorZ);
    stretch(tool.cable, tool.balancer.position, target.clone().add(new THREE.Vector3(0, 0.04, 0)));
    const op = station.operators[side];
    const handTarget = target.clone().add(new THREE.Vector3(0, -0.06, 0));
    op.arms[0].lookAt(handTarget);
    op.arms[1].lookAt(handTarget.clone().add(new THREE.Vector3(0, 0.05, 0.12)));
  }

  // 工具與 ROI 重疊（PoC 判定邏輯的視覺化）
  const ph = phaseAt(t);
  for (const z of station.zones) {
    // 以工具前端位置判斷，避免工具外框擦過相鄰區域就誤判
    const hit = ['L', 'R'].some((side) => _toolBox.copy(z.box).expandByScalar(0.03).containsPoint(station.tools[side].group.position));
    const current = (z.cfg.phase === 1 && (ph.key === 'A' || ph.key === 'ready')) || (z.cfg.phase === 2 && ph.key === 'C');
    z.material.opacity = hit ? 0.5 : current ? 0.2 : 0.07;
    z.edges.material.opacity = hit ? 1 : current ? 0.85 : 0.3;
    if (hit && playing && !logged.has(z.cfg.id + (z.cfg.phase === 1 ? 'A' : 'C'))) {
      logged.add(z.cfg.id + (z.cfg.phase === 1 ? 'A' : 'C'));
      pushLog(`工具進入 <b>${z.cfg.label}</b>`, z.cfg.phase === 1 ? 'orange' : 'teal');
    }
  }

  // 三色燈：正常綠燈，承盤移動中黃燈閃爍；紅燈保留給 NG（下一階段）
  const blink = Math.floor(performance.now() / 350) % 2 === 0;
  const [red, yellow, green] = station.lamps;
  red.emissiveIntensity = 0.05;
  yellow.emissiveIntensity = (ph.key === 'B' || ph.key === 'gate') && blink ? 2.2 : 0.05;
  green.emissiveIntensity = ph.key === 'B' || ph.key === 'gate' ? 0.05 : 1.6;

  if (ph.key !== lastPhase) {
    if (lastPhase) pushLog(ph.label, ph.tone);
    if (ph.key === 'ready') logged.clear();
    lastPhase = ph.key;
  }

  // 面板
  $('#st-phase').textContent = ph.label;
  $('#st-phase').dataset.tone = ph.tone;
  const toCp = T.checkpoint - t;
  $('#st-checkpoint').textContent = toCp > 0 ? `${toCp.toFixed(1)} 秒` : '已通過';
  $('#st-tray').textContent = `${(station.tray.position.y * 100).toFixed(0)} cm`;
  $('#t-time').textContent = `${fmt(t)} / ${fmt(T.window)}`;
  slider.value = t;
  slider.style.setProperty('--p', `${(t / T.window) * 100}%`);
}

// ── 圖層開關 ─────────────────────────────────
// CSS2DRenderer 不會沿用父層的 visible，要把圖層內的文字標籤一起切換
function setLayer(name, on) {
  const layer = station.layers[name];
  if (!layer) return;
  layer.visible = on;
  layer.traverse((o) => { if (o.isCSS2DObject) o.visible = on; });
}
const narrow = matchMedia('(max-width: 767px)').matches;
const layerState = { frustums: true, zones: true, dims: !narrow, labels: true, people: true, bbox: true };
setLayer('dims', layerState.dims);
$$('[data-layer]').forEach((input) => {
  input.checked = layerState[input.dataset.layer];
  input.addEventListener('change', () => {
    const k = input.dataset.layer;
    layerState[k] = input.checked;
    setLayer(k, input.checked);
    if (k === 'labels') viewport.classList.toggle('hide-labels', !input.checked);
  });
});

// ── 點選物件 ─────────────────────────────────
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, view);
  const hit = raycaster.intersectObjects(scene.children, true)
    .find((h) => h.object.visible && h.object.userData.info && isVisible(h.object));
  showInfo(hit ? hit.object.userData.info : null);
});
function isVisible(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

const infoBox = $('#info');
function showInfo(info) {
  if (!info) {
    infoBox.innerHTML = '<p class="hint">點選場景中的物件（高台、攝影機、承盤、作業員、ROI…）查看參數與來源。</p>';
    return;
  }
  infoBox.innerHTML = `<div class="info-head"${info.color ? ` style="--c:${info.color}"` : ''}>
      <h3>${info.title}</h3><code>ID: ${info.id}</code></div>
    <dl>${info.rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  openTab('info');
}
showInfo(null);

// ── 參數表 ───────────────────────────────────
const STATUS = { confirmed: '已確認', derived: '推算', assumed: '假設' };
function paramRow(x) {
  const val = typeof x.v === 'number' ? +x.v.toFixed(4) : x.v;
  return `<tr><th>${x.label}${x.note ? `<small>${x.note}</small>` : ''}</th>
    <td class="num">${val}${x.unit ? ` <i>${x.unit}</i>` : ''}</td>
    <td><span class="chip chip-${x.status}" title="${x.src}">${STATUS[x.status]}</span></td></tr>`;
}
const groups = [
  ['高台與車輛', ['platformHeight', 'platformGap', 'platformWidth', 'bayWidth', 'tireOverlap', 'vehicleLength', 'bayRimHeight', 'operatorHeight']],
  ['承盤', ['trayDrop', 'trayDuration', 'trayControl']],
  ['作業時序', ['stationCycle', 'detectWindow', 'phase1Duration', 'phase2Duration', 'checkpointLead']],
  ['攝影機共用', ['camFov']],
];
$('#params').innerHTML = groups.map(([title, keys]) =>
  `<h4>${title}</h4><table>${keys.map((k) => paramRow(P[k])).join('')}</table>`).join('') +
  CAMERAS.map((c) => `<h4><span class="dot" style="--c:#${c.color.toString(16).padStart(6, '0')}"></span>攝影機 ${c.name}</h4>
    <table>${[c.distance, c.height, c.bearing].map(paramRow).join('')}</table>`).join('') +
  `<h4>鎖附區域 ROI</h4><table>${ZONES.map((z) => `<tr><th>${z.label}<small>${z.phase === 1 ? '第一階段' : '第二階段'}</small></th>
    <td class="num">${z.screws} <i>顆</i></td><td><span class="chip chip-assumed" title="${SRC.ASM}">假設</span></td></tr>`).join('')}</table>
  <p class="src-note">來源：${SRC.V2}、${SRC.V1}。「假設」項目等待業主或模型開發同事補充。</p>`;

// ── 分頁 ─────────────────────────────────────
function openTab(name) {
  $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  $$('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== name));
}
$$('[data-tab]').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.tab)));
openTab('params');

$$('[data-preset]').forEach((b) => b.addEventListener('click', () => goPreset(b.dataset.preset)));

// 右側面板在平板寬度改成抽屜
$('#drawer-toggle').addEventListener('click', () => document.body.classList.toggle('drawer-open'));
$('#drawer-close').addEventListener('click', () => document.body.classList.remove('drawer-open'));

// ── 匯出場域設定（下一階段做合成資料／校正用） ────────
$('#export').addEventListener('click', () => {
  const data = {
    units: 'meter', axes: 'Y up, vehicle front +Z, vehicle left +X',
    params: Object.fromEntries(Object.entries(P).map(([k, x]) => [k, { value: x.v, unit: x.unit, status: x.status, source: x.src }])),
    cameras: station.cameras.map((c) => ({
      id: c.cfg.id, position: c.pos.toArray(), target: c.tgt.toArray(),
      quaternion: c.cam.quaternion.toArray(), vfov_deg: c.vfov, hfov_deg: P.camFov.v, aspect: P.camAspect.v,
    })),
    zones: station.zones.map((z) => ({ id: z.cfg.id, label: z.cfg.label, phase: z.cfg.phase,
      min: z.box.min.toArray(), max: z.box.max.toArray(), screws: z.cfg.screws, status: 'assumed' })),
    timeline: T,
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = 'station-config.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── 尺寸與繪製 ─────────────────────────────────
function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  view.aspect = w / h;
  const p = activePreset && PRESETS[activePreset];
  if (p && !p.cam && !tween) view.fov = fitFov(p.fov);
  view.updateProjectionMatrix();
  for (const p of pips) {
    const fw = p.frame.clientWidth, fh = p.frame.clientHeight;
    p.r.setSize(fw, fh, false);
    p.overlay.width = fw * Math.min(devicePixelRatio, 2);
    p.overlay.height = fh * Math.min(devicePixelRatio, 2);
  }
}
new ResizeObserver(resize).observe(viewport);
new ResizeObserver(resize).observe(pipStrip);
resize();

// 合成標註框：把 3D 物件投影成 2D 框，示範未來 YOLO 訓練資料的格式
const bboxTargets = [
  ...['L', 'R'].map((s) => ({ obj: station.tools[s].group, cls: 'tool', color: '#f2c230' })),
  ...['L', 'R'].map((s) => ({ obj: station.operators[s].group, cls: 'person', color: '#c7d2fe' })),
  { obj: station.tray, cls: 'tray', color: '#ff8a3d', skip: (c) => c.cfg.id !== 'RIGHT' },
];
function drawOverlay(p) {
  const ctx = p.overlay.getContext('2d');
  const W = p.overlay.width, H = p.overlay.height;
  ctx.clearRect(0, 0, W, H);
  if (!layerState.bbox) return;
  const s = W / 320;
  ctx.lineWidth = Math.max(1.5, 1.5 * s);
  ctx.font = `600 ${Math.round(10 * s)}px ui-monospace, monospace`;
  for (const b of bboxTargets) {
    if (b.skip && b.skip(p.c)) continue;
    if (b.obj === station.operators.L.group || b.obj === station.operators.R.group) if (!layerState.people) continue;
    const r = projectBox(b.obj, p.c.cam);
    if (!r || r.w * r.h < 0.0004) continue;
    ctx.strokeStyle = b.color;
    ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
    const tw = ctx.measureText(b.cls).width + 6 * s;
    ctx.fillStyle = b.color;
    ctx.fillRect(r.x * W, r.y * H - 13 * s, tw, 13 * s);
    ctx.fillStyle = '#0a0e14';
    ctx.fillText(b.cls, r.x * W + 3 * s, r.y * H - 3 * s);
  }
}

const clock = new THREE.Clock();
let frame = 0;
function loop() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (playing) {
    simT += dt * speed;
    if (simT > T.window) simT = 0;
  }
  applyTime(simT);

  if (tween) {
    tween.t = Math.min(tween.t + dt / 0.9, 1);
    const k = ease(tween.t);
    view.position.lerpVectors(tween.from.pos, tween.to.pos, k);
    controls.target.lerpVectors(tween.from.tgt, tween.to.tgt, k);
    view.fov = THREE.MathUtils.lerp(tween.from.fov, tween.to.fov, k);
    view.updateProjectionMatrix();
    if (tween.t >= 1) tween = null;
  }
  controls.update();

  for (const c of station.cameras) {
    c.frustum.visible = !c.frustum.userData.hiddenByPov;
    c.body.visible = !c.frustum.userData.hiddenByPov;
  }
  renderer.render(scene, view);
  labelRenderer.render(scene, view);

  // 子畫面隔幀更新，降低負擔；子畫面內不畫視錐與標註線
  if (frame++ % 2 === 0) {
    const vis = { f: station.layers.frustums.visible, d: station.layers.dims.visible };
    station.layers.frustums.visible = false;
    station.layers.dims.visible = false;
    scene.fog = null;
    for (const p of pips) {
      // 攝影機本體就在鏡頭前方，渲染自己的畫面時要先藏起來
      const was = p.c.body.visible;
      p.c.body.visible = false;
      p.r.render(scene, p.c.cam);
      p.c.body.visible = was;
      drawOverlay(p);
    }
    scene.fog = fog;
    station.layers.frustums.visible = vis.f;
    station.layers.dims.visible = vis.d;
  }
  requestAnimationFrame(loop);
}
loop();

// 使用者拖曳主視角時取消預設視角的高亮
controls.addEventListener('start', () => {
  tween = null;
  if (activePreset) $$('[data-preset]').forEach((b) => b.classList.remove('on'));
  station.cameras.forEach((c) => (c.frustum.userData.hiddenByPov = false));
  activePreset = null;
});

window.__station = { station, T, PHASE_COLOR };
