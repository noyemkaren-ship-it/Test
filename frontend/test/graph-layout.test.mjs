import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GRAPH_LAYOUT,
  graphPositionsOverlap,
  separateGraphNodes
} from '../src/graphLayout.ts'

function assertSeparated(result) {
  const positions = [...result.values()]
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      assert.equal(graphPositionsOverlap(positions[i], positions[j]), false)
    }
  }
}

test('keeps an already safe layout unchanged', () => {
  const input = [
    { id: 'a', position: { x: 40, y: 40 } },
    { id: 'b', position: { x: 40 + GRAPH_LAYOUT.stepX, y: 40 } }
  ]
  const result = separateGraphNodes(input)
  assert.deepEqual(result.get('a'), input[0].position)
  assert.deepEqual(result.get('b'), input[1].position)
})

test('separates duplicate and too-close coordinates', () => {
  const input = Array.from({ length: 80 }, (_, index) => ({
    id: `node-${index}`,
    position: { x: 100, y: 100 }
  }))
  const result = separateGraphNodes(input)
  assert.equal(result.size, input.length)
  assertSeparated(result)
})

test('recovers from invalid imported coordinates', () => {
  const result = separateGraphNodes([
    { id: 'nan', position: { x: Number.NaN, y: Number.NaN } },
    { id: 'infinity', position: { x: Number.POSITIVE_INFINITY, y: 40 } },
    { id: 'missing' }
  ])
  for (const position of result.values()) {
    assert.equal(Number.isFinite(position.x), true)
    assert.equal(Number.isFinite(position.y), true)
  }
  assertSeparated(result)
})
