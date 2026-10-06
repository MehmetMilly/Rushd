import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { parse, parseFragment } from 'parse5';
import { parse as parseVueSfc } from 'vue/compiler-sfc';
import { createMsIcon } from '../../src/components/ms-icon.js';

/* global process:readonly, console:readonly */

const root = process.cwd();
const manifest = JSON.parse(readFileSync('src/components/material-symbol-icons.json', 'utf8'));
const required = new Set();
const sourceFiles = [];
const expectedDynamicIconBindings = [
  'cat.icon',
  'getCategoryIcon(cat.category)',
  'getCategoryIcon(expense.category)',
  'getCategoryIcon(tmpl.category)',
  'icon',
];

function stripOuterParentheses(expression) {
  let value = expression.trim();
  while (value.startsWith('(') && value.endsWith(')')) {
    let depth = 0;
    let quote = null;
    let closesAtEnd = false;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (quote) {
        if (character === '\\') index += 1;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '(') {
        depth += 1;
      } else if (character === ')') {
        depth -= 1;
        if (depth === 0) {
          closesAtEnd = index === value.length - 1;
          break;
        }
      }
    }
    if (!closesAtEnd) break;
    value = value.slice(1, -1).trim();
  }
  return value;
}

function conditionalParts(expression) {
  const value = stripOuterParentheses(expression);
  let questionIndex = -1;
  let conditionalDepth = 0;
  let quote = null;
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '(') parentheses += 1;
    else if (character === ')') parentheses -= 1;
    else if (character === '[') brackets += 1;
    else if (character === ']') brackets -= 1;
    else if (character === '{') braces += 1;
    else if (character === '}') braces -= 1;
    else if (parentheses === 0 && brackets === 0 && braces === 0) {
      if (character === '?' && value[index + 1] !== '.' && value[index + 1] !== '?') {
        if (questionIndex < 0) questionIndex = index;
        conditionalDepth += 1;
      } else if (character === ':' && conditionalDepth > 0) {
        conditionalDepth -= 1;
        if (conditionalDepth === 0) {
          return {
            condition: value.slice(0, questionIndex).trim(),
            consequent: value.slice(questionIndex + 1, index).trim(),
            alternate: value.slice(index + 1).trim(),
          };
        }
      }
    }
  }
  return null;
}

