/**
 * Finger Counting Prototype
 * - 両手対応（最大10本）
 * - 指を1本曲げる（折る）ごとにカウント+1
 * - カメラ映像は通常非表示（デバッグボタンで表示切替可能）
 */

// DOM 要素の取得
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('outputCanvas');
const canvasCtx = canvasElement.getContext('2d');
const countDisplay = document.getElementById('countDisplay');
const statusBadge = document.getElementById('statusBadge');
const guideText = document.getElementById('guideText');
const dots = document.querySelectorAll('.dot');
const debugPanel = document.getElementById('debugPanel');
const debugHandsList = document.getElementById('debugHandsList');

// 設定モーダル関連 DOM
const openSettingsBtn = document.getElementById('openSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const settingsModal = document.getElementById('settingsModal');
const modeFoldRadio = document.getElementById('modeFold');
const modeExtendRadio = document.getElementById('modeExtend');
const settingVoiceCheckbox = document.getElementById('settingVoice');
const settingDebugCheckbox = document.getElementById('settingDebug');
const settingSpecialCheckbox = document.getElementById('settingSpecial');
const settingStableFramesSlider = document.getElementById('settingStableFrames');
const stableFramesDisplay = document.getElementById('stableFramesDisplay');
const fireworksCanvas = document.getElementById('fireworksCanvas');
const fireworksCtx = fireworksCanvas.getContext('2d');

// 安定化パラメータのデフォルト値
const DEFAULT_STABLE_FRAMES = 10;

// アプリケーション状態
let countMode = localStorage.getItem('fc_countMode') || 'fold'; // 'fold' (曲げてカウント) または 'extend' (立ててカウント)
let isVoiceEnabled = localStorage.getItem('fc_voiceEnabled') !== 'false'; // デフォルト true
let isSpecialEnabled = localStorage.getItem('fc_specialEnabled') === 'true'; // デフォルト false (off)
let stableFramesRequired = parseInt(localStorage.getItem('fc_stableFrames'), 10) || DEFAULT_STABLE_FRAMES;
let isDebugVisible = false;
let lastDisplayedCount = -1;
let lastSpeechTime = 0;

// 表示ラベルの更新ヘルパー
function updateStableFramesDisplay(frames) {
  const sec = (frames / 30).toFixed(1);
  stableFramesDisplay.textContent = `${frames} フレーム (約${sec}秒)`;
}

// 設定UIの初期状態反映
if (countMode === 'extend') {
  modeExtendRadio.checked = true;
} else {
  modeFoldRadio.checked = true;
}
settingVoiceCheckbox.checked = isVoiceEnabled;
settingDebugCheckbox.checked = isDebugVisible;
settingSpecialCheckbox.checked = isSpecialEnabled;
settingStableFramesSlider.value = stableFramesRequired;
updateStableFramesDisplay(stableFramesRequired);

// 設定モーダルの開閉
openSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.remove('hidden');
});

closeSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    settingsModal.classList.add('hidden');
  }
});

// カウント方式の切り替え
document.querySelectorAll('input[name="countMode"]').forEach((radio) => {
  radio.addEventListener('change', (e) => {
    countMode = e.target.value;
    localStorage.setItem('fc_countMode', countMode);
    // モード切替時にスタビライザーをリセットして即座に判定更新
    candidateCount = -1;
    candidateFrameCount = 0;
  });
});

// 音声設定の切り替え
settingVoiceCheckbox.addEventListener('change', (e) => {
  isVoiceEnabled = e.target.checked;
  localStorage.setItem('fc_voiceEnabled', isVoiceEnabled);
  if (!isVoiceEnabled && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  } else if (isVoiceEnabled && committedCount >= 0) {
    speakCount(committedCount, true);
  }
});

// 動作安定化（フレーム数）の調整
settingStableFramesSlider.addEventListener('input', (e) => {
  stableFramesRequired = parseInt(e.target.value, 10);
  updateStableFramesDisplay(stableFramesRequired);
  localStorage.setItem('fc_stableFrames', stableFramesRequired);
  // スライダー変更時は即座に新しい感度で判定できるようフレームカウントをリセット
  candidateFrameCount = 0;
});

