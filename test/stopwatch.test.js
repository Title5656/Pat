const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createStopwatch } = require('../src/chat/stopwatch');

function stopwatchMessage(content, displayName = 'คุณมิน') {
  return {
    content,
    author: { bot: false, globalName: 'มิน', username: 'min' },
    member: { displayName },
  };
}

function createClock(startAt = 1_000_000) {
  let now = startAt;
  return {
    now: () => now,
    advance: (ms) => { now += ms; },
  };
}

test('starts a named timer that anyone can see', () => {
  const stopwatch = createStopwatch({ now: () => 0 });
  const started = stopwatch.tryHandle(stopwatchMessage('พิม เริ่มจับเวลา อ่านหนังสือ', 'แฟนหมา'));
  assert.match(started, /อ่านหนังสือ/);
  assert.match(started, /แฟนหมา/);

  const listed = stopwatch.tryHandle(stopwatchMessage('พิม ดูจับเวลา', 'คนอื่น'));
  assert.match(listed, /อ่านหนังสือ/);
  assert.match(listed, /แฟนหมา/);
});

test('auto-names unnamed timers with increasing run numbers that are never reused', () => {
  const stopwatch = createStopwatch({ now: () => 0 });
  assert.match(stopwatch.tryHandle(stopwatchMessage('พิม เริ่มจับเวลา')), /run 1/);
  stopwatch.tryHandle(stopwatchMessage('พิม เริ่มจับเวลา ทำธุระ'));
  assert.match(stopwatch.tryHandle(stopwatchMessage('พิม เริ่มจับเวลา')), /run 2/);

  assert.match(stopwatch.tryHandle(stopwatchMessage('พิม หยุดจับเวลา run 1')), /run 1/);
  assert.match(stopwatch.tryHandle(stopwatchMessage('พิม เริ่มจับเวลา')), /run 3/);
});

test('refuses to start a timer with a name that is already running and keeps the original clock', () => {
  const clock = createClock();
  const stopwatch = createStopwatch(clock);
  stopwatch.tryHandle(stopwatchMessage('พิม เริ่มจับเวลา อ่านหนังสือ'));
  clock.advance(60_000);

  const again = stopwatch.tryHandle(stopwatchMessage('พิม เริ่มจับเวลา อ่านหนังสือ'));
  assert.match(again, /อยู่แล้ว/);

  clock.advance(30_000);
  const stopped = stopwatch.tryHandle(stopwatchMessage('พิม หยุดจับเวลา อ่านหนังสือ'));
  assert.match(stopped, /1 นาที 30 วินาที/);
});

test('lets anyone stop a timer someone else started and reports the starter', () => {
  const stopwatch = createStopwatch({ now: () => 0 });
  stopwatch.tryHandle(stopwatchMessage('พิม เริ่มจับเวลา อ่านหนังสือ', 'แฟนหมา'));

  const stopped = stopwatch.tryHandle(stopwatchMessage('พิม หยุดจับเวลา อ่านหนังสือ', 'คนแปลกหน้า'));
  assert.match(stopped, /อ่านหนังสือ/);
  assert.match(stopped, /แฟนหมา/);

  assert.match(stopwatch.tryHandle(stopwatchMessage('พิม ดูจับเวลา')), /ยังไม่มี/);
});

test('stops the only running timer when no name is given', () => {
  const stopwatch = createStopwatch({ now: () => 0 });
  stopwatch.tryHandle(stopwatchMessage('พิม เริ่มจับเวลา อ่านหนังสือ', 'แฟนหมา'));

  const stopped = stopwatch.tryHandle(stopwatchMessage('พิม หยุดจับเวลา', 'คนอื่น'));
  assert.match(stopped, /อ่านหนังสือ/);
  assert.match(stopped, /แฟนหมา/);
});

test('asks which timer to stop when several are running and no name is given', () => {
  const stopwatch = createStopwatch({ now: () => 0 });
  stopwatch.tryHandle(stopwatchMessage('พิม เริ่มจับเวลา อ่านหนังสือ'));
  stopwatch.tryHandle(stopwatchMessage('พิม เริ่มจับเวลา เล่นเกม'));

  const asked = stopwatch.tryHandle(stopwatchMessage('พิม หยุดจับเวลา'));
  assert.match(asked, /อ่านหนังสือ/);
  assert.match(asked, /เล่นเกม/);

  const listed = stopwatch.tryHandle(stopwatchMessage('พิม ดูจับเวลา'));
  assert.match(listed, /อ่านหนังสือ/);
  assert.match(listed, /เล่นเกม/);
});

