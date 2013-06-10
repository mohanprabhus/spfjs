/**
 * @fileoverview Functions for dynamically loading scripts without blocking.
 * By nesting multiple calls in callback parameters, execution order of
 * the scripts can be preserved as well.
 *
 * Single script example:
 * spf.net.scripts.load(url, function() {
 *   doSomethingAfterOneScriptIsLoaded();
 * });
 *
 * Multiple script example, preserving execution order of the scripts:
 * spf.net.scripts.load(url1, function() {
 *   spf.net.scripts.load(url2, function() {
 *     doSomethingAfterTwoScriptsAreLoadedInOrder();
 *   });
 * });
 *
 * @author nicksay@google.com (Alex Nicksay)
 */

goog.provide('spf.net.scripts');

goog.require('spf.dom');
goog.require('spf.dom.dataset');
goog.require('spf.pubsub');
goog.require('spf.string');


/**
 * Evaluates a script text by dynamically creating an element and appending it
 * to the document.  A callback can be specified to execute once the script
 * has been loaded.
 *
 * @param {string} text The text of the script.
 * @param {Function=} opt_callback Callback function to execute when the
 *     script is loaded.
 */
spf.net.scripts.eval = function(text, opt_callback) {
  if (window.execScript) {
    window.execScript(text, 'JavaScript');
  } else {
    var scriptEl = document.createElement('script');
    scriptEl.appendChild(document.createTextNode(text));
    // Place the scripts in the head instead of the body to avoid errors when
    // called from the head in the first place.
    var targetEl = document.getElementsByTagName('head')[0] || document.body;
    // Use insertBefore instead of appendChild to avoid errors with loading
    // multiple scripts at once in IE.
    targetEl.insertBefore(scriptEl, targetEl.firstChild);
  }
  if (opt_callback) {
    opt_callback();
  }
};


/**
 * Loads a script URL by dynamically creating an element and appending it to
 * the document.
 *
 * - Subsequent calls to load the same URL will not reload the script.  This
 *   is done by giving each script a unique element id based on the URL and
 *   checking for it prior to loading.  To reload a script, unload it first.
 *   {@link #unload}
 *
 * - A callback can be specified to execute once the script has loaded.  The
 *   callback will be execute each time, even if the script is not reloaded.
 *
 * - A name can be specified to identify the same script at different URLs.
 *   (For example, "main-A.js" and "main-B.js" are both "main".)  If a name
 *   is specified, all other scripts with the same name will be unloaded
 *   before the callback is executed.  This allows switching between
 *   versions of the same script at different URLs.
 *
 * @param {string} url Url of the script.
 * @param {Function=} opt_callback Callback function to execute when the
 *     script is loaded.
 * @param {string=} opt_name Name to identify the script independently
 *     of the URL.
 * @return {Element} The dynamically created script element.
 */
spf.net.scripts.load = function(url, opt_callback, opt_name) {
  var id = spf.net.scripts.ID_PREFIX + spf.string.hashCode(url);
  var cls = opt_name || '';
  var scriptEl = document.getElementById(id);
  var isLoaded = scriptEl && spf.dom.dataset.get(scriptEl, 'loaded');
  var isLoading = scriptEl && !isLoaded;
  // If the script is already loaded, execute the callback(s) immediately.
  if (isLoaded) {
    if (opt_callback) {
      opt_callback();
    }
    return scriptEl;
  }
  // Register the callback.
  if (opt_callback) {
    spf.pubsub.subscribe(id, opt_callback);
  }
  // If the script is currently loading, wait.
  if (isLoading) {
    return scriptEl;
  }
  // Otherwise, the script needs to be loaded.
  // First, find old scripts to remove after loading, if any.
  var scriptElsToRemove = cls ? spf.dom.query('script.' + cls) : [];
  // Lexical closures allow this trickiness with the "el" variable.
  var el = spf.net.scripts.load_(url, id, cls, function() {
    if (!spf.dom.dataset.get(el, 'loaded')) {
      spf.dom.dataset.set(el, 'loaded', 'true');
      // Now that the script is loaded, remove old ones.
      // Only do this after a successful load to avoid prematurely removing
      // a script, which could lead to an unneeded script download/execution
      // if load() is called again.
      spf.net.scripts.unload_(scriptElsToRemove);
      spf.pubsub.publish(id);
      spf.pubsub.clear(id);
    }
  });
  return el;
};