// デバッグ表示の切り替え
settingDebugCheckbox.addEventListener('change', (e) => {
  isDebugVisible = e.target.checked;
  if (isDebugVisible) {
    debugPanel.classList.remove('hidden');
  } else {
    debugPanel.classList.add('hidden');
  }
});

// Special（花火演出）設定の切り替え
settingSpecialCheckbox.addEventListener('change', (e) => {
  isSpecialEnabled = e.target.checked;
  localStorage.setItem('fc_specialEnabled', isSpecialEnabled);
  if (!isSpecialEnabled) {
    stopFireworks();
    countdownActive = false;
  }
});

// ----------------------------------------------------
// Special 機能：10から0へのスムーズなカウントダウン監視
// ----------------------------------------------------
let countdownActive = false;
let expectedNextCount = 10;
let lastCountdownStepTime = 0;
const COUNTDOWN_STEP_TIMEOUT_MS = 5000; // 各ステップの最大猶予時間（5秒）

function checkCountdown(newCount) {
  if (!isSpecialEnabled) return;

  const now = Date.now();

  // 10が確定した時点でカウントダウン監視スタート！
  if (newCount === 10) {
    countdownActive = true;
    expectedNextCount = 9;
    lastCountdownStepTime = now;
    return;
  }

  if (countdownActive) {
    // 猶予時間を超えたらカウントダウン失敗・リセット
    if (now - lastCountdownStepTime > COUNTDOWN_STEP_TIMEOUT_MS) {
      countdownActive = false;
      return;
    }

    // 順調に減っているか判定（ピッタリ一致、または1つ飛ばしまで許容）
    if (newCount <= expectedNextCount && newCount >= expectedNextCount - 1) {
      lastCountdownStepTime = now;
      if (newCount === 0) {
        // 見事 10 から 0 まで到達！大輪の花火発射！
        countdownActive = false;
        triggerFireworks();
      } else {
        expectedNextCount = newCount - 1;
      }
    } else if (newCount > expectedNextCount + 1) {
      // 途中で指が増えたら（逆戻り）カウントダウン失敗
      countdownActive = false;
    }
  }
}

// ----------------------------------------------------
// Special 機能：画面全体に打ち上がる大輪の花火エンジン
// ----------------------------------------------------
let fireworksRockets = [];
let fireworksParticles = [];
let fireworksAnimationId = null;
let isFireworksActive = false;
let fireworksEndTime = 0;
let nextLaunchTime = 0;

const FIREWORK_COLORS = [
  '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be',
  '#32ade6', '#007aff', '#5856d6', '#af52de', '#ff2d55',
  '#ffffff', '#ffd700', '#00ffff', '#ff1493'
];

function resizeFireworksCanvas() {
  fireworksCanvas.width = window.innerWidth;
  fireworksCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeFireworksCanvas);

class FireworkRocket {
  constructor(targetX, targetY) {
    this.x = targetX + (Math.random() * 80 - 40);
    this.y = fireworksCanvas.height + 10;
    this.targetY = targetY;
    this.speed = 14 + Math.random() * 6;
    this.color = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
    this.exploded = false;
  }

  update() {
    this.y -= this.speed;
    if (this.y <= this.targetY) {
      this.exploded = true;
      explodeFirework(this.x, this.y, this.color);
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.x, this.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.shadowBlur = 10;
    ctx.shadowColor = this.color;
    ctx.fill();
    ctx.restore();
  }
}

class FireworkParticle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.color = color;
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 7 + 2;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.gravity = 0.08;
    this.friction = 0.96;
    this.alpha = 1;
    this.decay = Math.random() * 0.015 + 0.01;
    this.size = Math.random() * 2.5 + 1.5;
  }

  update() {
    this.vx *= this.friction;
    this.vy *= this.friction;
    this.vy += this.gravity;
    this.x += this.vx;
    this.y += this.vy;
    this.alpha -= this.decay;
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.alpha);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.shadowBlur = 8;
    ctx.shadowColor = this.color;
    ctx.fill();
    ctx.restore();
  }
}

