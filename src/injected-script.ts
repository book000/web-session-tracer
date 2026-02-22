/**
 * ページに注入するイベント収集スクリプトの文字列を返す。
 *
 * このスクリプトはブラウザの JavaScript コンテキストで実行され、
 * ユーザー操作イベントと DOM 変更を window.__wstEvent() 経由で
 * Node.js 側に送信する。
 *
 * 対応イベント:
 * - click, keydown, input, submit (ユーザー操作)
 * - MutationObserver による DOM 変更
 *
 * セキュリティ:
 * - パスワードフィールド (type="password") の値・キーは *** でマスクされる
 *
 * 多重インストール対策:
 * - window.__wstHandlers に各イベントハンドラー関数を保持する。
 * - スクリプト実行のたびに古いハンドラー・オブザーバーを取り除き、
 *   最新セッションのハンドラーで置き換える。
 * - これにより、複数の puppeteer セッションが evaluateOnNewDocument を
 *   登録しても、最後に実行されたスクリプトのハンドラーが有効になる。
 */
export function getInjectedScript(): string {
  return `(function () {
  'use strict';

  /**
   * DOM 要素の XPath を返す。
   * @param {Element} el - 対象要素
   * @returns {string} XPath 文字列
   */
  function getXPath(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    const parts = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.nodeName === node.nodeName) index++;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(node.nodeName.toLowerCase() + '[' + index + ']');
      node = node.parentElement;
    }
    return '/' + parts.join('/');
  }

  /**
   * イベントデータを Node.js 側へ送信する。
   * __wstEvent は evaluateOnNewDocument の実行順序により
   * スクリプト設定時点では未定義の場合があるため、呼び出し時に確認する。
   * エラーが発生してもページの動作は止めない。
   * @param {object} data - 送信データ
   */
  function sendEvent(data) {
    try {
      if (typeof window.__wstEvent === 'function') {
        window.__wstEvent(JSON.stringify(data));
      }
    } catch (_) {
      // 送信エラーはページ動作に影響させない
    }
  }

  // --- 古いハンドラーとオブザーバーの取り除き ---

  // 前回のイベントリスナーを削除
  if (window.__wstHandlers) {
    document.removeEventListener('click', window.__wstHandlers.click, true);
    document.removeEventListener('keydown', window.__wstHandlers.keydown, true);
    document.removeEventListener('input', window.__wstHandlers.input, true);
    document.removeEventListener('submit', window.__wstHandlers.submit, true);
  }

  // 前回の MutationObserver を切断
  if (window.__wstObserver) {
    window.__wstObserver.disconnect();
  }

  // --- ユーザー操作イベント ---

  /** @type {EventListener} */
  var clickHandler = function (e) {
    var target = /** @type {Element} */ (e.target);
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return;
    sendEvent({
      type: 'user_action',
      action: 'click',
      tagName: target.tagName || '',
      elementId: target.id || '',
      className: typeof target.className === 'string' ? target.className : '',
      value: '',
    });
  };

  /** @type {EventListener} */
  var keydownHandler = function (e) {
    var target = /** @type {HTMLInputElement} */ (e.target);
    if (!target) return;
    var isPassword = target.type === 'password';
    sendEvent({
      type: 'user_action',
      action: 'keydown',
      tagName: target.tagName || '',
      elementId: target.id || '',
      className: typeof target.className === 'string' ? target.className : '',
      value: '',
      key: isPassword ? '***' : (e.key || ''),
    });
  };

  /** @type {EventListener} */
  var inputHandler = function (e) {
    var target = /** @type {HTMLInputElement} */ (e.target);
    if (!target) return;
    var isPassword = target.type === 'password';
    sendEvent({
      type: 'user_action',
      action: 'input',
      tagName: target.tagName || '',
      elementId: target.id || '',
      className: typeof target.className === 'string' ? target.className : '',
      value: isPassword ? '***' : (target.value || ''),
    });
  };

  /** @type {EventListener} */
  var submitHandler = function (e) {
    var target = /** @type {HTMLFormElement} */ (e.target);
    if (!target) return;
    sendEvent({
      type: 'user_action',
      action: 'submit',
      tagName: target.tagName || '',
      elementId: target.id || '',
      className: typeof target.className === 'string' ? target.className : '',
      value: '',
    });
  };

  document.addEventListener('click', clickHandler, true);
  document.addEventListener('keydown', keydownHandler, true);
  document.addEventListener('input', inputHandler, true);
  document.addEventListener('submit', submitHandler, true);

  // ハンドラー参照を保持 (次回の取り除きに使用)
  window.__wstHandlers = {
    click: clickHandler,
    keydown: keydownHandler,
    input: inputHandler,
    submit: submitHandler,
  };

  // --- DOM 変更監視 ---

  var mutationObserver = new MutationObserver(function (mutations) {
    var changes = mutations.map(function (m) {
      return {
        mutationType: m.type,
        targetPath: getXPath(/** @type {Element} */ (m.target)),
        addedNodes: Array.from(m.addedNodes).map(function (n) {
          return n.nodeName;
        }),
        removedNodes: Array.from(m.removedNodes).map(function (n) {
          return n.nodeName;
        }),
        attributeName: m.attributeName,
        attributeValue:
          m.type === 'attributes' && m.target && m.attributeName
            ? /** @type {Element} */ (m.target).getAttribute(m.attributeName)
            : null,
        oldValue: m.oldValue,
        characterData:
          m.type === 'characterData' ? m.target.textContent : null,
      };
    });

    if (changes.length > 0) {
      sendEvent({
        type: 'mutation',
        changes: changes,
      });
    }
  });

  mutationObserver.observe(document.documentElement || document, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
    attributeOldValue: true,
    characterDataOldValue: true,
  });

  // オブザーバー参照を保持 (次回の取り除きに使用)
  window.__wstObserver = mutationObserver;
})();`
}