function finiteIconBranches(expression, label) {
  const value = stripOuterParentheses(expression);
  const literal = value.match(/^(['"])([a-z][a-z0-9_]*)\1$/);
  if (literal) return [literal[2]];

  const conditional = conditionalParts(value);
  assert.ok(conditional, `Icon expression must resolve only to literal names in ${label}: ${expression}`);
  assert.ok(conditional.condition, `Icon conditional needs a test in ${label}: ${expression}`);
  return [
    ...finiteIconBranches(conditional.consequent, label),
    ...finiteIconBranches(conditional.alternate, label),
  ];
}

function iconMarkupForFile(path, source) {
  if (extname(path) !== '.vue') return source;
  const { descriptor, errors } = parseVueSfc(source, { filename: path });
  assert.equal(errors.length, 0, `Invalid Vue SFC in icon source scan: ${path}`);
  const template = descriptor.template;
  const scripts = [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean).join('\n');
  assert.doesNotMatch(
    scripts,
    /<\/?(?:ms-?icon|ms-?btn)\b|material-symbols-rounded|\b(?:ms-?icon|ms-?btn)\b|\b(?:h|createVNode|resolveComponent)\s*\(|\brender\s*[:(]/i,
    `Script-generated icons need an explicit source audit: ${path}`,
  );
  if (!template) return '';
  assert.ok(!template.src, `External Vue templates cannot be audited for icons: ${path}`);
  assert.ok(!template.lang || ['html', 'htm'].includes(template.lang.toLowerCase()), `Non-HTML Vue templates cannot be audited for icons: ${path}`);
  return template.content;
}

function scanComponentIconAttributes(source, path) {
  const icons = new Set();
  const dynamicBindings = new Set();
  assert.doesNotMatch(source, /<component\b/i, `Opaque Vue <component> elements need an explicit source audit in ${path}.`);
  const openingTags = /<(ms-?icon|ms-?btn)\b/gi;
  for (const match of source.matchAll(openingTags)) {
    const rawTagName = match[1];
    let end = match.index + match[0].length;
    let quote = null;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (quote) {
        if (character === '\\') end += 1;
        else if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        break;
      }
    }
    assert.ok(end < source.length && !quote, `Unterminated ${rawTagName} tag in ${path}.`);
    const attributes = source.slice(match.index + match[0].length, end);
    const tagName = rawTagName.toLowerCase().replace('-', '');
    assert.doesNotMatch(
      attributes,
      /(?:^|\s)(?:v-bind\s*=|(?:[:]|v-bind:)\s*\[[^\]]+\]\s*=|(?:[:]|v-bind:)(?:name|icon|fill)\.[a-z][a-z0-9_-]*\s*=)/,
      `Spread or dynamic-argument icon bindings need an explicit source audit in ${path}: ${attributes}`,
    );
    if (tagName === 'msicon') {
      assert.doesNotMatch(attributes, /(?:^|\s)(?:(?::|v-bind:)fill(?:\.[a-z][a-z0-9_-]*)*(?=\s|=|\/|$)|fill(?=\s|=|\/|$))/, `Filled ms-icon use is blocked until FILL=1 parity is proved in ${path}.`);
    }
    const parsedAttributes = [];
    let cursor = 0;
    while (cursor < attributes.length) {
      while (/\s/.test(attributes[cursor] || '')) cursor += 1;
      if (cursor >= attributes.length || attributes[cursor] === '/') break;
      const nameStart = cursor;
      while (cursor < attributes.length && !/[\s=/>]/.test(attributes[cursor])) cursor += 1;
      const rawName = attributes.slice(nameStart, cursor);
      if (!rawName) {
        cursor += 1;
        continue;
      }
      while (/\s/.test(attributes[cursor] || '')) cursor += 1;
      let value = '';
      if (attributes[cursor] === '=') {
        cursor += 1;
        while (/\s/.test(attributes[cursor] || '')) cursor += 1;
        const quote = attributes[cursor] === '"' || attributes[cursor] === "'" ? attributes[cursor++] : null;
        const valueStart = cursor;
        if (quote) {
          while (cursor < attributes.length && attributes[cursor] !== quote) {
            if (attributes[cursor] === '\\') cursor += 1;
            cursor += 1;
          }
          assert.ok(cursor < attributes.length, `Unterminated ${rawName} value on ${rawTagName} in ${path}.`);
          value = attributes.slice(valueStart, cursor);
          cursor += 1;
        } else {
          while (cursor < attributes.length && !/[\s/>]/.test(attributes[cursor])) cursor += 1;
          value = attributes.slice(valueStart, cursor);
        }
      }
      parsedAttributes.push({ rawName, value });
    }
    for (const { rawName, value } of parsedAttributes) {
      const name = rawName.split('.')[0].toLowerCase();
      if ((name === 'name' && tagName === 'msicon') || (name === 'icon' && tagName === 'msbtn')) {
        assert.match(value, /^[a-z][a-z0-9_]*$/, `Invalid static ${tagName} icon in ${path}: ${value}`);
        icons.add(value);
      } else if ((name === ':name' || name === 'v-bind:name') && tagName === 'msicon') {
        dynamicBindings.add(value);
      } else if ((name === ':icon' || name === 'v-bind:icon') && tagName === 'msbtn') {
        dynamicBindings.add(`ms-btn:${value}`);
      }
    }
  }
  return { icons, dynamicBindings };
}

function collectSourceFiles(directory, output = sourceFiles) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectSourceFiles(path, output);
    else if (['.html', '.js', '.ts', '.vue'].includes(extname(entry.name))) output.push(path);
  }
}

function textContent(node) {
  if (node.nodeName === '#text') return node.value;
  return (node.childNodes || []).map(textContent).join('');
}

function addDynamicBranches(expression, label, output = required) {
  for (const branch of finiteIconBranches(expression, label)) output.add(branch);
}

function walkTemplate(node, output = required, label = 'root-template.html') {
  const classes = node.attrs?.find((attribute) => attribute.name === 'class')?.value?.split(/\s+/) || [];
  if (node.tagName === 'span' && classes.includes('material-symbols-rounded')) {
    assert.doesNotMatch(
      node.attrs?.map((attribute) => attribute.name).join(' ') || '',
      /(?:^|\s)(?:v-text|v-html|:textContent|:innerHTML|v-bind:textContent|v-bind:innerHTML)(?:\s|$)/,
      'Icon textContent/innerHTML directives need an explicit finite-name audit.',
    );
    const value = textContent(node).trim();
    const expressions = [...value.matchAll(/\{\{([\s\S]*?)\}\}/g)];
    if (expressions.length) {
      assert.equal(value.replace(/\{\{[\s\S]*?\}\}/g, '').trim(), '', 'Icon text must be a literal name or a controlled expression.');
      for (const expression of expressions) addDynamicBranches(expression[1], label, output);
    } else if (value) {
      assert.match(value, /^[a-z][a-z0-9_]*$/, `Invalid literal icon name ${value}`);
      output.add(value);
    }
  }
  for (const child of node.childNodes || []) walkTemplate(child, output, label);
  if (node.content) walkTemplate(node.content, output, label);
}

collectSourceFiles(join(root, 'src'));
const rootTemplate = readFileSync('src/app/root-template.html', 'utf8');
walkTemplate(parse(rootTemplate));

for (const path of sourceFiles) {
  if (path.endsWith('/src/app/root-template.html')) continue;
  const source = iconMarkupForFile(path, readFileSync(path, 'utf8'));
  if (extname(path) === '.vue') {
    walkTemplate(parseFragment(source), required, path);
    continue;
  }
  for (const span of source.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/g)) {
    const classAttribute = span[1].match(/\bclass\s*=\s*(['"])(.*?)\1/s)?.[2] || '';
    if (!classAttribute.split(/\s+/).includes('material-symbols-rounded')) continue;
    assert.doesNotMatch(
      span[1],
      /(?:^|\s)(?:v-text|v-html|:textContent|:innerHTML|v-bind:textContent|v-bind:innerHTML)(?:\s*=|\s|\/|$)/,
      `Icon textContent/innerHTML directives need an explicit finite-name audit in ${path}.`,
    );
    const value = span[2].trim();
    const expression = value.match(/^\{\{([\s\S]*?)\}\}$/)?.[1]?.trim();
    if (expression === 'iconName' && path.endsWith('/src/components/ms-icon.js')) continue;
    if (expression) addDynamicBranches(expression, path);
    else if (value) {
      assert.match(value, /^[a-z][a-z0-9_]*$/, `Invalid literal icon name ${value} in ${path}`);
      required.add(value);
    }
  }
}

const dynamicIconBindings = new Set();
for (const path of sourceFiles) {
  const source = iconMarkupForFile(path, readFileSync(path, 'utf8'));
  const componentIcons = scanComponentIconAttributes(source, path);
  for (const icon of componentIcons.icons) required.add(icon);
  for (const binding of componentIcons.dynamicBindings) dynamicIconBindings.add(binding);
}

const controller = readFileSync('src/app/root-controller.js', 'utf8');
const categoryOptions = controller.match(/categoryOptions\(\)\s*\{\s*return\s*\[([\s\S]*?)\n\s*\];\s*\n\s*\}/);
assert.ok(categoryOptions, 'categoryOptions must stay enumerable for icon coverage.');
const categoryIcons = new Set([...categoryOptions[1].matchAll(/\bicon:\s*['"]([a-z][a-z0-9_]*)['"]/g)].map((match) => match[1]));
assert.ok(categoryIcons.size, 'categoryOptions must declare fixed icon names.');

const categoryHelper = controller.match(/getCategoryIcon\(cat\)\s*\{\s*const map\s*=\s*\{([\s\S]*?)\};\s*return\s+map\[cat\]\s*\|\|\s*(['"])([a-z][a-z0-9_]*)\2\s*;/);
assert.ok(categoryHelper, 'getCategoryIcon must keep a finite map and generic fallback.');
const mappedCategoryIcons = new Set([...categoryHelper[1].matchAll(/:\s*['"]([a-z][a-z0-9_]*)['"]/g)].map((match) => match[1]));
assert.deepEqual(mappedCategoryIcons, categoryIcons, 'categoryOptions and getCategoryIcon must agree exactly.');
const categoryFallback = categoryHelper[3];
assert.equal(categoryFallback, manifest.fallbackIcon, 'Unknown categories must use the manifest fallback icon.');
required.add(categoryFallback);
for (const icon of categoryIcons) required.add(icon);
assert.deepEqual(
  [...dynamicIconBindings].sort(),
  expectedDynamicIconBindings.slice().sort(),
  'Dynamic ms-icon bindings need an explicit finite-name audit.',
);

const guardFixtureRoot = join(root, 'tests/fixtures/font-icon-guard');
const guardFixtureFiles = [];
collectSourceFiles(guardFixtureRoot, guardFixtureFiles);
assert.ok(guardFixtureFiles.some((path) => path.endsWith('covered-icons.vue')), 'Vue SFC fixtures must be part of the icon-source guard.');
const coveredSfc = guardFixtureFiles.find((path) => path.endsWith('covered-icons.vue'));
const coveredSource = iconMarkupForFile(coveredSfc, readFileSync(coveredSfc, 'utf8'));
const coveredIconNames = new Set();
const coveredComponents = scanComponentIconAttributes(coveredSource, coveredSfc);
for (const icon of coveredComponents.icons) coveredIconNames.add(icon);
walkTemplate(parseFragment(coveredSource), coveredIconNames, coveredSfc);
assert.deepEqual([...coveredIconNames].sort(), ['category', 'home', 'weekend']);
assert.deepEqual([...coveredComponents.dynamicBindings], ['cat.icon'], 'v-bind:name must enter the auditable dynamic-binding inventory.');
const untrackedBindSource = iconMarkupForFile(
  join(guardFixtureRoot, 'untracked-v-bind.vue'),
  readFileSync(join(guardFixtureRoot, 'untracked-v-bind.vue'), 'utf8'),
);
const untrackedComponents = scanComponentIconAttributes(untrackedBindSource, 'untracked-v-bind.vue');
assert.throws(() => assert.deepEqual([...untrackedComponents.dynamicBindings].sort(), expectedDynamicIconBindings.slice().sort()));
const quotedComparisonSource = iconMarkupForFile(
  join(guardFixtureRoot, 'quoted-comparison.vue'),
  readFileSync(join(guardFixtureRoot, 'quoted-comparison.vue'), 'utf8'),
);
const quotedComparison = scanComponentIconAttributes(quotedComparisonSource, 'quoted-comparison.vue');
assert.deepEqual([...quotedComparison.dynamicBindings], ["count > 0 ? 'home' : 'category'"]);
assert.throws(() => assert.deepEqual([...quotedComparison.dynamicBindings].sort(), expectedDynamicIconBindings.slice().sort()));
const filledIconFixture = iconMarkupForFile(
  join(guardFixtureRoot, 'filled-icon.vue'),
  readFileSync(join(guardFixtureRoot, 'filled-icon.vue'), 'utf8'),
);
assert.throws(() => scanComponentIconAttributes(filledIconFixture, 'filled-icon.vue'), /FILL=1 parity is proved/);
const safeTernaryFixture = readFileSync(join(guardFixtureRoot, 'finite-ternary.html'), 'utf8').match(/\{\{([\s\S]*?)\}\}/)?.[1];
assert.deepEqual(finiteIconBranches(safeTernaryFixture, 'finite-ternary fixture'), ['home', 'category']);
const misleadingTernaryFixture = readFileSync(join(guardFixtureRoot, 'misleading-ternary.html'), 'utf8').match(/\{\{([\s\S]*?)\}\}/)?.[1];
assert.throws(() => finiteIconBranches(misleadingTernaryFixture, 'misleading-ternary fixture'), /must resolve only to literal names/);

const actual = [...required].sort();
const declared = [...manifest.icons].sort();
assert.deepEqual(declared, actual, 'The allowlist must equal every static and enumerated dynamic icon name.');
assert.ok(manifest.icons.includes(manifest.fallbackIcon), 'The generic fallback must be included in the subset.');

const iconComponent = readFileSync('src/components/ms-icon.js', 'utf8');
assert.match(iconComponent, /knownIcons\.has\(this\.name\)\s*\?\s*this\.name\s*:\s*iconManifest\.fallbackIcon/);
const iconDefinition = createMsIcon({});
assert.deepEqual(iconDefinition.props, ['name', 'size'], 'FILL=1 must remain unavailable until filled glyph parity is proved.');
assert.equal(iconDefinition.computed.iconName.call({ name: 'not_a_subset_icon' }), manifest.fallbackIcon);
assert.equal(iconDefinition.computed.iconStyle.call({ size: 24 }).fontVariationSettings, '"FILL" 0');
for (const name of manifest.icons) {
  assert.equal(iconDefinition.computed.iconName.call({ name }), name);
}

const css = readFileSync('public/fonts/material-symbols-rounded.css', 'utf8');
const assetPath = css.match(/url\((\/fonts\/[^)]+\.woff2)\)/)?.[1];
assert.ok(assetPath, 'The Material Symbols CSS must reference a local WOFF2.');
assert.ok(assetPath.includes('-subset.woff2'), 'The app CSS must reference the generated subset.');
assert.match(css, /font-weight:\s*100\s+700/);
assert.ok(!existsSync(resolve(root, 'public/fonts/sykg-zNym6YjUruM-QrEh7-nyTnjDwKNJ_190FjzaqkNCeE.woff2')));
const assetOnDisk = resolve(root, 'public', assetPath.slice(1));
const provenance = JSON.parse(readFileSync('public/fonts/PROVENANCE.json', 'utf8'));
const sourceRecord = provenance.icon_font?.source_asset;
const outputRecord = provenance.icon_font?.assets?.find((asset) => `/${asset.path}` === assetPath);
assert.ok(sourceRecord?.path && sourceRecord?.sha256, 'Font provenance must identify the source font and its hash.');
assert.ok(outputRecord?.sha256, 'Font provenance must identify the generated subset and its hash.');
function verifyHash(path, expected, label) {
  const contents = readFileSync(path);
  assert.equal(createHash('sha256').update(contents).digest('hex'), expected, `${label} hash does not match provenance.`);
  return contents.byteLength;
}
const outputBytes = verifyHash(assetOnDisk, outputRecord.sha256, 'Subset font');
verifyHash(resolve(root, sourceRecord.path), sourceRecord.sha256, 'Source font');
assert.ok(outputBytes <= provenance.icon_font.subset.max_bytes, 'Subset font exceeds its documented byte budget.');
assert.equal(provenance.icon_font.subset.tool, 'fonttools==4.61.1');
assert.equal(provenance.icon_font.subset.output_format, 'woff2');
assert.equal(provenance.icon_font.subset.layout_feature, 'rlig');
assert.deepEqual(provenance.icon_font.subset.variation_axes, ['FILL', 'GRAD', 'opsz', 'wght']);
assert.ok(provenance.icon_font.license?.path, 'Apache-2.0 notice remains attached to the derived icon font.');
const generator = readFileSync('scripts/subset-material-symbols.py', 'utf8');
const toolRequirements = readFileSync('scripts/font-subset-requirements.txt', 'utf8');
for (const [packageName, packageVersion] of Object.entries({ fonttools: '4.61.1', brotli: '1.2.0', zopfli: '0.4.3' })) {
  assert.ok(toolRequirements.includes(`${packageName === 'fonttools' ? 'fonttools[woff]' : packageName}==${packageVersion}`), `${packageName} must stay pinned in the build requirements.`);
  assert.ok(generator.includes(`'${packageName}': '${packageVersion}'`), `${packageName} version must be enforced before generation.`);
}
assert.match(generator, /def verify_tool_versions\(\):[\s\S]*?verify_tool_versions\(\)\n\s*parser = argparse/);

console.log(`Font icon contract passed (${manifest.icons.length} required names, ${outputBytes.toLocaleString()} subset bytes).`);
