/**
 * Returns the source of the event-collection script injected into the page.
 *
 * The script runs in the browser's JavaScript context and sends user action
 * events and DOM changes to Node.js through `window.__wstEvent()`.
 *
 * Captured events:
 * - click, keydown, input, submit (user actions)
 * - DOM changes via MutationObserver
 *
 * Security:
 * - The value and key of password fields (`type="password"`) are masked as `***`.
 *
 * Protection against repeated installation:
 * - The event handlers are kept in `window.__wstHandlers`.
 * - Each time the script runs, it removes the previous handlers and observer
 *   and replaces them with the latest ones.
 * - So even if several puppeteer sessions register `evaluateOnNewDocument`,
 *   only the handlers of the script that ran last stay active.
 */
export function getInjectedScript(): string {
  return `(function () {
  'use strict';

  /**
   * Returns the XPath of a DOM element.
   * @param {Element} el - Target element
   * @returns {string} XPath string
   */
  function getXPath(el) {
    if (!el) return '';
    // characterData targets are text nodes, not Elements: use the parent
    // element's path, or this would return '' and mutation-level would
    // misclassify the change.
    if (el.nodeType !== Node.ELEMENT_NODE) {
      return el.parentElement ? getXPath(el.parentElement) : '';
    }
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
   * Sends event data to Node.js.
   * Depending on the execution order of evaluateOnNewDocument, __wstEvent may
   * not be defined when the script is set up, so it is checked on every call.
   * @param {object} data - Data to send
   */
  function sendEvent(data) {
    try {
      if (typeof window.__wstEvent === 'function') {
        window.__wstEvent(JSON.stringify(data));
      }
    } catch (_) {
      // A send error must not affect the page
    }
  }

  var frameType = window.self === window.top ? 'main' : 'iframe';

  // Remove the handlers and observer of a previous injection
  if (window.__wstHandlers) {
    document.removeEventListener('click', window.__wstHandlers.click, true);
    document.removeEventListener('keydown', window.__wstHandlers.keydown, true);
    document.removeEventListener('input', window.__wstHandlers.input, true);
    document.removeEventListener('submit', window.__wstHandlers.submit, true);
  }

  if (window.__wstObserver) {
    window.__wstObserver.disconnect();
  }

  /** @type {EventListener} */
  var clickHandler = function (e) {
    var target = /** @type {Element} */ (e.target);
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return;
    sendEvent({
      type: 'user_action',
      frameType: frameType,
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
      frameType: frameType,
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
      frameType: frameType,
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
      frameType: frameType,
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

  window.__wstHandlers = {
    click: clickHandler,
    keydown: keydownHandler,
    input: inputHandler,
    submit: submitHandler,
  };

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

  window.__wstObserver = mutationObserver;
})();`
}