/**
 * See {@link #load}.
 *
 * @param {string} url Url of the script.
 * @param {string} id Id of the script element.
 * @param {string} cls Class of the script element.
 * @param {Function} fn Callback for when the script has loaded.
 * @return {Element} The dynamically created script element.
 * @private
 */
spf.net.scripts.load_ = function(url, id, cls, fn) {
  var scriptEl = document.createElement('script');
  scriptEl.id = id;
  scriptEl.className = cls;
  // Safari/Chrome and Firefox support the onload event for scripts.
  scriptEl.onload = function() {
    // IE 10 has a bug where it will synchronously call load handlers for
    // cached resources, we must force this to be async.
    setTimeout(fn, 0);
  };
  // IE < 9 does not support the onload handler, so the onreadystatechange event
  // should be used to manually call onload. This means fn will be called twice
  // in modern IE, but subsequent invocations are ignored in the callback.
  scriptEl.onreadystatechange = function() {
    switch (scriptEl.readyState) {
      case 'loaded':
      case 'complete':
        scriptEl.onload();
    }
  };
  // Set the onload and onreadystatechange handlers before setting the src
  // to avoid potential IE bug where handlers are not called.
  scriptEl.src = url;
  // Place the scripts in the head instead of the body to avoid errors when
  // called from the head in the first place.
  var targetEl = document.getElementsByTagName('head')[0] || document.body;
  // Use insertBefore instead of appendChild to avoid errors with loading
  // multiple scripts at once in IE.
  targetEl.insertBefore(scriptEl, targetEl.firstChild);
  return scriptEl;
};


/**
 * "Unloads" a script URL by finding a previously created element and
 * removing it from the document.  This will allow a URL to be loaded again
 * if needed.  Unloading a script will stop execution of a pending callback,
 * but will not stop loading a pending URL.
 *
 * @param {string} url Url of the script.
 */
spf.net.scripts.unload = function(url) {
  var id = spf.net.scripts.ID_PREFIX + spf.string.hashCode(url);
  var scriptEl = document.getElementById(id);
  if (scriptEl) {
    spf.net.scripts.unload_([scriptEl]);
  }
};


/**
 * See {@link unload}
 *
 * @param {Array.<Node>} scriptEls The script elements.
 * @private
 */
spf.net.scripts.unload_ = function(scriptEls) {
  for (var i = 0; i < scriptEls.length; i++) {
    spf.pubsub.clear(scriptEls[i].id);
    scriptEls[i].parentNode.removeChild(scriptEls[i]);
  }
};


/**
 * Prefetchs a script URL; the script will be requested but not loaded.
 * Use to prime the browser cache and avoid needing to request the script when
 * subsequently loaded.  See {@link #load}.
 *
 * @param {string} url Url of the script.
 */
spf.net.scripts.prefetch = function(url) {
  var id = spf.net.scripts.ID_PREFIX + spf.string.hashCode(url);
  var scriptEl = document.getElementById(id);
  // If the script is already loaded, return.
  if (scriptEl) {
    return;
  }
  var iframeId = spf.net.scripts.ID_PREFIX + 'prefetch';
  var iframeEl = document.getElementById(iframeId);
  if (!iframeEl) {
    iframeEl = spf.dom.createIframe(iframeId);
  } else {
    // If the script is already prefetched, return.
    scriptEl = iframeEl.contentWindow.document.getElementById(id);
    if (scriptEl) {
      return;
    }
  }
  // Firefox needs the iframe to be fully created in the DOM before continuing.
  setTimeout(function() {
    spf.net.scripts.prefetch_(url, id, iframeEl.contentWindow.document);
  }, 0);
};



/**
 * See {@link #prefetch}.
 *
 * @param {string} url Url of the script.
 * @param {string} id Id of the script element.
 * @param {Document=} opt_document Content document element.
 * @private
 */
