import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateFingers, CountStabilizer, CountdownTracker } from '../counting.mjs';

// 各指の状態を独立して指定した 21 点のランドマーク。
function makeLandmarks(mask) {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  points[17] = { x: 1, y: 0 };
  points[3] = { x: 1, y: 1 };
  points[4] = { x: 1, y: mask & 1 ? 0.5 : 2 };
  [[8, 6], [12, 10], [16, 14], [20, 18]].forEach(([tip, pip], index) => {
    points[pip] = { x: 0, y: 1 };
    points[tip] = { x: 0, y: mask & (1 << (index + 1)) ? 0.5 : 2 };
  });
  return points;
}

function feed(stabilizer, count, frames, required = 10, hands = 1) {
  return Array.from({ length: frames }, () => stabilizer.update(count, hands, required));
}

test('指の全 32 通りの組み合わせと左右の分類', () => {
  const fingers = ['thumb', 'index', 'middle', 'ring', 'pinky'];
  for (let mask = 0; mask < 32; mask++) {
    for (const label of ['Left', 'Right']) {
      const result = evaluateFingers(makeLandmarks(mask), { label });
      const folded = fingers.filter((finger, index) => {
        assert.equal(result[finger], Boolean(mask & (1 << index)));
        return result[finger];
      }).length;
      assert.equal(result.foldedCount, folded);
      assert.equal(result.extendedCount, 5 - folded);
      assert.equal(result.label, label);
    }
  }
  assert.equal(evaluateFingers(makeLandmarks(0)).label, 'Hand');
});

test('距離が等しい場合は伸びた指として扱い、z 座標も判定に使う', () => {
  const points = makeLandmarks(0);
  points[8] = { ...points[6] };
  assert.equal(evaluateFingers(points).index, false);
  points[6].z = 3;
  assert.equal(evaluateFingers(points).index, true);
});

test('指定フレーム数を満たすまで確定せず、同じ値の再通知もしない', () => {
  const stabilizer = new CountStabilizer();
  assert.deepEqual(feed(stabilizer, 7, 9), Array(9).fill(null));
  assert.equal(stabilizer.update(7, 2, 10), 7);
  assert.deepEqual(feed(stabilizer, 7, 15), Array(15).fill(null));
  assert.equal(stabilizer.committedCount, 7);
});

test('候補値が揺れると連続フレームの判定をやり直す', () => {
  const stabilizer = new CountStabilizer();
  feed(stabilizer, 2, 9);
  assert.equal(stabilizer.update(3, 1, 10), null);
  assert.deepEqual(feed(stabilizer, 2, 9), Array(9).fill(null));
  assert.equal(stabilizer.update(2, 1, 10), 2);
});

test('手の初回検出前にはカウントを確定しない', () => {
  const stabilizer = new CountStabilizer();
  assert.deepEqual(feed(stabilizer, 0, 20, 10, 0), Array(20).fill(null));
  assert.equal(stabilizer.isHandPresentCommitted, false);
});

test('短い見切れから復帰でき、12 フレームの見失いで待機状態に戻る', () => {
  const stabilizer = new CountStabilizer();
  feed(stabilizer, 5, 10);
  assert.deepEqual(feed(stabilizer, 0, 4, 25, 0), Array(4).fill(null));
  assert.equal(stabilizer.isHandPresentCommitted, true);
  assert.equal(stabilizer.update(5, 1, 25), null);
  assert.equal(stabilizer.noHandFrameCount, 0);
  assert.deepEqual(feed(stabilizer, 0, 11, 25, 0), Array(11).fill(null));
  assert.equal(stabilizer.update(0, 0, 25), 0);
  assert.equal(stabilizer.isHandPresentCommitted, false);
  assert.equal(stabilizer.update(0, 0, 25), null);
});

test('見失い猶予中も従来どおり 0 の安定化判定を行う', () => {
  const stabilizer = new CountStabilizer();
  feed(stabilizer, 5, 10);
  feed(stabilizer, 0, 9, 10, 0);
  assert.equal(stabilizer.update(0, 0, 10), 0);
  assert.equal(stabilizer.isHandPresentCommitted, true);
});

test('モードや感度の変更時に候補の判定をリセットできる', () => {
  const stabilizer = new CountStabilizer();
  feed(stabilizer, 3, 8);
  stabilizer.resetCandidate();
  assert.equal(stabilizer.candidateCount, -1);
  assert.equal(stabilizer.candidateFrameCount, 0);
  feed(stabilizer, 3, 2, 3);
  stabilizer.resetCandidate(stabilizer.candidateCount);
  assert.equal(stabilizer.candidateCount, 3);
  assert.equal(stabilizer.candidateFrameCount, 0);
  assert.deepEqual(feed(stabilizer, 3, 3, 3), [null, null, 3]);
});

test('カウントダウンは 10 から開始し、0 への到達を一度だけ通知する', () => {
  const tracker = new CountdownTracker();
  assert.equal(tracker.update(5, 0), false);
  for (let count = 10; count > 0; count--) {
    assert.equal(tracker.update(count, (10 - count) * 1000), false);
  }
  assert.equal(tracker.update(0, 10000), true);
  assert.equal(tracker.active, false);
  assert.equal(tracker.update(0, 11000), false);
});

test('カウントダウンでは 1 本飛ばしを許容する', () => {
  const tracker = new CountdownTracker();
  for (const count of [10, 8, 6, 4, 2]) {
    assert.equal(tracker.update(count, 0), false);
  }
  assert.equal(tracker.update(0, 0), true);
});

test('各ステップの猶予は 5000ms までで、超えると終了する', () => {
  const tracker = new CountdownTracker();
  tracker.update(10, 0);
  tracker.update(9, 5000);
  assert.equal(tracker.active, true);
  assert.equal(tracker.update(8, 10001), false);
  assert.equal(tracker.active, false);
});

test('逆戻りで中断し、10 で再開でき、明示的にも解除できる', () => {
  const tracker = new CountdownTracker();
  tracker.update(10, 0);
  tracker.update(8, 100);
  tracker.update(9, 200);
  assert.equal(tracker.active, false);
  tracker.update(10, 300);
  assert.equal(tracker.active, true);
  assert.equal(tracker.expectedNextCount, 9);
  tracker.reset();
  assert.equal(tracker.active, false);
});
