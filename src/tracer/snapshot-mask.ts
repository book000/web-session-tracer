import type { Protocol } from 'puppeteer-core'

type Snapshot = Protocol.DOMSnapshot.CaptureSnapshotResponse
type DocumentSnapshot = Protocol.DOMSnapshot.DocumentSnapshot

/** A position in an index array that points into `strings`. */
interface StringSlot {
  indexes: number[]
  position: number
}

const MASK = '***'

const DOCUMENT_STRING_FIELDS = [
  'documentURL',
  'title',
  'baseURL',
  'contentLanguage',
  'encodingName',
  'publicId',
  'systemId',
  'frameId',
] as const

/**
 * Collects the slots holding the value of every password input in a document:
 * the `value` attribute and the `.value` property (`nodes.inputValue`).
 */
function passwordValueSlots(
  doc: DocumentSnapshot,
  strings: string[]
): StringSlot[] {
  const { nodeName, attributes, inputValue } = doc.nodes
  const slots: StringSlot[] = []
  const passwordNodes = new Set<number>()

  const nameIndexes = nodeName ?? []
  for (const [nodeIndex, nameIndex] of nameIndexes.entries()) {
    if (strings[nameIndex]?.toUpperCase() !== 'INPUT') continue
    const pairs = attributes?.[nodeIndex] ?? []
    let isPassword = false
    let valuePosition = -1
    for (let position = 0; position + 1 < pairs.length; position += 2) {
      const name = strings[pairs[position]]?.toLowerCase()
      if (name === 'type') {
        isPassword =
          strings[pairs[position + 1]]?.trim().toLowerCase() === 'password'
      } else if (name === 'value') {
        valuePosition = position + 1
      }
    }
    if (!isPassword) continue
    passwordNodes.add(nodeIndex)
    if (valuePosition !== -1) {
      slots.push({ indexes: pairs, position: valuePosition })
    }
  }

  const inputNodeIndexes = inputValue?.index ?? []
  for (const [position, nodeIndex] of inputNodeIndexes.entries()) {
    if (passwordNodes.has(nodeIndex)) {
      slots.push({ indexes: inputValue?.value ?? [], position })
    }
  }
  return slots
}

/** Yields every `strings` index referenced anywhere in a document. */
function* referencedStringIndexes(doc: DocumentSnapshot): Iterable<number> {
  const { nodes, layout } = doc
  yield* nodes.nodeName ?? []
  yield* nodes.nodeValue ?? []
  const attributePairs = nodes.attributes ?? []
  for (const pairs of attributePairs) yield* pairs
  for (const rare of [
    nodes.textValue,
    nodes.inputValue,
    nodes.shadowRootType,
    nodes.pseudoType,
    nodes.pseudoIdentifier,
    nodes.currentSourceURL,
    nodes.originURL,
  ]) {
    yield* rare?.value ?? []
  }
  yield* layout.text
  for (const styles of layout.styles) yield* styles
  yield* layout.blendedBackgroundColors ?? []
  for (const field of DOCUMENT_STRING_FIELDS) yield doc[field]
}

/**
 * Masks the value of every password input in a `DOMSnapshot.captureSnapshot`
 * response as `***`, in place.
 *
 * `strings` is a shared table, so the password references are repointed to a
 * `***` entry, and the original string is overwritten only when no other node
 * references it.
 * @param snapshot - Response to mask; modified in place
 * @returns The same object
 * @throws If the response does not have `documents` and `strings` arrays
 */
export function maskPasswordInputs(snapshot: Snapshot): Snapshot {
  const { documents, strings } = snapshot
  if (!Array.isArray(documents) || !Array.isArray(strings)) {
    throw new TypeError(
      'Unexpected DOMSnapshot response: documents and strings must be arrays'
    )
  }

  const slots = documents.flatMap((doc) => passwordValueSlots(doc, strings))
  const secrets = new Set<number>()
  for (const { indexes, position } of slots) {
    if (indexes[position] >= 0) secrets.add(indexes[position])
  }
  if (secrets.size === 0) return snapshot

  const maskIndex = strings.length
  strings.push(MASK)
  for (const { indexes, position } of slots) {
    if (indexes[position] >= 0) indexes[position] = maskIndex
  }

  for (const doc of documents) {
    for (const index of referencedStringIndexes(doc)) secrets.delete(index)
  }
  for (const index of secrets) strings[index] = MASK
  return snapshot
}
