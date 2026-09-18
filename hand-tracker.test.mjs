import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const workerSource = await readFile(new URL('./hand-tracker.worker.mjs', import.meta.url), 'utf8');
const origin = 'https://example.test/ToGangDDaKK/';

// Execute the real worker glue with a mocked MediaPipe runtime. These tests cover
// messaging, asset routing and frame ownership, not model recognition accuracy.
function fixture({revision = '?v=review123', source = workerSource, failure, create, result} = {}) {
  const calls = {imports: [], files: [], factories: [], frames: []};
  const messages = [];
  const recognizer = {
    recognizeForVideo(bitmap, timestamp) {
      calls.frames.push({bitmap, timestamp});
      if (failure === 'inference') throw new Error('private runtime diagnostics');
      return result ?? {gestures: [], landmarks: [], handedness: [], worldLandmarks: []};
    },
  };
  const context = vm.createContext({
    URL,
    self: {
      location: {href: `${origin}hand-tracker.worker.mjs${revision}`},
      postMessage: message => messages.push(structuredClone(message)),
    },
    importScripts(url) {
      calls.imports.push(url);
      if (failure === 'import') throw new Error('private loader diagnostics');
    },
    Vision: {
      FilesetResolver: {
        async forVisionTasks(base) {
          calls.files.push(base);
          if (failure === 'files') throw new Error('private WASM diagnostics');
          return {wasmLoaderPath: `${base}/vision_wasm_internal.js`, wasmBinaryPath: `${base}/vision_wasm_internal.wasm`};
        },
      },
      GestureRecognizer: {
        async createFromOptions(files, options) {
          calls.factories.push(structuredClone({files, options}));
          if (failure === 'model') throw new Error('private model diagnostics');
          return create ? create(recognizer) : recognizer;
        },
      },
    },
  });
  vm.runInContext(source, context, {filename: 'hand-tracker.worker.mjs'});
  return {calls, messages, send: data => context.self.onmessage({data})};
}

function bitmap() {
  return {closed: 0, close() { this.closed += 1; }};
}

test('worker initialization keeps runtime, WASM and model on the same project origin and revision', async () => {
  const worker = fixture();
  await worker.send({type: 'init', baseURL: 'https://untrusted.example/'});
  assert.deepEqual(worker.messages, [{type: 'ready'}]);
  assert.deepEqual(worker.calls.imports, [`${origin}vendor/mediapipe/vision_bundle.js?v=review123`]);
  assert.deepEqual(worker.calls.files, [`${origin}vendor/mediapipe/wasm`]);
  const {files, options} = worker.calls.factories[0];
  assert.equal(files.wasmLoaderPath, `${origin}vendor/mediapipe/wasm/vision_wasm_internal.js?v=review123`);
  assert.equal(files.wasmBinaryPath, `${origin}vendor/mediapipe/wasm/vision_wasm_internal.wasm?v=review123`);
  assert.equal(options.baseOptions.modelAssetPath, `${origin}vendor/mediapipe/gesture_recognizer.task?v=review123`);
  assert.equal(options.baseOptions.delegate, 'CPU');
  assert.equal(options.runningMode, 'VIDEO');
  assert.equal(options.numHands, 2, 'two hands must remain detectable so the motion controller can reject ambiguity');
});

test('a bundle path already revisioned by the static build receives exactly one current version', async () => {
  // The build adds a revision to local .js literals; the worker adds revisions
  // to the remaining binary assets. Exercise their shared URL boundary.
  const source = workerSource.replace("'./vendor/mediapipe/vision_bundle.js'", "'./vendor/mediapipe/vision_bundle.js?v=oldbuild'");
  assert.notEqual(source, workerSource);
  const worker = fixture({source});
  await worker.send({type: 'init'});
  const url = new URL(worker.calls.imports[0]);
  assert.deepEqual(url.searchParams.getAll('v'), ['review123']);
  assert.equal(url.search, '?v=review123');
});

test('unversioned local development resolves assets without a dangling query or external host', async () => {
  const worker = fixture({revision: ''});
  await worker.send({type: 'init'});
  const {files, options} = worker.calls.factories[0];
  for (const url of [...worker.calls.imports, files.wasmLoaderPath, files.wasmBinaryPath, options.baseOptions.modelAssetPath]) {
    assert.equal(new URL(url).origin, new URL(origin).origin);
    assert.equal(new URL(url).search, '');
    assert.ok(url.startsWith(`${origin}vendor/mediapipe/`));
  }
});