test('says there is nothing running when listing or stopping with no timers', () => {
  const stopwatch = createStopwatch({ now: () => 0 });
  assert.match(stopwatch.tryHandle(stopwatchMessage('พิม ดูจับเวลา')), /ยังไม่มี/);
  assert.match(stopwatch.tryHandle(stopwatchMessage('พิม หยุดจับเวลา')), /ยังไม่มี/);
});

test('says an unknown timer name is not running when stopping it', () => {
  const stopwatch = createStopwatch({ now: () => 0 });
  const reply = stopwatch.tryHandle(stopwatchMessage('พิม หยุดจับเวลา นอนละ'));
  assert.match(reply, /นอนละ/);
});

test('lists running timers with their starter and elapsed time', () => {
  const clock = createClock();
  const stopwatch = createStopwatch(clock);
  stopwatch.tryHandle(stopwatchMessage('พิม เริ่มจับเวลา อ่านหนังสือ', 'แฟนหมา'));
  clock.advance(65_000);

  const listed = stopwatch.tryHandle(stopwatchMessage('พิม ดูจับเวลา', 'คนอื่น'));
  assert.match(listed, /อ่านหนังสือ/);
  assert.match(listed, /แฟนหมา/);
  assert.match(listed, /1 นาที 5 วินาที/);
});

test('returns null for messages that are not stopwatch commands', () => {
  const stopwatch = createStopwatch({ now: () => 0 });
  for (const content of [
    'หวัดดี',
    'จับเวลาได้ยัง',
    'อยากให้พิมช่วยจับเวลาเวลานอนให้หน่อย',
    '',
    '   ',
  ]) {
    assert.equal(stopwatch.tryHandle(stopwatchMessage(content)), null);
  }
});

test('formats elapsed time in Thai units, omitting zero units', () => {
  const clock = createClock();
  const stopwatch = createStopwatch(clock);

  stopwatch.tryHandle(stopwatchMessage('พิม เริ่มจับเวลา หนึ่ง'));
  clock.advance(3_930_000);
  assert.match(stopwatch.tryHandle(stopwatchMessage('พิม หยุดจับเวลา หนึ่ง')), /1 ชั่วโมง 5 นาที 30 วินาที/);

  stopwatch.tryHandle(stopwatchMessage('พิม เริ่มจับเวลา สอง'));
  clock.advance(300_000);
  const minutes = stopwatch.tryHandle(stopwatchMessage('พิม หยุดจับเวลา สอง'));
  assert.match(minutes, /5 นาที/);
  assert.doesNotMatch(minutes, /วินาที/);

  stopwatch.tryHandle(stopwatchMessage('พิม เริ่มจับเวลา สาม'));
  clock.advance(30_000);
  assert.match(stopwatch.tryHandle(stopwatchMessage('พิม หยุดจับเวลา สาม')), /30 วินาที/);

  stopwatch.tryHandle(stopwatchMessage('พิม เริ่มจับเวลา สี่'));
  assert.match(stopwatch.tryHandle(stopwatchMessage('พิม หยุดจับเวลา สี่')), /ไม่ถึง 1 วินาที/);
});

test('matches commands with extra spaces, different case, and no space after the keyword', () => {
  const stopwatch = createStopwatch({ now: () => 0 });
  assert.match(stopwatch.tryHandle(stopwatchMessage('พิม เริ่มจับเวลา   Game ')), /Game/);
  assert.match(stopwatch.tryHandle(stopwatchMessage('พิม หยุด จับเวลา  game')), /Game/);
  assert.match(stopwatch.tryHandle(stopwatchMessage('ช่วยเริ่มจับเวลาทำการบ้าน')), /ทำการบ้าน/);

  const listed = stopwatch.tryHandle(stopwatchMessage('พิม จับเวลา'));
  assert.match(listed, /ทำการบ้าน/);
});
