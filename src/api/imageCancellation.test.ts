import { expect, test } from 'bun:test';
import { generateConfiguredImage } from './imageGen';
import { DEFAULT_IMAGE_CONFIG, type ImageEngine } from './imageGenTypes';

for(const engine of ['nai','comfyui','openai_compatible','krea'] as ImageEngine[]) {
  test(`${engine} generation passes cancellation to its actual HTTP request`,async()=>{
    const previous=globalThis.fetch;let received:AbortSignal|null|undefined;
    globalThis.fetch=((_input,init)=>{received=init?.signal;return new Promise<Response>(()=>{});}) as typeof fetch;
    try {
      const controller=new AbortController();
      const pending=generateConfiguredImage('portrait',{...DEFAULT_IMAGE_CONFIG,engine,apiKey:'test-placeholder',kreaApiKey:'test-placeholder',openaiCompatibleApiKey:'test-placeholder',openaiCompatibleApiUrl:'https://image.invalid/v1',openaiCompatibleModel:'test-image',comfyModel:'test.safetensors'},controller.signal);
      // Config construction runs synchronously up to the platform request.
      await Promise.resolve();
      expect(received).toBe(controller.signal);controller.abort();await expect(pending).rejects.toThrow();
    } finally {globalThis.fetch=previous;}
  });
}
