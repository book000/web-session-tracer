import type { MutationLevel, RawDomChange } from '../types'

/**
 * Attribute names that map directly to what the user sees.
 * Changing one of them is treated as level 3 (significant).
 */
const VISIBLE_ATTRS = new Set([
  'class',
  'style',
  'hidden',
  'disabled',
  'value',
  'checked',
  'selected',
  'open',
  'src',
  'href',
  'alt',
  'title',
  'aria-expanded',
  'aria-selected',
  'aria-checked',
  'aria-hidden',
  'aria-label',
  'aria-disabled',
  'aria-current',
])

/**
 * Resource-like node names.
 * Adding or removing only these nodes is treated as level 1 (noise).
 */
const RESOURCE_NODES = new Set(['SCRIPT', 'LINK', 'META', 'STYLE', 'NOSCRIPT'])

/**
 * Returns whether the changed node is inside `<head>`.
 *
 * @param targetPath - XPath of the changed node
 * @returns true if the node is inside `<head>`
 */
function isInHead(targetPath: string): boolean {
  // An empty targetPath means getXPath could not resolve the node (unknown
  // node), so it cannot be assumed to be inside head and is not matched.
  return targetPath.includes('/head[')
}

/**
 * Returns whether a childList node list contains only resource-like nodes
 * and #comment nodes.
 *
 * @param nodes - Names of the added or removed nodes
 * @returns true if the list has only resource-like nodes and #comment
 */
function isNoiseNodes(nodes: string[]): boolean {
  return (
    nodes.length > 0 &&
    nodes.every((n) => RESOURCE_NODES.has(n) || n === '#comment')
  )
}

/**
 * Returns whether a childList node list contains only #text nodes.
 *
 * @param nodes - Names of the added or removed nodes
 * @returns true if the list has only #text nodes
 */
function isTextOnlyNodes(nodes: string[]): boolean {
  return nodes.length > 0 && nodes.every((n) => n === '#text')
}

/**
 * Computes the importance level of a single DOM change.
 * The first matching rule wins; anything unmatched is level 2.
 * See {@link MutationLevel} for the meaning of each level.
 *
 * @param raw - Raw DOM change received from the injected script
 * @returns Importance level (1, 2 or 3)
 */
export function computeChangeLevel(raw: RawDomChange): MutationLevel {
  if (isInHead(raw.targetPath)) return 1

  const allNodes = [...raw.addedNodes, ...raw.removedNodes]
  if (
    raw.mutationType === 'childList' &&
    allNodes.length > 0 &&
    isNoiseNodes(allNodes)
  )
    return 1

  if (raw.mutationType === 'attributes' && raw.attributeName !== null) {
    if (VISIBLE_ATTRS.has(raw.attributeName)) return 3
    if (raw.attributeName.startsWith('aria-')) return 3
  }

  if (raw.mutationType === 'childList') {
    if (isTextOnlyNodes(allNodes)) return 2
    if (
      allNodes.some(
        (n) => !RESOURCE_NODES.has(n) && n !== '#comment' && n !== '#text'
      )
    )
      return 3
  }

  return 2
}
