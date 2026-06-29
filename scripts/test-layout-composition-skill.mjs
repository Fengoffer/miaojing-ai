import assert from 'node:assert';
import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

await runTest('built-in layout composition skill records source, license, and 100 layout references', () => {
  const source = read('src/lib/layout-composition-skill.ts');

  assert.match(source, /100-layout-compositions/);
  assert.match(source, /CC BY 4\.0/);
  assert.match(source, /TOTAL_LAYOUT_COMPOSITION_COUNT\s*=\s*100/);
  assert.match(source, /layoutNumber\.toString\(\)\.padStart\(3,\s*'0'\)/);
  assert.match(source, /images\/\$\{id\}\.png/);
  assert.match(source, /thumbnails\/\$\{id\}\.jpg/);
  assert.match(source, /不要添加文字、Logo、品牌标识或海报排版/);
});

await runTest('site config exposes an admin-controlled image composition skill toggle', () => {
  const route = read('src/app/api/site-config/route.ts');
  const client = read('src/lib/site-config.ts');
  const settings = read('src/components/admin/settings-tab.tsx');

  assert.match(route, /image_composition_skill_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(route, /imageCompositionSkillEnabled/);
  assert.match(client, /imageCompositionSkillEnabled: boolean/);
  assert.match(settings, /100 Layout Compositions/);
  assert.match(settings, /handleImageCompositionSkillToggle/);
});

await runTest('image generation route applies the layout composition skill before upstream requests', () => {
  const route = read('src/app/api/generate/image/route.ts');

  assert.match(route, /applyLayoutCompositionSkillToPrompt/);
  assert.match(route, /promptWithCompositionSkill/);
  assert.match(route, /promptForGeneration = mergeStylePrompt\(promptWithCompositionSkill, stylePrompt\)/);
});

if (process.exitCode) process.exit(process.exitCode);
