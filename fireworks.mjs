/** 花火の描画・音響・アニメーションの状態を管理する。 */
export function createFireworks(canvas, isSoundEnabled) {
  const fireworksCanvas = canvas;
  const fireworksCtx = canvas.getContext('2d');

  // ----------------------------------------------------
  // Special 機能：画面全体に打ち上がる大輪の花火エンジン
  // ----------------------------------------------------
  let fireworksRockets = [];
  let fireworksParticles = [];
  let fireworksAnimationId = null;
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
    if (!isSoundEnabled()) return; // 音声OFF設定時は鳴らさない

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
    fireworksRockets = [];
    fireworksParticles = [];
    fireworksCtx.clearRect(0, 0, fireworksCanvas.width, fireworksCanvas.height);
    fireworksCanvas.style.display = 'none';
  }

  // 画面クリックで花火をいつでも停止可能
  fireworksCanvas.addEventListener('click', stopFireworks);

  return { trigger: triggerFireworks, stop: stopFireworks };
}