test('concurrent and repeated initialization creates only one recognizer', async () => {
  let complete;
  const worker = fixture({create: recognizer => new Promise(resolve => { complete = () => resolve(recognizer); })});
  const first = worker.send({type: 'init'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof complete, 'function');
  await worker.send({type: 'init'});
  assert.equal(worker.calls.factories.length, 1);
  assert.deepEqual(worker.messages, []);
  complete();
  await first;
  await worker.send({type: 'init'});
  assert.equal(worker.calls.factories.length, 1);
  assert.deepEqual(worker.messages, [{type: 'ready'}, {type: 'ready'}]);
});

test('successful inference forwards the frame timestamp and only gestures and landmarks, then closes the bitmap', async () => {
  const result = {gestures: [[{categoryName: 'Open_Palm', score: 0.95}]], landmarks: [[{x: 0.4, y: 0.5, z: 0}]], handedness: ['unused'], worldLandmarks: ['unused']};
  const worker = fixture({result});
  await worker.send({type: 'init'});
  const frame = bitmap();
  await worker.send({type: 'frame', bitmap: frame, timestamp: 1234.5});
  assert.equal(worker.calls.frames.length, 1);
  assert.equal(worker.calls.frames[0].bitmap, frame);
  assert.equal(worker.calls.frames[0].timestamp, 1234.5);
  assert.deepEqual(worker.messages[1], {type: 'result', timestamp: 1234.5, result: {gestures: result.gestures, landmarks: result.landmarks}});
  assert.equal(frame.closed, 1);
});

test('inference errors close the transferred bitmap and report a minimal error without raw diagnostics', async () => {
  const worker = fixture({failure: 'inference'});
  await worker.send({type: 'init'});
  const frame = bitmap();
  await worker.send({type: 'frame', bitmap: frame, timestamp: 50});
  assert.equal(frame.closed, 1);
  assert.deepEqual(worker.messages, [{type: 'ready'}, {type: 'error'}]);
});

test('frames arriving before initialization are released without invoking inference', async () => {
  const worker = fixture();
  const frame = bitmap();
  await worker.send({type: 'frame', bitmap: frame, timestamp: 50});
  assert.equal(frame.closed, 1);
  assert.deepEqual(worker.calls.frames, []);
  assert.deepEqual(worker.messages, []);
});

test('invalid frame timestamps and missing bitmaps cannot reach inference or leak a supplied bitmap', async () => {
  const worker = fixture();
  await worker.send({type: 'init'});
  for (const timestamp of [undefined, NaN, Infinity, '100']) {
    const frame = bitmap();
    await worker.send({type: 'frame', bitmap: frame, timestamp});
    assert.equal(frame.closed, 1);
  }
  await worker.send({type: 'frame', timestamp: 100});
  assert.deepEqual(worker.calls.frames, []);
  assert.deepEqual(worker.messages, [{type: 'ready'}]);
});

test('loader, WASM-resolution and model-initialization failures report errors and allow a fresh attempt', async () => {
  for (const failure of ['import', 'files', 'model']) {
    const worker = fixture({failure});
    await worker.send({type: 'init'});
    assert.deepEqual(worker.messages, [{type: 'error'}], failure);
    await worker.send({type: 'init'});
    assert.deepEqual(worker.messages, [{type: 'error'}, {type: 'error'}], `${failure} must reset the initialization lock`);
    assert.equal(worker.calls.imports.length, 2);
  }
});

test('both vendored WASM variants are structurally valid WebAssembly binaries', async () => {
  // Validation parses the real packaged binaries; it does not instantiate the
  // runtime, access a camera or establish model accuracy/performance.
  for (const name of ['vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.wasm']) {
    const bytes = await readFile(new URL(`./vendor/mediapipe/wasm/${name}`, import.meta.url));
    assert.equal(WebAssembly.validate(bytes), true, name);
  }
});

test('the packaged gesture task has a complete ZIP directory containing both required task bundles', async () => {
  const bytes = await readFile(new URL('./vendor/mediapipe/gesture_recognizer.task', import.meta.url));
  // MediaPipe aligns embedded tasks with a leading padding prefix, so use the
  // archive's explicit offsets instead of assuming a local header at byte zero.
  let end = -1;
  for (let position = bytes.length - 22; position >= Math.max(0, bytes.length - 65557); position -= 1) {
    if (bytes.readUInt32LE(position) === 0x06054b50 && position + 22 + bytes.readUInt16LE(position + 20) === bytes.length) {
      end = position;
      break;
    }
  }
  assert.ok(end >= 0, 'complete ZIP end-of-central-directory record');
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  let cursor = bytes.readUInt32LE(end + 16);
  assert.equal(cursor + directorySize, end, 'central directory fits the archive');
  const names = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50, 'central directory entry');
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    assert.equal(bytes.readUInt32LE(localOffset), 0x04034b50, 'referenced local file header exists');
    names.push(bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(cursor, end);
  assert.deepEqual(names.sort(), ['hand_gesture_recognizer.task', 'hand_landmarker.task']);
});
