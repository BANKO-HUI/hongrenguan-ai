// Offline provider fixture, imported ONLY by the isolated browser acceptance server.
import sharp from 'sharp';
import { setTimeout } from 'node:timers/promises';
import { sampleAnalysis } from './helpers.js';

export function fakeProvider() {
  const files = new Map();
  let index = 0;
  return {
    interval: 20,
    inspect: async () => ({
      ready: true,
      imageGeneration: true,
      model: 'offline-test-fixture',
      models: [
        {
          id: 'offline-test-fixture',
          displayName: 'GPT-Offline Test Fixture',
          description: 'Deterministic browser acceptance model',
          isDefault: true,
        },
      ],
      message: '测试执行器（无 AI 费用）',
    }),
    readImage: (name) => files.get(name),
    run: async ({ schema, signal, prompt }) => {
      await setTimeout(1600, undefined, { signal });
      if (schema.properties.analysis) return { analysis: sampleAnalysis };
      if (schema.properties.plan) {
        const total = Number(prompt.match(/exactly (\d+)/)?.[1] || 1);
        return {
          plan: Array.from({ length: total }, (_, index) => ({
            slot: index + 1,
            title: `Trail shell ${index + 1}`,
            prompt: `Functional shell ${index + 1}`,
            designNotes: 'Ripstop and reflective print',
          })),
        };
      }
      if (schema.properties.result) {
        const lookNumber = index + 1;
        const name = `fixture-${++index}`;
        files.set(
          name,
          await sharp({
            create: {
              width: 512,
              height: 768,
              channels: 3,
              background: { r: 30 + ((index * 17) % 200), g: 110, b: 80 },
            },
          })
            .png()
            .toBuffer(),
        );
        return {
          result: {
            plan: {
              slot: 1,
              title: `Trail shell ${lookNumber}`,
              prompt: `Functional shell ${lookNumber}`,
              designNotes: `Ripstop and reflective print variation ${lookNumber}`,
            },
            image: { filePath: name, review: 'Test fixture, not a generated fashion image' },
          },
        };
      }
      const name = `fixture-${++index}`;
      files.set(
        name,
        await sharp({
          create: {
            width: 512,
            height: 768,
            channels: 3,
            background: { r: 30 + ((index * 17) % 200), g: 110, b: 80 },
          },
        })
          .png()
          .toBuffer(),
      );
      return { image: { filePath: name, review: 'Test fixture, not a generated fashion image' } };
    },
  };
}
