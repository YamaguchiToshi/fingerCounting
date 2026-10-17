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
 * @param {Array} landmarks - 21個のランドマーク配列
 * @param {Object} handedness - label に 'Left' または 'Right' を持つ分類結果
 * @returns {Object} 各指の折り状態 { thumb, index, middle, ring, pinky, foldedCount }
 */
export function evaluateFingers(landmarks, handedness) {
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

  const foldedCount = Object.values(states).filter(Boolean).length;

  const extendedCount = 5 - foldedCount;

  return { ...states, foldedCount, extendedCount, label: handedness?.label || 'Hand' };
}

// 手を見失ってから待機状態に戻るまでの猶予フレーム数。
const HAND_LOST_FRAMES_REQUIRED = 12;

/** カウントの安定化を管理する。DOM や音声への反映は呼び出し元が行う。 */
export class CountStabilizer {
  committedCount = 0;
  candidateCount = 0;
  candidateFrameCount = 0;
  noHandFrameCount = 0;
  isHandPresentCommitted = false;

  resetCandidate(count = -1) {
    this.candidateCount = count;
    this.candidateFrameCount = 0;
  }

  /** @returns {number|null} 新しく確定したカウント。変更がなければ null。 */
  update(rawCount, detectedHandsCount, stableFramesRequired) {
    // 手の検出状態の管理（見切れによる一瞬の消滅を防ぐ）
    if (detectedHandsCount > 0) {
      this.noHandFrameCount = 0;
      this.isHandPresentCommitted = true;
    } else {
      this.noHandFrameCount++;
      if (this.noHandFrameCount >= HAND_LOST_FRAMES_REQUIRED) {
        this.isHandPresentCommitted = false;
        this.candidateCount = 0;
        this.candidateFrameCount = 0;
        if (this.committedCount !== 0) {
          this.committedCount = 0;
          return 0;
        }
        return null;
      }
    }

    // 手が認識されていない場合は待機
    if (!this.isHandPresentCommitted) {
      return null;
    }

    // 検出されたカウント値の安定性チェック
    if (rawCount === this.candidateCount) {
      this.candidateFrameCount++;
    } else {
      // 別の本数が検出されたら候補を更新してフレームカウントをリセット
      this.candidateCount = rawCount;
      this.candidateFrameCount = 1;
    }

    // 候補本数が設定されたフレーム数安定して維持された場合のみ確定反映
    if (this.candidateFrameCount >= stableFramesRequired) {
      if (this.candidateCount !== this.committedCount) {
        this.committedCount = this.candidateCount;
        return this.committedCount;
      }
    }
    return null;
  }
}

const COUNTDOWN_STEP_TIMEOUT_MS = 5000;

/** 10 から 0 へのカウントダウンを追跡する（1 本の飛ばしまで許容）。 */
export class CountdownTracker {
  active = false;
  expectedNextCount = 10;
  lastStepTime = 0;

  reset() {
    this.active = false;
  }

  /** @returns {boolean} カウントダウンが完了したときだけ true。 */
  update(count, now = Date.now()) {
    if (count === 10) {
      this.active = true;
      this.expectedNextCount = 9;
      this.lastStepTime = now;
      return false;
    }

    if (!this.active) return false;

    if (now - this.lastStepTime > COUNTDOWN_STEP_TIMEOUT_MS) {
      this.reset();
      return false;
    }

    if (count <= this.expectedNextCount && count >= this.expectedNextCount - 1) {
      this.lastStepTime = now;
      if (count === 0) {
        this.reset();
        return true;
      }
      this.expectedNextCount = count - 1;
    } else if (count > this.expectedNextCount + 1) {
      this.reset();
    }
    return false;
  }
}
