/**
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

import os from 'os';
import jsdom from 'jsdom';
import loaderUtils from 'loader-utils';
import LibraryTemplatePlugin from 'webpack/lib/LibraryTemplatePlugin';
import NodeTemplatePlugin from 'webpack/lib/node/NodeTemplatePlugin';
import NodeTargetPlugin from 'webpack/lib/node/NodeTargetPlugin';
import { DefinePlugin } from 'webpack';
import MemoryFs from 'memory-fs';
import { runChildCompiler, getRootCompiler, getBestModuleExport, stringToModule, convertPathToRelative } from './util';
import { applyEntry } from './webpack-util';

// Used to annotate this plugin's hooks in Tappable invocations
const PLUGIN_NAME = 'prerender-loader';

// Internal name used for the output bundle (never written to disk)
const FILENAME = 'ssr-bundle.js';

// Searches for fields of the form {{prerender}} or {{prerender:./some/module}}
const PRERENDER_REG = /\{\{prerender(?::\s*([^}]+?)\s*)?\}\}/;

/**
 * prerender-loader can be applied to any HTML or JS file with the given options.
 * @public
 * @param {Options} options Options to control how Critters inlines CSS.
 *
 * @example
 * // webpack.config.js
 * module.exports = {
 *   plugins: [
 *     new HtmlWebpackPlugin({
 *       // `!!` tells webpack to skip any configured loaders for .html files
 *       // `?string` tells prerender-loader output a JS module exporting the HTML string
 *       template: '!!prerender-loader?string!index.html'
 *     })
 *   ]
 * }
 *
 * @example
 * // inline demo: assumes you have html-loader set up:
 * import prerenderedHtml from '!prerender-loader!./file.html';
 */
export default function PrerenderLoader (content) {
  const options = loaderUtils.getOptions(this) || {};
  const outputFilter = options.as === 'string' || options.string ? stringToModule : String;

  if (options.disabled === true) {
    return outputFilter(content);
  }

  // When applied to HTML, attempts to inject into a specified {{prerender}} field.
  // @note: this is only used when the entry module exports a String or function
  // that resolves to a String, otherwise the whole document is serialized.
  let inject = false;
  if (!this.request.match(/.(js|ts)x?$/i)) {
    const matches = content.match(PRERENDER_REG);
    if (matches) {
      inject = true;
      options.entry = matches[1];
    }
    options.templateContent = content;
  }

  const callback = this.async();

  prerender(this._compilation, this.request, options, inject, this)
    .then(output => {
      callback(null, outputFilter(output));
    })
    .catch(err => {
      // console.error(err);
      callback(err);
    });
}