// ----------------------------------------------------
// Web Audio API：花火の炸裂（爆発）音シンセサイザー
// ----------------------------------------------------
let audioCtx = null;
let lastExplosionSoundTime = 0;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// ユーザー操作時にオーディオコンテキストをアンロック
document.addEventListener('click', () => {
  try {
    getAudioContext();
  } catch (e) {}
}, { once: true });

/**
 * 花火の重低音炸裂音（ドォーーン！）を動的に合成再生
 */
function playExplosionSound() {
  if (!isVoiceEnabled) return; // 音声OFF設定時は鳴らさない

  const nowMs = Date.now();
  // 連続で炸裂した時に音が破綻しないよう最低70msの間隔を確保
  if (nowMs - lastExplosionSoundTime < 70) return;
  lastExplosionSoundTime = nowMs;

  try {
    const ctx = getAudioContext();
    const t = ctx.currentTime;

    // 1. ノイズ生成（爆発の衝撃音と尾を引く破裂音）
    const duration = 0.8;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    // ローパスフィルターで腹に響く重低音（400Hz → 30Hz）へ急降下
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320 + Math.random() * 100, t);
    filter.frequency.exponentialRampToValueAtTime(35, t + duration);

    // ノイズ音量エンベロープ（減衰）
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.55, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    whiteNoise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    // 2. サブベースオシレーター（ズドォンという重低音のパンチ）
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(115 + Math.random() * 20, t);
    osc.frequency.exponentialRampToValueAtTime(25, t + 0.45);

    oscGain.gain.setValueAtTime(0.65, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

    osc.connect(oscGain);
    oscGain.connect(ctx.destination);

    // 再生
    whiteNoise.start(t);
    osc.start(t);
    osc.stop(t + 0.45);
    whiteNoise.stop(t + duration);
  } catch (err) {
    // 再生環境によるエラーは静かに抑制
  }
}

function explodeFirework(x, y, color) {
  // 炸裂音を再生
  playExplosionSound();

  const particleCount = 70 + Math.floor(Math.random() * 30);
  for (let i = 0; i < particleCount; i++) {
    fireworksParticles.push(new FireworkParticle(x, y, color));
  }
}

function loopFireworks() {
  const now = Date.now();

  // 残像トレイルを描画しながらフェード
  fireworksCtx.fillStyle = 'rgba(15, 23, 42, 0.2)';
  fireworksCtx.fillRect(0, 0, fireworksCanvas.width, fireworksCanvas.height);

  // 期間中は所狭しと連続してロケットを発射
  if (now < fireworksEndTime) {
    if (now >= nextLaunchTime) {
      // 一度に2〜4発を画面の様々な位置へ打ち上げ
      const burstCount = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < burstCount; i++) {
        const tx = Math.random() * (fireworksCanvas.width * 0.8) + fireworksCanvas.width * 0.1;
        const ty = Math.random() * (fireworksCanvas.height * 0.5) + fireworksCanvas.height * 0.1;
        fireworksRockets.push(new FireworkRocket(tx, ty));
      }
      nextLaunchTime = now + 250 + Math.random() * 200; // 0.25〜0.45秒ごとにドンドン発射
    }
  }

  // ロケットの更新・描画
  fireworksRockets = fireworksRockets.filter(r => !r.exploded);
  fireworksRockets.forEach(r => {
    r.update();
    r.draw(fireworksCtx);
  });

  // パーティクルの更新・描画
  fireworksParticles = fireworksParticles.filter(p => p.alpha > 0);
  fireworksParticles.forEach(p => {
    p.update();
    p.draw(fireworksCtx);
  });

  // 終了判定（発射時間が過ぎ、パーティクルも燃え尽きたら完了）
  if (now >= fireworksEndTime && fireworksRockets.length === 0 && fireworksParticles.length === 0) {
    stopFireworks();
    return;
  }

  fireworksAnimationId = requestAnimationFrame(loopFireworks);
}

