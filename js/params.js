// 場域參數：所有長度單位為公尺、時間為秒、角度為度。
// 座標系：Y 向上；車頭朝 +Z；+X 為車輛左側（站在車頭前面向車輛時的右手邊）。
// 地板（產線坑道底）y = 0，高台面 y = platform.height。
//
// 每個參數都標註來源與狀態：
//   confirmed — 訪綱中業主直接回答的數值
//   derived   — 由已確認數值推算
//   assumed   — 目前為合理假設，待業主或模型開發同事補充

export const SRC = {
  V2: '10/16 訪綱 2',
  V1: '10/07 訪綱',
  MD: 'Power Arena 會議筆記',
  ASM: '假設值',
};

const p = (v, unit, label, src, status, note = '') => ({ v, unit, label, src, status, note });

export const P = {
  // ── 高台與車輛 ─────────────────────────────
  platformHeight: p(1.42, 'm', '地板到高台面', SRC.V2, 'confirmed'),
  platformGap: p(1.69, 'm', '兩側高台間距', SRC.V2, 'confirmed'),
  platformWidth: p(0.9, 'm', '單側高台寬', SRC.ASM, 'assumed', '業主描述「僅一人可側向通行」'),
  platformLength: p(10.5, 'm', '高台長度', SRC.ASM, 'assumed'),
  bayWidth: p(1.935, 'm', '車頭引擎室寬', SRC.V2, 'confirmed'),
  tireOverlap: p(0.1225, 'm', '單側輪胎與高台重疊', SRC.V2, 'derived', '(1.935 − 1.69) ÷ 2'),
  vehicleLength: p(4.6, 'm', '車長', SRC.ASM, 'assumed'),
  wheelBase: p(2.8, 'm', '軸距', SRC.ASM, 'assumed'),
  tireClearance: p(0.03, 'm', '輪胎底距高台面', SRC.ASM, 'assumed', '車體由輸送載具支撐'),
  bayRimHeight: p(0.95, 'm', '引擎室開口上緣距高台面', SRC.ASM, 'assumed', '約作業員腰高'),
  operatorHeight: p(1.75, 'm', '作業員身高', SRC.V2, 'confirmed'),

  // ── 承盤 ─────────────────────────────────
  trayDrop: p(0.45, 'm', '承盤下降距離', SRC.V2, 'derived', '業主估 0.40–0.50 m'),
  trayDuration: p(4, 's', '承盤下降歷時', SRC.V2, 'confirmed', '目測約 4 秒'),
  trayControl: p('自動', '', '承盤控制方式', SRC.V2, 'confirmed', '依節拍自動，故障會全廠停線'),

  // ── 作業時序 ──────────────────────────────
  stationCycle: p(480, 's', '工站總作業時間', SRC.V1, 'confirmed', '車頭進站到車尾出站'),
  detectWindow: p(180, 's', 'AI 偵測範圍', SRC.V1, 'confirmed', '引擎腳與變速箱組裝'),
  phase1Duration: p(78, 's', '第一階段鎖附', SRC.V2, 'derived', '業主答 60–90 秒，取中間值'),
  phase2Duration: p(78, 's', '第二階段鎖附', SRC.V2, 'derived', '業主答 60–90 秒，取中間值'),
  checkpointLead: p(2, 's', '檢查點前完成緩衝', SRC.V1, 'confirmed', '實際秒數待技術人員確認'),

  // ── 攝影機（角度解讀為俯視方位角，見 README）──
  camFov: p(62, '°', '攝影機水平視角', SRC.ASM, 'assumed'),
  camAspect: p(16 / 9, '', '影像比例', SRC.ASM, 'assumed'),
};