async function prerender (parentCompilation, request, options, inject, loader) {
  const parentCompiler = getRootCompiler(parentCompilation.compiler);
  const context = parentCompiler.options.context || process.cwd();
  const customEntry = options.entry && ([].concat(options.entry).pop() || '').trim();
  const entry = customEntry ? ('./' + customEntry) : convertPathToRelative(context, parentCompiler.options.entry, './');

  const outputOptions = {
    // fix: some plugins ignore/bypass outputfilesystem, so use a temp directory and ignore any writes.
    path: os.tmpdir(),
    filename: FILENAME
  };

  // Only copy over mini-extract-text-plugin (excluding it breaks extraction entirely)
  const plugins = (parentCompiler.options.plugins || []).filter(c => /MiniCssExtractPlugin/i.test(c.constructor.name));

  // Compile to an in-memory filesystem since we just want the resulting bundled code as a string
  const compiler = parentCompilation.createChildCompiler('prerender', outputOptions, plugins);
  compiler.context = parentCompiler.context;
  compiler.outputFileSystem = new MemoryFs();

  // Define PRERENDER to be true within the SSR bundle
  new DefinePlugin({
    PRERENDER: 'true'
  }).apply(compiler);

  // ... then define PRERENDER to be false within the client bundle
  new DefinePlugin({
    PRERENDER: 'false'
  }).apply(parentCompiler);

  // Compile to CommonJS to be executed by Node
  new NodeTemplatePlugin(outputOptions).apply(compiler);
  new NodeTargetPlugin().apply(compiler);

  new LibraryTemplatePlugin('PRERENDER_RESULT', 'var').apply(compiler);

  // Kick off compilation at our entry module (either the parent compiler's entry or a custom one defined via `{{prerender:entry.js}}`)
  applyEntry(context, entry, compiler);

  // Set up cache inheritance for the child compiler
  const subCache = 'subcache ' + request;
  function addChildCache (compilation, data) {
    if (compilation.cache) {
      if (!compilation.cache[subCache]) compilation.cache[subCache] = {};
      compilation.cache = compilation.cache[subCache];
    }
  }
  if (compiler.hooks) {
    compiler.hooks.compilation.tap(PLUGIN_NAME, addChildCache);
  } else {
    compiler.plugin('compilation', addChildCache);
  }

  const compilation = await runChildCompiler(compiler);
  let result;
  let dom, window, injectParent, injectNextSibling;

  // A promise-like that never resolves and does not retain references to callbacks.
  function BrokenPromise () {}
  BrokenPromise.prototype.then = BrokenPromise.prototype.catch = BrokenPromise.prototype.finally = () => new BrokenPromise();

  if (compilation.assets[compilation.options.output.filename]) {
    // Get the compiled main bundle
    const output = compilation.assets[compilation.options.output.filename].source();

    // @TODO: provide a non-DOM option to allow turning off JSDOM entirely.

    const tpl = options.templateContent || '<!DOCTYPE html><html><head></head><body></body></html>';
    dom = new jsdom.JSDOM(tpl.replace(PRERENDER_REG, '<div id="PRERENDER_INJECT"></div>'), {
      // suppress console-proxied eval() errors, but keep console proxying
      virtualConsole: new jsdom.VirtualConsole({ omitJSDOMErrors: false }).sendTo(console),

      // `url` sets the value returned by `window.location`, `document.URL`...
      // Useful for routers that depend on the current URL (such as react-router or reach-router)
      url: options.documentUrl || 'http://localhost',

      // don't track source locations for performance reasons
      includeNodeLocations: false,

      // don't allow inline event handlers & script tag exec
      runScripts: 'outside-only'
    });
    window = dom.window;

    // Find the placeholder node for injection & remove it
    const injectPlaceholder = window.document.getElementById('PRERENDER_INJECT');
    if (injectPlaceholder) {
      injectParent = injectPlaceholder.parentNode;
      injectNextSibling = injectPlaceholder.nextSibling;
      injectPlaceholder.remove();
    }

    // These are missing from JSDOM
    let counter = 0;
    window.requestAnimationFrame = () => ++counter;
    window.cancelAnimationFrame = () => { };

    // Never prerender Custom Elements: by skipping registration, we get only the Light DOM which is desirable.
    window.customElements = {
      define () {},
      get () {},
      upgrade () {},
      whenDefined: () => new BrokenPromise()
    };

    // Fake MessagePort
    window.MessagePort = function () {
      (this.port1 = new window.EventTarget()).postMessage = () => {};
      (this.port2 = new window.EventTarget()).postMessage = () => {};
    };

    // Never matches
    window.matchMedia = () => ({ addListener () {} });

    // Never register ServiceWorkers
    if (!window.navigator) window.navigator = {};
    window.navigator.serviceWorker = {
      register: () => new BrokenPromise()
    };

    // When DefinePlugin isn't sufficient
    window.PRERENDER = true;

    // Inject a require shim
    window.require = moduleId => {
      const asset = compilation.assets[moduleId.replace(/^\.?\//g, '')];
      if (!asset) {
        throw Error(`Error:  Module not found. attempted require("${moduleId}")`);
      }
      const mod = { exports: {} };
      window.eval(`(function(exports, module, require){\n${asset.source()}\n})`)(mod.exports, mod, window.require);
      return mod.exports;
    };

    // Invoke the SSR bundle within the JSDOM document and grab the exported/returned result
    result = window.eval(output + '\nPRERENDER_RESULT');
  }

  // Deal with ES Module exports (just use the best guess):
  if (result && typeof result === 'object') {
    result = getBestModuleExport(result);
  }

  if (typeof result === 'function') {
    result = result(options.params || null);
  }

  // The entry can export or return a Promise in order to perform fully async prerendering:
  if (result && result.then) {
    result = await result;
  }

  // Returning or resolving to `null` / `undefined` defaults to serializing the whole document.
  // Note: this pypasses `inject` because the document is already derived from the template.
  if (result !== undefined && options.templateContent) {
    const template = window.document.createElement('template');
    template.innerHTML = result || '';
    const content = template.content || template;
    const parent = injectParent || window.document.body;
    let child;
    while ((child = content.firstChild)) {
      parent.insertBefore(child, injectNextSibling || null);
    }
  } else if (inject) {
    // Otherwise inject the prerendered HTML into the template
    return options.templateContent.replace(PRERENDER_REG, result || '');
  }

  // dom.serialize() doesn't properly serialize HTML appended to document.body.
  // return `<!DOCTYPE ${window.document.doctype.name}>${window.document.documentElement.outerHTML}`;
  let serialized = dom.serialize();
  if (!/^<!DOCTYPE /mi.test(serialized)) {
    serialized = `<!DOCTYPE html>${serialized}`;
  }
  return serialized;

  // // Returning or resolving to `null` / `undefined` defaults to serializing the whole document.
  // // Note: this pypasses `inject` because the document is already derived from the template.
  // if (result == null && dom) {
  //   // result = dom.serialize();
  // } else if (inject) {
  //   // @TODO determine if this is really worthwhile/necessary for the string return case
  //   if (injectParent || options.templateContent) {
  //     console.log(injectParent.outerHTML);
  //     (injectParent || document.body).insertAdjacentHTML('beforeend', result || '');
  //     // result = dom.serialize();
  //   } else {
  //     // Otherwise inject the prerendered HTML into the template
  //     return options.templateContent.replace(PRERENDER_REG, result || '');
  //   }
  // }

  // return dom.serialize();
  // return result;
}