function triggerFireworks() {
  resizeFireworksCanvas();
  fireworksCanvas.style.display = 'block';
  isFireworksActive = true;
  fireworksEndTime = Date.now() + 6500; // 6.5秒間豪華に打ち上げ続ける
  nextLaunchTime = 0;
  fireworksRockets = [];
  fireworksParticles = [];

  // 初回の一斉打ち上げ
  for (let i = 0; i < 4; i++) {
    const tx = Math.random() * (fireworksCanvas.width * 0.8) + fireworksCanvas.width * 0.1;
    const ty = Math.random() * (fireworksCanvas.height * 0.45) + fireworksCanvas.height * 0.1;
    fireworksRockets.push(new FireworkRocket(tx, ty));
  }

  if (fireworksAnimationId) {
    cancelAnimationFrame(fireworksAnimationId);
  }
  loopFireworks();
}

function stopFireworks() {
  if (fireworksAnimationId) {
    cancelAnimationFrame(fireworksAnimationId);
    fireworksAnimationId = null;
  }
  isFireworksActive = false;
  fireworksRockets = [];
  fireworksParticles = [];
  fireworksCtx.clearRect(0, 0, fireworksCanvas.width, fireworksCanvas.height);
  fireworksCanvas.style.display = 'none';
}

// 画面クリックで花火をいつでも停止可能
fireworksCanvas.addEventListener('click', stopFireworks);

/**
 * カウント数を日本語音声で読み上げ
 */
function speakCount(count, force = false) {
  if (!isVoiceEnabled || !('speechSynthesis' in window)) return;
  if (count < 0) return;

  const now = Date.now();
  if (!force && now - lastSpeechTime < 200) return;
  lastSpeechTime = now;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(String(count));
  utterance.lang = 'ja-JP';
  utterance.rate = 1.3;
  utterance.pitch = 1.0;
  window.speechSynthesis.speak(utterance);
}

/**
 * 2点間のユークリッド距離を計算
 */
