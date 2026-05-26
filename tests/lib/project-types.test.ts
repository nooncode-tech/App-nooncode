import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_PROJECT_TYPE_LABEL,
  PROJECT_TYPE_LABELS,
  humanizeProjectType,
  isKnownProjectType,
} from '@/lib/projects/project-types'

// Coverage for lib/projects/project-types.ts. Closed enum + humanization +
// type guard. Verified against the v3 vocabulary mirror (Lista App item #4).

test('project-types: PROJECT_TYPE_LABELS is frozen', () => {
  assert.equal(Object.isFrozen(PROJECT_TYPE_LABELS), true)
})

test('project-types: synonyms collapse to the same human label', () => {
  assert.equal(PROJECT_TYPE_LABELS.landing, PROJECT_TYPE_LABELS.landing_page)
  assert.equal(PROJECT_TYPE_LABELS.webapp, PROJECT_TYPE_LABELS.web_app)
  assert.equal(PROJECT_TYPE_LABELS.ecommerce, PROJECT_TYPE_LABELS.e_commerce)
  assert.equal(PROJECT_TYPE_LABELS.sitio_web, PROJECT_TYPE_LABELS.website)
})

test('project-types: humanizeProjectType resolves known identifiers verbatim', () => {
  assert.equal(humanizeProjectType('landing'), 'Landing Page')
  assert.equal(humanizeProjectType('webapp'), 'Web App')
  assert.equal(humanizeProjectType('ecommerce'), 'E-commerce')
  assert.equal(humanizeProjectType('sitio_web'), 'Sitio Web')
})

test('project-types: humanizeProjectType is case-insensitive + trims', () => {
  assert.equal(humanizeProjectType('  LANDING  '), 'Landing Page')
  assert.equal(humanizeProjectType('WebApp'), 'Web App')
  assert.equal(humanizeProjectType('ECOMMERCE'), 'E-commerce')
})

test('project-types: humanizeProjectType defaults to DEFAULT_PROJECT_TYPE_LABEL for null / empty / unknown', () => {
  assert.equal(humanizeProjectType(null), DEFAULT_PROJECT_TYPE_LABEL)
  assert.equal(humanizeProjectType(undefined), DEFAULT_PROJECT_TYPE_LABEL)
  assert.equal(humanizeProjectType(''), DEFAULT_PROJECT_TYPE_LABEL)
  assert.equal(humanizeProjectType('   '), DEFAULT_PROJECT_TYPE_LABEL)
  assert.equal(humanizeProjectType('mobile_app'), DEFAULT_PROJECT_TYPE_LABEL)
  assert.equal(humanizeProjectType(42), DEFAULT_PROJECT_TYPE_LABEL)
  assert.equal(humanizeProjectType({}), DEFAULT_PROJECT_TYPE_LABEL)
})

test('project-types: isKnownProjectType narrows to ProjectType', () => {
  assert.equal(isKnownProjectType('landing'), true)
  assert.equal(isKnownProjectType('  LANDING  '), true)
  assert.equal(isKnownProjectType('unknown'), false)
  assert.equal(isKnownProjectType(null), false)
  assert.equal(isKnownProjectType(42), false)
})

test('project-types: humanizeProjectType never throws on adversarial input', () => {
  // No throw on objects, arrays, booleans, prototype-pollution keys.
  assert.doesNotThrow(() => humanizeProjectType({ project_type: 'landing' }))
  assert.doesNotThrow(() => humanizeProjectType(['landing']))
  assert.doesNotThrow(() => humanizeProjectType(true))
  assert.doesNotThrow(() => humanizeProjectType('__proto__'))
  assert.doesNotThrow(() => humanizeProjectType('constructor'))
})

test('project-types: prototype-pollution-style keys default to fallback', () => {
  // The lookup is a plain object; `__proto__` / `constructor` are NOT in the
  // PROJECT_TYPE_LABELS map. Without `Object.create(null)` we rely on the
  // explicit `Object.prototype.hasOwnProperty.call` in `isKnownProjectType`
  // and the literal-key access in `humanizeProjectType`.
  assert.equal(humanizeProjectType('__proto__'), DEFAULT_PROJECT_TYPE_LABEL)
  assert.equal(humanizeProjectType('constructor'), DEFAULT_PROJECT_TYPE_LABEL)
  assert.equal(humanizeProjectType('toString'), DEFAULT_PROJECT_TYPE_LABEL)
})
