# MediaPipe hand gesture runtime

Retrieved and checked on 2026-09-18. These are unmodified upstream runtime/model assets. LAND:15 loads them from its own origin only after the user starts hand controls. Camera frames are processed in a local browser worker; these files do not require a hosted recognition service or an API key.

## JavaScript and WebAssembly

- Project: [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe).
- Package: `@mediapipe/tasks-vision`, pinned release **1.0.1** (npm `latest` on the retrieval date, published 2026-07-31). A nightly/RC release was not selected.
- Registry metadata: <https://registry.npmjs.org/@mediapipe%2ftasks-vision/1.0.1>.
- Exact downloaded archive: <https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.0.1.tgz>.
- Archive SHA-512 integrity, verified against the registry before extracting: `sha512-rvRE2FmAZ6ZxKSw7wq+e+jQDpN3t1B/tD2mJz9SmAzb1msoDkd4dMoE4wAh8Z30Um0PQwLiHr9QtomhmXk3aUQ==`.
- Archive SHA-256: `ee318eaa3d42230aa10910d114faf2a488c577c4e4d33c7cb04126924aca505f`.
- No package install hooks or downloaded application code were executed. Only the browser IIFE bundle and its SIMD/no-SIMD WASM pairs were retained. Source maps, type declarations, CommonJS/ESM bundles, and the unused module-worker WASM pair are omitted.

The classic worker imports `vision_bundle.js`, which exposes the `Vision` global. `Vision.FilesetResolver.forVisionTasks(wasmBaseURL)` detects SIMD support and selects `vision_wasm_internal` or `vision_wasm_nosimd_internal`. Both corresponding `.js` and `.wasm` files must retain their upstream names. Exactly one pair is fetched in a browser session. The runtime and model transfer is approximately 20.6 MB with SIMD (19.8 MB without SIMD), before HTTP compression.

The official [Web guide](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer/web_js) documents `GestureRecognizer.createFromOptions`, `runningMode: 'VIDEO'`, and the synchronous `recognizeForVideo(image, timestampMs)` API. Worker execution keeps that synchronous inference off the map's main thread. The official [worker example](https://github.com/google-ai-edge/mediapipe-samples-web/blob/bbb8974ffd450650ad5a1e7c1656c9debb8e38bf/src/workers/gesture-recognizer.worker.ts) also transfers an `ImageBitmap` and closes it after inference. LAND:15's worker/controller are original integration code, not copies of the sample application.

## Gesture model

- Official model: Gesture Recognizer / HandGestureClassifier, float16, revision **1**.
- Exact immutable-revision URL: <https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task>.
- Referenced by the official [sample configuration](https://github.com/google-ai-edge/mediapipe-samples-web/blob/bbb8974ffd450650ad5a1e7c1656c9debb8e38bf/src/tasks/gesture-recognizer.ts).
- Google storage generation: `1682480002665893`; Last-Modified: `2023-04-26 03:33:22 UTC`; ETag: `4dbf485c473207651100a1895343f35a`.
- [Model overview](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer/index) and [model card](https://storage.googleapis.com/mediapipe-assets/gesture_recognizer/model_card_hand_gesture_classification_with_faireness_2022.pdf).

This bundle contains palm detection, 21-point hand landmarks, a gesture embedding model, and a classifier for the predefined hand poses. It is not a sign-language translator. Lighting, motion blur, occlusion, and camera position affect recognition. A result's score describes the hand-pose classifier, not confidence in any environmental map analysis.

## License and references

The npm package declares `Apache-2.0`. The complete upstream repository license is included as `LICENSE`, retrieved unchanged from <https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.32/LICENSE>. This is the Apache 2.0 license plus the repository's existing additional notice. The upstream maintainer also confirms that MediaPipe models use Apache 2.0 in [issue 5242](https://github.com/google-ai-edge/mediapipe/issues/5242#issuecomment-2008701980). Runtime files and model weights remain unmodified.

[sanderdesnaijer/map-gesture-controls](https://github.com/sanderdesnaijer/map-gesture-controls) was inspected as a map-interaction reference. Its documentation describes local MediaPipe tracking, dwell time, dead zones, and smoothing, with adapters for OpenLayers, Google Maps, and Leaflet. Its code is not included here; this project implements a dedicated MapLibre adapter.

## File integrity

Paths below are relative to this directory. Values cover the exact downloaded bytes, before build copying.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `vision_bundle.js` | 155465 | `98db72469ffb176f5e9f2687be0f70783893aca681f7789c34b872b0a764371a` |
| `wasm/vision_wasm_internal.js` | 323377 | `e170ee67dd4e16c1a6fcd8840a206687e5a59b22c20e4a902bc445b095454d73` |
| `wasm/vision_wasm_internal.wasm` | 11756954 | `8da277a733926eacd0474b8704b36742d6ec3231c57a860c5b889dff8f1df886` |
| `wasm/vision_wasm_nosimd_internal.js` | 323180 | `e81d715a3d42cc3373602eb2f7aff795d164934db680e32496b65dab537f9658` |
| `wasm/vision_wasm_nosimd_internal.wasm` | 10960242 | `a28483cd42e74e855bf5ebdb6b40d9b66a5b49e35e95020bc97669e6822a3192` |
| `gesture_recognizer.task` | 8373440 | `97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482` |
| `LICENSE` | 12331 | `8707eef0533987efc5b155d64761eeb6e20793f50b9bd1a68dad1cf4719d0ed8` |