function getDistance(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  const dz = (p1.z || 0) - (p2.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * 1つの手について、各指が「折られている（曲げられている）」かを判定
 * わずかな手の角度ブレで境界値を行き来しないよう、マージン（遊び）を設けて判定
 * @param {Array} landmarks - 21個のランドマーク配列
 * @param {Object} handedness - 'Left' または 'Right'
 * @returns {Object} 各指の折り状態 { thumb, index, middle, ring, pinky, foldedCount }
 */
function evaluateFingers(landmarks, handedness) {
  const wrist = landmarks[0];

  // 1. 人差し指、中指、薬指、小指の曲げ判定
  // 指先(TIP)と手首(WRIST)の距離が第2関節(PIP)より短い場合は「曲げている」
  const isIndexFolded = getDistance(landmarks[8], wrist) < getDistance(landmarks[6], wrist);
  const isMiddleFolded = getDistance(landmarks[12], wrist) < getDistance(landmarks[10], wrist);
  const isRingFolded = getDistance(landmarks[16], wrist) < getDistance(landmarks[14], wrist);
  const isPinkyFolded = getDistance(landmarks[20], wrist) < getDistance(landmarks[18], wrist);

  // 2. 親指の曲げ判定
  // 親指を手のひらに折り込んだ時、親指先(4)が小指付け根(17)に近づく
  const thumbTipToPinkyMcp = getDistance(landmarks[4], landmarks[17]);
  const thumbIpToPinkyMcp = getDistance(landmarks[3], landmarks[17]);
  const isThumbFolded = thumbTipToPinkyMcp < thumbIpToPinkyMcp;

  const states = {
    thumb: isThumbFolded,
    index: isIndexFolded,
    middle: isMiddleFolded,
    ring: isRingFolded,
    pinky: isPinkyFolded
  };

  let foldedCount = 0;
  if (isThumbFolded) foldedCount++;
  if (isIndexFolded) foldedCount++;
  if (isMiddleFolded) foldedCount++;
  if (isRingFolded) foldedCount++;
  if (isPinkyFolded) foldedCount++;

  const extendedCount = 5 - foldedCount;

  return { ...states, foldedCount, extendedCount, label: handedness?.label || 'Hand' };
}

// ----------------------------------------------------
// 動作安定化（スタビライザー）の管理変数
// ----------------------------------------------------
// 手が画面から外れたと判定するまでの猶予フレーム（一瞬の見切れでリセットしない）
const HAND_LOST_FRAMES_REQUIRED = 12;

let committedCount = 0;         // 画面表示・読み上げが確定した本数
let candidateCount = 0;         // 現在検出されている本数候補
let candidateFrameCount = 0;    // その候補が連続して続いたフレーム数
let noHandFrameCount = 0;       // 手が検出されないフレーム数
let isHandPresentCommitted = false; // 手が安定して存在しているか

/**
 * 安定化フィルタ処理
 * 指の本数が変わっても、指定フレーム（デフォルト約300ms）安定して維持されるまで表示と読み上げを更新しない
 */
function processStabilizedCount(rawCount, detectedHandsCount) {
  // 手の検出状態の管理（見切れによる一瞬の消滅を防ぐ）
  if (detectedHandsCount > 0) {
    noHandFrameCount = 0;
    isHandPresentCommitted = true;
  } else {
    noHandFrameCount++;
    if (noHandFrameCount >= HAND_LOST_FRAMES_REQUIRED) {
      isHandPresentCommitted = false;
      candidateCount = 0;
      candidateFrameCount = 0;
      if (committedCount !== 0) {
        committedCount = 0;
        commitNewCount(0, 0);
      }
      return;
    }
  }

  // 手が認識されていない場合は待機
  if (!isHandPresentCommitted) {
    return;
  }

  // 検出されたカウント値の安定性チェック
  if (rawCount === candidateCount) {
    candidateFrameCount++;
  } else {
    // 別の本数が検出されたら候補を更新してフレームカウントをリセット
    candidateCount = rawCount;
    candidateFrameCount = 1;
  }

  // 候補本数が設定されたフレーム数安定して維持された場合のみ確定反映
  if (candidateFrameCount >= stableFramesRequired) {
    if (candidateCount !== committedCount) {
      committedCount = candidateCount;
      commitNewCount(committedCount, detectedHandsCount);
    }
  }
}

/**
 * 確定したカウント数を画面と音声に反映
 */
function commitNewCount(count, detectedHandsCount) {
  // 1. カウント数字の更新と穏やかなアニメーション
  countDisplay.textContent = count;
  countDisplay.style.transform = 'scale(1.08)';
  setTimeout(() => {
    countDisplay.style.transform = 'scale(1)';
  }, 150);

  // 2. 丸い印（10個のドット）の点灯更新
  dots.forEach((dot, index) => {
    if (index < count) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });

  // 3. 確定したタイミングで落ち着いて読み上げ
  if (isHandPresentCommitted) {
    speakCount(count);
  }

  // 4. Special機能：カウントダウン進捗のチェック
  checkCountdown(count);
}

/**
 * UIの補助表示（ガイド文やバッジ）の更新
 */
function updateUIStatus(detectedHandsCount) {
  const isFoldMode = countMode === 'fold';
  const actionText = isFoldMode ? '指を折る' : '指を立てる';

  if (!isHandPresentCommitted || detectedHandsCount === 0) {
    statusBadge.textContent = '手を待機中';
    statusBadge.classList.remove('active');
    guideText.textContent = 'カメラに手をかざしてください';
    if (committedCount === 0) {
      countDisplay.textContent = '0';
      dots.forEach(dot => dot.classList.remove('active'));
    }
  } else if (detectedHandsCount === 1) {
    statusBadge.textContent = '片手を認識中 (0〜5)';
    statusBadge.classList.add('active');
    guideText.textContent = `${actionText}とカウントが増えます（両手も使えます）`;
  } else {
    statusBadge.textContent = '両手を認識中 (0〜10)';
    statusBadge.classList.add('active');
    guideText.textContent = `${actionText}とカウントが増えます`;
  }
}

/**
 * デバッグパネル情報の更新
 */
function updateDebugInfo(handsData, rawTotalCount) {
  if (!isDebugVisible) return;

  if (!handsData || handsData.length === 0) {
    debugHandsList.innerHTML = '<span style="color:#94a3b8;">手が検出されていません</span>';
    return;
  }

  const modeLabel = countMode === 'extend' ? '指立てカウント' : '指折りカウント';

  let specialStatusText = 'OFF';
  if (isSpecialEnabled) {
    if (countdownActive) {
      specialStatusText = `<span style="color:#16a34a; font-weight:bold;">カウントダウン中（次: ${expectedNextCount}本）</span>`;
    } else {
      specialStatusText = '<span style="color:#d97706;">10からの開始待機中</span>';
    }
  }

  let html = `
    <div style="background:#f1f5f9; padding:6px 8px; border-radius:6px; margin-bottom:8px; font-size:0.8rem;">
      <div>モード: <strong>${modeLabel}</strong></div>
      <div>Special: <strong>${specialStatusText}</strong></div>
      <div>生カウント: <strong>${rawTotalCount}本</strong></div>
      <div>安定判定: <strong>${candidateCount}本</strong> (${candidateFrameCount}/${stableFramesRequired} frame)</div>
      <div>確定表示: <strong style="color:#2563eb;">${committedCount}本</strong></div>
    </div>
  `;

  handsData.forEach((hand, idx) => {
    const handLabel = hand.label === 'Left' ? '左手' : '右手';
    html += `
      <div style="margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px dashed #e2e8f0;">
        <strong>手 ${idx + 1} (${handLabel})</strong>: カウント ${hand.activeCount}本 (折:${hand.foldedCount} / 立:${hand.extendedCount})<br>
        <span class="finger-tag ${hand.thumb ? 'folded' : ''}">親指: ${hand.thumb ? '折' : '伸'}</span>
        <span class="finger-tag ${hand.index ? 'folded' : ''}">人差: ${hand.index ? '折' : '伸'}</span>
        <span class="finger-tag ${hand.middle ? 'folded' : ''}">中指: ${hand.middle ? '折' : '伸'}</span>
        <span class="finger-tag ${hand.ring ? 'folded' : ''}">薬指: ${hand.ring ? '折' : '伸'}</span>
        <span class="finger-tag ${hand.pinky ? 'folded' : ''}">小指: ${hand.pinky ? '折' : '伸'}</span>
      </div>
    `;
  });
  debugHandsList.innerHTML = html;
}

/**
 * MediaPipe Hands からのフレーム毎の結果処理コールバック
 */
function onResults(results) {
  // デバッグモード時はキャンバスに骨格を描画
  if (isDebugVisible) {
    canvasElement.width = videoElement.videoWidth || 640;
    canvasElement.height = videoElement.videoHeight || 480;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks) {
      for (const landmarks of results.multiHandLandmarks) {
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#3b82f6', lineWidth: 3 });
        drawLandmarks(canvasCtx, landmarks, { color: '#ef4444', lineWidth: 1, radius: 4 });
      }
    }
    canvasCtx.restore();
  }

  let rawTotalCount = 0;
  const handsData = [];
  const detectedHandsCount = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;

  if (detectedHandsCount > 0) {
    for (let i = 0; i < results.multiHandLandmarks.length; i++) {
      const landmarks = results.multiHandLandmarks[i];
      const handedness = results.multiHandedness ? results.multiHandedness[i] : null;

      const evalResult = evaluateFingers(landmarks, handedness);
      const handCount = countMode === 'extend' ? evalResult.extendedCount : evalResult.foldedCount;
      rawTotalCount += handCount;
      handsData.push({ ...evalResult, activeCount: handCount });
    }
  }

  // 安定化スタビライザー処理（一定フレーム安定した時だけ確定・読み上げ）
  processStabilizedCount(rawTotalCount, detectedHandsCount);

  // ガイド・ステータス表示の更新
  updateUIStatus(detectedHandsCount);

  // デバッグ情報の更新
  updateDebugInfo(handsData, rawTotalCount);
}

// MediaPipe Hands の初期化
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 2, // 両手対応
  modelComplexity: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6
});

hands.onResults(onResults);

// Webカメラの起動とフレーム送信
const camera = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({ image: videoElement });
  },
  width: 640,
  height: 480
});

// アプリの起動開始
statusBadge.textContent = 'カメラ初期化中...';
camera.start()
  .then(() => {
    statusBadge.textContent = 'カメラ準備完了';
  })
  .catch((err) => {
    console.error('カメラ起動エラー:', err);
    statusBadge.textContent = 'カメラへのアクセスが拒否されました';
    statusBadge.style.backgroundColor = '#fee2e2';
    statusBadge.style.color = '#b91c1c';
    guideText.textContent = 'ブラウザのカメラ使用許可を確認してください';
  });
