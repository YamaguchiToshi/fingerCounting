import { evaluateFingers, CountStabilizer, CountdownTracker } from './counting.mjs';
import { createFireworks } from './fireworks.mjs';

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

// 安定化パラメータのデフォルト値
const DEFAULT_STABLE_FRAMES = 10;

// アプリケーション状態
let countMode = localStorage.getItem('fc_countMode') || 'fold'; // 'fold' (曲げてカウント) または 'extend' (立ててカウント)
let isVoiceEnabled = localStorage.getItem('fc_voiceEnabled') !== 'false'; // デフォルト true
let isSpecialEnabled = localStorage.getItem('fc_specialEnabled') === 'true'; // デフォルト false (off)
let stableFramesRequired = parseInt(localStorage.getItem('fc_stableFrames'), 10) || DEFAULT_STABLE_FRAMES;
let isDebugVisible = false;
let lastSpeechTime = 0;
const stabilizer = new CountStabilizer();
const countdown = new CountdownTracker();
const fireworks = createFireworks(fireworksCanvas, () => isVoiceEnabled);

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
    // モード切替後の判定を新しい候補からやり直す
    stabilizer.resetCandidate();
  });
});

// 音声設定の切り替え
settingVoiceCheckbox.addEventListener('change', (e) => {
  isVoiceEnabled = e.target.checked;
  localStorage.setItem('fc_voiceEnabled', isVoiceEnabled);
  if (!isVoiceEnabled && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  } else if (isVoiceEnabled && stabilizer.committedCount >= 0) {
    speakCount(stabilizer.committedCount, true);
  }
});

// 動作安定化（フレーム数）の調整
settingStableFramesSlider.addEventListener('input', (e) => {
  stableFramesRequired = parseInt(e.target.value, 10);
  updateStableFramesDisplay(stableFramesRequired);
  localStorage.setItem('fc_stableFrames', stableFramesRequired);
  // 新しい感度で連続フレーム数を数え直す
  stabilizer.resetCandidate(stabilizer.candidateCount);
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
    fireworks.stop();
    countdown.reset();
  }
});

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
 * 確定したカウント数を画面と音声に反映
 */
function commitNewCount(count) {
  // 1. カウント数字の更新と穏やかなアニメーション
  countDisplay.textContent = count;
  countDisplay.style.transform = 'scale(1.08)';
  setTimeout(() => {
    countDisplay.style.transform = 'scale(1)';
  }, 150);

  // 2. 丸い印（10個のドット）の点灯更新
  dots.forEach((dot, index) => {
    dot.classList.toggle('active', index < count);
  });

  // 3. 確定したタイミングで落ち着いて読み上げ
  if (stabilizer.isHandPresentCommitted) {
    speakCount(count);
  }

  // 4. Special機能：カウントダウン進捗のチェック
  if (isSpecialEnabled && countdown.update(count)) {
    fireworks.trigger();
  }
}

/**
 * UIの補助表示（ガイド文やバッジ）の更新
 */
function updateUIStatus(detectedHandsCount) {
  const isFoldMode = countMode === 'fold';
  const actionText = isFoldMode ? '指を折る' : '指を立てる';

  if (!stabilizer.isHandPresentCommitted || detectedHandsCount === 0) {
    statusBadge.textContent = '手を待機中';
    statusBadge.classList.remove('active');
    guideText.textContent = 'カメラに手をかざしてください';
    if (stabilizer.committedCount === 0) {
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
    if (countdown.active) {
      specialStatusText = `<span style="color:#16a34a; font-weight:bold;">カウントダウン中（次: ${countdown.expectedNextCount}本）</span>`;
    } else {
      specialStatusText = '<span style="color:#d97706;">10からの開始待機中</span>';
    }
  }

  let html = `
    <div style="background:#f1f5f9; padding:6px 8px; border-radius:6px; margin-bottom:8px; font-size:0.8rem;">
      <div>モード: <strong>${modeLabel}</strong></div>
      <div>Special: <strong>${specialStatusText}</strong></div>
      <div>生カウント: <strong>${rawTotalCount}本</strong></div>
      <div>安定判定: <strong>${stabilizer.candidateCount}本</strong> (${stabilizer.candidateFrameCount}/${stableFramesRequired} frame)</div>
      <div>確定表示: <strong style="color:#2563eb;">${stabilizer.committedCount}本</strong></div>
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
  const committed = stabilizer.update(rawTotalCount, detectedHandsCount, stableFramesRequired);
  if (committed !== null) {
    commitNewCount(committed);
  }

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