spf.net.scripts.prefetch_ = function(url, id, opt_document) {
  var doc = opt_document || document;
  var objectEl = doc.createElement('object');
  objectEl.id = id;
  if (spf.dom.IS_IE) {
    // IE needs a <script> in order to complete the request, but fortunately
    // will not execute it unless in the DOM.  Attempting to use an <object>
    // like other browsers will cause the download to hang.  The <object> will
    // just be a placeholder that the request has been made.
    var scriptEl = doc.createElement('script');
    scriptEl.src = url;
  } else {
    objectEl.data = url;
  }
  doc.body.appendChild(objectEl);
};


/**
 * Executes scripts that have been parsed from an HTML string.
 * See {@link #load}, {@link #eval}, and {@link #parse}.
 *
 * @param {!spf.net.scripts.ParseResult} result The parsed HTML result.
 * @param {Function=} opt_callback Callback function to execute after
 *     all scripts are loaded.
 */
spf.net.scripts.execute = function(result, opt_callback) {
  if (result.queue.length <= 0) {
    if (opt_callback) {
      opt_callback();
    }
    return;
  }
  // Load or evaluate the scripts in order.
  var index = -1;
  var getNextScript = function() {
    index++;
    if (index < result.queue.length) {
      var item = result.queue[index];
      if (item['url']) {
        spf.net.scripts.load(item['url'], getNextScript, item['name']);
      } else if (item['text']) {
        spf.net.scripts.eval(item['text'], getNextScript);
      } else {
        getNextScript();
      }
    } else {
      if (opt_callback) {
        opt_callback();
      }
    }
  };
  getNextScript();
};


/**
 * Prefetches scripts that have been parsed from an HTML string.
 * See {@link #prefetch} and {@link #parse}.
 *
 * @param {!spf.net.scripts.ParseResult} result The parsed HTML result.
 */
spf.net.scripts.preexecute = function(result) {
  if (result.queue.length <= 0) {
    return;
  }
  // Prefetch the scripts.
  for (var i = 0; i < result.queue.length; i++) {
    var item = result.queue[i];
    if (item['url']) {
      spf.net.scripts.prefetch(item['url']);
    }
  }
};


/**
 * Parses scripts from an HTML string.
 * See {@link #execute}.
 *
 * @param {string} html The HTML content to parse.
 * @return {!spf.net.scripts.ParseResult}
 */
spf.net.scripts.parse = function(html) {
  var result = new spf.net.scripts.ParseResult();
  if (!html) {
    return result;
  }
  result.original = html;
  html = html.replace(spf.net.scripts.SCRIPT_TAG_REGEXP,
      function(fullMatch, attr, text) {
        var url = attr.match(spf.net.scripts.SRC_ATTR_REGEXP);
        url = url ? url[1] : '';
        var name = attr.match(spf.net.scripts.CLASS_ATTR_REGEXP);
        name = name ? name[1] : '';
        result.queue.push({'url': url, 'text': text, 'name': name});
        return '';
      });
  result.parsed = html;
  return result;
};


/**
 * A container for holding the result of parsing scripts from an HTML string.
 * @constructor
 */
spf.net.scripts.ParseResult = function() {
  /** @type {string} */
  this.original = '';
  /** @type {string} */
  this.parsed = '';
  /** @type {Array.<{url:string, text:string, name:string}>} */
  this.queue = [];
};


/**
 * @type {string} The id prefix for dynamically created script elements.
 * @const
 */
spf.net.scripts.ID_PREFIX = 'js-';


/**
 * Regular expression used to locate script tags in a string.
 * See {@link #parse}.
 *
 * @type {RegExp}
 * @const
 */
spf.net.scripts.SCRIPT_TAG_REGEXP =
    /\x3cscript([\s\S]*?)\x3e([\s\S]*?)\x3c\/script\x3e/ig;


/**
 * Regular expression used to locate src attributes in a string.
 * See {@link #parse}.
 *
 * @type {RegExp}
 * @const
 */
spf.net.scripts.SRC_ATTR_REGEXP = /src="([\S]+)"/;


/**
 * Regular expression used to locate class attributes in a string.
 * See {@link #parse}.
 *
 * @type {RegExp}
 * @const
 */
spf.net.scripts.CLASS_ATTR_REGEXP = /class="([\S]+)"/;
