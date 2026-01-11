/*
 ONNX Runtime Web quick-pass scoring snippet
 Usage (client-side):
  import { quickScore } from '../utils/onnxClient';
  const score = await quickScore(featuresArray, '/models/account_classifier.onnx');

 This code expects `onnxruntime-web` to be installed in the client bundle.
*/

export async function quickScore(features, modelUrl) {
  // Lazy-import to avoid bundling when unused
  const ort = await import('onnxruntime-web');
  const session = await ort.InferenceSession.create(modelUrl, { executionProviders: ['webgpu', 'wasm'] });

  // Convert features (Array<number>) into tensor shape [1, N]
  const input = new ort.Tensor('float32', Float32Array.from(features), [1, features.length]);
  const feeds = { input: input };
  const results = await session.run(feeds);
  // assume model outputs 'probabilities' or 'output'
  const outKey = Object.keys(results)[0];
  const out = results[outKey].data;
  return out; // caller interprets probabilities
}