// 三支攝影機。distance 為攝影機到觀測目標的直線距離；
// heightRef 指出 height 是相對哪個參考面量測。
export const CAMERAS = [
  {
    id: 'LEFT_UP',
    name: 'LEFT UP',
    color: 0x5ee06a,
    target: 'bayLeft',
    distance: p(2.5, 'm', '到引擎室左側', SRC.V2, 'confirmed', '2.45–2.55 m'),
    height: p(1.355, 'm', '高於引擎區', SRC.V2, 'confirmed'),
    bearing: p(77, '°', '角度', SRC.V2, 'confirmed'),
    heightRef: 'bayRim',
  },
  {
    id: 'RIGHT_UP',
    name: 'RIGHT UP',
    color: 0xf0b545,
    target: 'bayRight',
    distance: p(2.5, 'm', '到引擎室右側', SRC.V2, 'confirmed', '2.45–2.55 m'),
    height: p(1.377, 'm', '高於引擎區', SRC.V2, 'confirmed'),
    bearing: p(97, '°', '角度', SRC.V2, 'confirmed'),
    heightRef: 'bayRim',
  },
  {
    id: 'RIGHT',
    name: 'RIGHT',
    color: 0x4ea8ff,
    target: 'tray',
    distance: p(3.6, 'm', '到車體底部承盤', SRC.V2, 'confirmed', '3.5–3.7 m'),
    height: p(0.381, 'm', '高於作業高台', SRC.V2, 'confirmed'),
    bearing: p(114, '°', '角度', SRC.V2, 'confirmed'),
    heightRef: 'platform',
  },
];

// 鎖附區域（ROI）。PoC 的判定邏輯是「工具框與指定區域重疊」，不直接偵測螺絲。
// 位置與螺絲數量皆為假設，待模型開發同事現場說明後替換。
export const ZONES = [
  { id: 'Z1L', phase: 1, side: 'L', label: '左引擎腳', pos: [0.56, 0.62, 1.78], size: [0.26, 0.22, 0.26], screws: 3 },
  { id: 'Z1R', phase: 1, side: 'R', label: '右引擎腳', pos: [-0.56, 0.62, 1.78], size: [0.26, 0.22, 0.26], screws: 3 },
  { id: 'Z1T', phase: 1, side: 'L', label: '變速箱固定點', pos: [0.5, 0.48, 1.34], size: [0.24, 0.2, 0.24], screws: 2 },
  { id: 'Z2L', phase: 2, side: 'L', label: '車身固定點（左）', pos: [0.72, 0.3, 1.5], size: [0.2, 0.18, 0.5], screws: 2 },
  { id: 'Z2R', phase: 2, side: 'R', label: '車身固定點（右）', pos: [-0.72, 0.3, 1.5], size: [0.2, 0.18, 0.5], screws: 2 },
];
// ZONES 的 pos.y 以「高台面」為 0，載入時換算成世界座標。

export const PHASE_COLOR = { 1: 0xff8a3d, 2: 0x3dd6d0 };

// 依參數推算出的關鍵座標，場景與 UI 共用。
export function derive() {
  const H = P.platformHeight.v;
  const halfGap = P.platformGap.v / 2;
  const halfBay = P.bayWidth.v / 2;
  const tireBottom = H + P.tireClearance.v;
  const bayRim = H + P.bayRimHeight.v;
  const front = P.vehicleLength.v / 2;
  const bayZ = front - 0.62; // 引擎室中心
  const trayTop = tireBottom + 0.05; // 承盤撐起時的上緣
  return {
    H, halfGap, halfBay, tireBottom, bayRim, front, bayZ, trayTop,
    targets: {
      bayLeft: [halfBay - 0.42, bayRim - 0.25, bayZ],
      bayRight: [-(halfBay - 0.42), bayRim - 0.25, bayZ],
      tray: [0, trayTop, bayZ],
    },
  };
}

// 由「直線距離、垂直高度、俯視方位角」換算攝影機位置。
// 方位角從 +X（車輛左側）量起，朝 +Z（車頭前方）為正：90° 代表正對車頭。
export function cameraPose(cam, d = derive()) {
  const t = d.targets[cam.target];
  const refY = cam.heightRef === 'platform' ? d.H : d.bayRim;
  const camY = refY + cam.height.v;
  const dy = camY - t[1];
  const horiz = Math.sqrt(Math.max(cam.distance.v ** 2 - dy ** 2, 0.01));
  const a = (cam.bearing.v * Math.PI) / 180;
  return {
    position: [t[0] + horiz * Math.cos(a), camY, t[2] + horiz * Math.sin(a)],
    target: t,
  };
}
