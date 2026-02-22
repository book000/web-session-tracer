import type { MutationLevel, RawDomChange } from '../types'

/**
 * UI に直結する属性名のセット。
 * これらの属性が変更された場合、重要度レベル 3 (significant) とみなす。
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
 * リソース系ノード名のセット。
 * これらのノードのみの追加/削除はレベル 1 (noise) とみなす。
 */
const RESOURCE_NODES = new Set(['SCRIPT', 'LINK', 'META', 'STYLE', 'NOSCRIPT'])

/**
 * 変更対象が &lt;head&gt; 内かどうかを判定する。
 *
 * @param targetPath - 変更対象ノードの XPath
 * @returns &lt;head&gt; 内であれば true
 */
function isInHead(targetPath: string): boolean {
  return targetPath.includes('/head[') || targetPath === ''
}

/**
 * childList 変更のノードリストがリソース系ノードや #comment のみか判定する。
 *
 * @param nodes - 追加または削除されたノード名のリスト
 * @returns リソース系ノード・#comment のみであれば true
 */
function isNoiseNodes(nodes: string[]): boolean {
  return (
    nodes.length > 0 &&
    nodes.every((n) => RESOURCE_NODES.has(n) || n === '#comment')
  )
}

/**
 * childList 変更のノードリストが #text のみか判定する。
 *
 * @param nodes - 追加または削除されたノード名のリスト
 * @returns #text のみであれば true
 */
function isTextOnlyNodes(nodes: string[]): boolean {
  return nodes.length > 0 && nodes.every((n) => n === '#text')
}

/**
 * DOM 変更 1 件の重要度レベルを計算する。
 *
 * レベル判定基準:
 * - 1 (noise): &lt;head&gt; 内変更・リソース系ノード (#comment 含む) の追加削除
 * - 2 (minor): characterData 変更・data-* 属性・#text のみの childList 変更・その他属性変更
 * - 3 (significant): UI に直結する属性変更・body への要素追加削除
 *
 * @param raw - ブラウザ注入スクリプトから受け取った生の DOM 変更データ
 * @returns 重要度レベル (1 | 2 | 3)
 */
export function computeChangeLevel(raw: RawDomChange): MutationLevel {
  // --- レベル 1 (noise) の判定 ---

  // head 内の変更はほぼ確実にノイズ
  if (isInHead(raw.targetPath)) return 1

  // リソース系ノード・#comment のみの追加/削除はノイズ
  const allNodes = [...raw.addedNodes, ...raw.removedNodes]
  if (
    raw.mutationType === 'childList' &&
    allNodes.length > 0 &&
    isNoiseNodes(allNodes)
  )
    return 1

  // --- レベル 3 (significant) の判定 ---

  if (raw.mutationType === 'attributes' && raw.attributeName !== null) {
    // UI に直結する属性の変更は重要
    if (VISIBLE_ATTRS.has(raw.attributeName)) return 3
    // aria-* は上記セットで網羅できていない場合もカバー
    if (raw.attributeName.startsWith('aria-')) return 3
  }

  if (raw.mutationType === 'childList') {
    // #text のみの変更は minor
    if (isTextOnlyNodes(allNodes)) return 2
    // 要素ノードを含む変更は body 内であれば significant
    if (
      allNodes.some(
        (n) => !RESOURCE_NODES.has(n) && n !== '#comment' && n !== '#text'
      )
    )
      return 3
  }

  // --- レベル 2 (minor) の判定 ---
  // characterData・data-* 属性・その他の軽微な変更
  return 2
}
